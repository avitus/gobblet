import {
  countActiveActors,
  countActiveSessions,
  countCasualResults,
  findAchievementByCode,
  findMatchById,
  findRating,
  findUserById,
  insertAchievement,
  insertAuditRecord,
  insertRatingAdjustment,
  listAchievementsForAdmin,
  listAuditRecords,
  listMatchConnectionEvents,
  listMatchEvents,
  listModerationHistory,
  listUnfinishedMatches,
  revokeUserSessions,
  searchUsers,
  setRating,
  setUserSuspension,
  summariseMatches,
  summarisePairings,
  updateAchievement,
} from "@gobblet/db";
import type { AuditEntryRow, Database, DatabaseExecutor, UserRow } from "@gobblet/db";
import type { ServerConfig } from "@gobblet/config";
import { ACHIEVEMENT_RULE_VERSION, ADMIN_PAGE_SIZE } from "@gobblet/protocol";
import type {
  AdminAchievement,
  AdminAchievementCreateRequest,
  AdminAchievementUpdateRequest,
  AdminActiveMatch,
  AdminAuditEntry,
  AdminAuditQuery,
  AdminMatchDetail,
  AdminMetricsSummary,
  AdminRatingAdjustResponse,
  AdminUserDetail,
  AdminUserListResponse,
  AdminUserSearchQuery,
  AdminUserSummary,
  TimeControl,
} from "@gobblet/protocol";
import { listCompletedPlayerHistory } from "../match/history";
import { matchClocks, toSummary } from "../match/snapshot";
import type { MatchmakingQueue } from "../matchmaking/service";
import type { TelemetryService } from "../observability/telemetry";
import { decodeCursor, encodeCursor } from "./cursor";

/**
 * The administrative surface of spec sections 14.4 and 16
 * (docs/adr/0029-administration-is-a-role-on-the-account.md). Every mutation here
 * writes its audit record inside the transaction that makes the change, so a
 * failure leaves neither, and every one of them requires a reason.
 */

/** An administrator with an account, which is what a request can ever carry. */
export type AdminIdentity = Readonly<{ userId: string; username: string }>;

export type ReadinessSnapshot = readonly Readonly<{ name: string; ok: boolean }>[];

export type AdminServiceOptions = Readonly<{
  db: Database;
  config: ServerConfig;
  queue: MatchmakingQueue;
  telemetry: TelemetryService;
  /** Reads the same probes `GET /health/ready` reports, so the two agree. */
  readiness: () => Promise<ReadinessSnapshot>;
  connectedSockets: () => number;
  startedAt: number;
  now: () => number;
}>;

export type AdminFailure =
  "unknown-user" | "unknown-match" | "unknown-achievement" | "achievement-exists" | "unrated";

export type AdminResult<T> =
  Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; reason: AdminFailure }>;

const SUMMARY_WINDOW_HOURS = 24;
const RECENT_MATCH_COUNT = 10;
const MODERATION_HISTORY_LIMIT = 20;

export class AdminService {
  private readonly db: Database;

  private readonly config: ServerConfig;

  private readonly queue: MatchmakingQueue;

  private readonly telemetry: TelemetryService;

  private readonly readiness: () => Promise<ReadinessSnapshot>;

  private readonly connectedSockets: () => number;

  private readonly startedAt: number;

  private readonly clock: () => number;

  constructor(options: AdminServiceOptions) {
    this.db = options.db;
    this.config = options.config;
    this.queue = options.queue;
    this.telemetry = options.telemetry;
    this.readiness = options.readiness;
    this.connectedSockets = options.connectedSockets;
    this.startedAt = options.startedAt;
    this.clock = options.now;
  }

  async searchUsers(query: AdminUserSearchQuery): Promise<AdminUserListResponse> {
    const limit = query.limit ?? ADMIN_PAGE_SIZE;
    const cursor = decodeCursor(query.cursor);
    const rows = await searchUsers(this.db, {
      query: query.query,
      status: query.status,
      limit: limit + 1,
      cursor: cursor === null ? null : { lastSeenAt: new Date(cursor.at), userId: cursor.id },
    });

    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      users: page.map((row) => ({
        userId: row.userId,
        username: row.username,
        status: row.status,
        role: row.role,
        emailVerified: row.emailVerified,
        rating: row.rating,
        createdAt: row.createdAt.toISOString(),
        lastSeenAt: row.lastSeenAt.toISOString(),
      })),
      nextCursor:
        rows.length > limit && last
          ? encodeCursor({ at: last.lastSeenAt.getTime(), id: last.userId })
          : null,
    };
  }

  /** The one place an address is shown, and never a hash or a token (P7.2). */
  async userDetail(userId: string): Promise<AdminResult<AdminUserDetail>> {
    const user = await findUserById(this.db, userId);
    if (!user) {
      return { ok: false, reason: "unknown-user" };
    }
    return { ok: true, value: await this.detailOf(user) };
  }

  async suspend(
    actor: AdminIdentity,
    userId: string,
    reason: string,
  ): Promise<AdminResult<AdminUserDetail>> {
    return this.moderate(actor, userId, reason, "user-suspended", async (tx, user) => {
      const now = new Date(this.clock());
      const updated = await setUserSuspension(tx, user.id, {
        status: "suspended",
        suspendedAt: now,
        suspendedReason: reason,
      });
      // Suspension revokes every live session, so a held token stops working.
      await revokeUserSessions(tx, user.id, now);
      return updated;
    });
  }

  async reinstate(
    actor: AdminIdentity,
    userId: string,
    reason: string,
  ): Promise<AdminResult<AdminUserDetail>> {
    return this.moderate(actor, userId, reason, "user-unsuspended", async (tx, user) =>
      setUserSuspension(tx, user.id, {
        status: "active",
        suspendedAt: null,
        suspendedReason: null,
      }),
    );
  }

  /**
   * A correction writes the rating, the adjustment row and the audit row in one
   * transaction, and never a `rating_changes` row: that table is the per-match
   * audit period leaderboards aggregate (appendix P7.4).
   */
  async adjustRating(
    actor: AdminIdentity,
    userId: string,
    rating: number,
    reason: string,
  ): Promise<AdminResult<AdminRatingAdjustResponse>> {
    const user = await findUserById(this.db, userId);
    if (!user) {
      return { ok: false, reason: "unknown-user" };
    }

    const existing = await findRating(this.db, userId);
    if (!existing) {
      return { ok: false, reason: "unrated" };
    }

    const adjustedAt = new Date(this.clock());
    const before = existing.rating;
    await this.db.transaction(async (tx) => {
      await setRating(tx, userId, rating);
      const audit = await insertAuditRecord(tx, {
        adminUserId: actor.userId,
        action: "rating-adjusted",
        targetType: "user",
        targetId: userId,
        targetLabel: user.username,
        before: { rating: before },
        after: { rating },
        reason,
        createdAt: adjustedAt,
      });
      await insertRatingAdjustment(tx, {
        userId,
        adminUserId: actor.userId,
        auditId: audit.id,
        ratingBefore: before,
        ratingAfter: rating,
        delta: rating - before,
        reason,
        createdAt: adjustedAt,
      });
    });

    return {
      ok: true,
      value: {
        userId,
        ratingBefore: before,
        ratingAfter: rating,
        adjustedAt: adjustedAt.toISOString(),
      },
    };
  }

  /**
   * Every match event with its payload and state hash, plus the connection history
   * from its own table. Nothing is actor scoped here, which is the whole point of
   * the surface (appendix P7.5).
   */
  async matchDetail(matchId: string): Promise<AdminResult<AdminMatchDetail>> {
    const row = await findMatchById(this.db, matchId);
    if (row === undefined) {
      return { ok: false, reason: "unknown-match" };
    }

    const events = await listMatchEvents(this.db, matchId);
    const connections = await listMatchConnectionEvents(this.db, matchId);
    return {
      ok: true,
      value: {
        match: toSummary(row),
        version: row.stateVersion,
        clocks: matchClocks(row, this.clock()),
        events: events.map((event) => ({
          sequence: event.sequence,
          type: event.type,
          actorType: event.actorType,
          actorId: event.actorId,
          commandId: event.commandId,
          payload: event.payload,
          stateHash: event.stateHash,
          revealedAndBlocked: event.revealedAndBlocked,
          createdAt: event.createdAt.toISOString(),
        })),
        connections: connections.map((event) => ({
          kind: event.kind,
          actorType: event.actorType,
          actorId: event.actorId,
          socketId: event.socketId,
          reason: event.reason,
          createdAt: event.createdAt.toISOString(),
        })),
      },
    };
  }

  /** Read from the process that owns them, at the moment of the request (P7.6). */
  async activeMatches(): Promise<readonly AdminActiveMatch[]> {
    const rows = await listUnfinishedMatches(this.db);
    return rows.map((row) => ({
      matchId: row.id,
      mode: row.mode,
      status: row.status,
      timeControlSeconds: row.timeControlSeconds as TimeControl,
      version: row.stateVersion,
      lightDisplayName: row.lightDisplayName,
      darkDisplayName: row.darkDisplayName,
      startedAt: row.startedAt?.toISOString() ?? null,
    }));
  }

  async achievements(): Promise<readonly AdminAchievement[]> {
    const rows = await listAchievementsForAdmin(this.db);
    return rows.map((row) => ({
      achievementId: row.achievementId,
      code: row.code as AdminAchievement["code"],
      name: row.name,
      description: row.description,
      badge: row.badgeAsset as AdminAchievement["badge"],
      ruleVersion: row.ruleVersion,
      enabled: row.enabled,
      awarded: row.awarded,
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  /**
   * Creation is limited to a code the server has a rule for, so nothing unearnable
   * can be offered (appendix P7.3). A code that already has a row is a conflict.
   */
  async createAchievement(
    actor: AdminIdentity,
    request: AdminAchievementCreateRequest,
  ): Promise<AdminResult<AdminAchievement>> {
    const existing = await findAchievementByCode(this.db, request.code);
    if (existing) {
      return { ok: false, reason: "achievement-exists" };
    }

    const now = new Date(this.clock());
    const created = await this.db.transaction(async (tx) => {
      const row = await insertAchievement(tx, {
        code: request.code,
        name: request.name,
        description: request.description,
        badgeAsset: request.badge,
        ruleVersion: ACHIEVEMENT_RULE_VERSION,
        enabled: request.enabled ?? true,
        createdAt: now,
        updatedAt: now,
      });
      await insertAuditRecord(tx, {
        adminUserId: actor.userId,
        action: "achievement-created",
        targetType: "achievement",
        targetId: row.id,
        targetLabel: row.code,
        before: {},
        after: {
          code: row.code,
          name: row.name,
          description: row.description,
          badge: row.badgeAsset,
          enabled: row.enabled,
        },
        reason: request.reason,
        createdAt: now,
      });
      return row;
    });

    return {
      ok: true,
      value: {
        achievementId: created.id,
        code: created.code as AdminAchievement["code"],
        name: created.name,
        description: created.description,
        badge: created.badgeAsset as AdminAchievement["badge"],
        ruleVersion: created.ruleVersion,
        enabled: created.enabled,
        awarded: 0,
        updatedAt: created.updatedAt.toISOString(),
      },
    };
  }

  async updateAchievement(
    actor: AdminIdentity,
    achievementId: string,
    request: AdminAchievementUpdateRequest,
  ): Promise<AdminResult<AdminAchievement>> {
    const rows = await listAchievementsForAdmin(this.db);
    const existing = rows.find((row) => row.achievementId === achievementId);
    if (!existing) {
      return { ok: false, reason: "unknown-achievement" };
    }

    const now = new Date(this.clock());
    const patch = {
      ...(request.name === undefined ? {} : { name: request.name }),
      ...(request.description === undefined ? {} : { description: request.description }),
      ...(request.badge === undefined ? {} : { badgeAsset: request.badge }),
      ...(request.enabled === undefined ? {} : { enabled: request.enabled }),
    };

    const updated = await this.db.transaction(async (tx) => {
      const row = await updateAchievement(tx, achievementId, patch);
      await insertAuditRecord(tx, {
        adminUserId: actor.userId,
        action: "achievement-updated",
        targetType: "achievement",
        targetId: achievementId,
        targetLabel: row.code,
        before: {
          name: existing.name,
          description: existing.description,
          badge: existing.badgeAsset,
          enabled: existing.enabled,
        },
        after: {
          name: row.name,
          description: row.description,
          badge: row.badgeAsset,
          enabled: row.enabled,
        },
        reason: request.reason,
        createdAt: now,
      });
      return row;
    });

    return {
      ok: true,
      value: {
        achievementId,
        code: updated.code as AdminAchievement["code"],
        name: updated.name,
        description: updated.description,
        badge: updated.badgeAsset as AdminAchievement["badge"],
        ruleVersion: updated.ruleVersion,
        enabled: updated.enabled,
        awarded: existing.awarded,
        updatedAt: updated.updatedAt.toISOString(),
      },
    };
  }

  async auditLog(query: AdminAuditQuery): Promise<
    Readonly<{
      entries: readonly AdminAuditEntry[];
      nextCursor: string | null;
    }>
  > {
    const limit = query.limit ?? ADMIN_PAGE_SIZE;
    const cursor = decodeCursor(query.cursor);
    const rows = await listAuditRecords(this.db, {
      action: query.action,
      targetId: query.targetId,
      limit: limit + 1,
      cursor: cursor === null ? null : { createdAt: new Date(cursor.at), id: cursor.id },
    });

    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      entries: page.map(toAuditEntry),
      nextCursor:
        rows.length > limit && last
          ? encodeCursor({ at: last.createdAt.getTime(), id: last.id })
          : null,
    };
  }

  /**
   * The operational summary of section 16: SQL over the product tables for what
   * happened, and this process for what is happening now (ADR-0031).
   */
  async metricsSummary(): Promise<AdminMetricsSummary> {
    const now = this.clock();
    const since = new Date(now - SUMMARY_WINDOW_HOURS * 60 * 60 * 1000);
    const [activity, matches, pairings, checks, errorTotal] = await Promise.all([
      countActiveActors(this.db, since),
      summariseMatches(this.db, since),
      summarisePairings(this.db, since),
      this.readiness(),
      this.telemetry.metrics.errorTotal(),
    ]);

    const finished = matches.completed + matches.aborted;
    return {
      generatedAt: new Date(now).toISOString(),
      windowHours: SUMMARY_WINDOW_HOURS,
      deployment: {
        appVersion: this.config.appVersion,
        gitSha: this.config.gitSha,
        appEnv: this.config.appEnv,
        uptimeSeconds: Math.max(0, Math.round((now - this.startedAt) / 1000)),
      },
      health: { ready: checks.every((check) => check.ok), checks: [...checks] },
      activity: {
        dailyActiveAccounts: activity.accounts,
        dailyActiveGuests: activity.guests,
        dailyActiveUsers: activity.accounts + activity.guests,
      },
      matches: {
        active: matches.active,
        completed: matches.completed,
        aborted: matches.aborted,
        completionRate: finished === 0 ? null : matches.completed / finished,
        abandonmentRate: finished === 0 ? null : matches.aborted / finished,
        byEndReason: matches.byEndReason.map((entry) => ({
          reason: entry.reason,
          count: entry.count,
        })),
      },
      matchmaking: {
        queueDepth: this.queue.depths().map((depth) => ({
          mode: depth.mode,
          timeControlSeconds: depth.timeControlSeconds,
          waiting: depth.depth,
        })),
        averageWaitMs: pairings.averageWaitMs,
        pairings: pairings.pairings,
      },
      sockets: { connected: this.connectedSockets() },
      errors: {
        total: errorTotal,
        recent: this.telemetry.recentFailures().map((failure) => ({
          code: failure.code,
          route: failure.route,
          count: failure.count,
          lastSeenAt: failure.lastSeenAt.toISOString(),
        })),
      },
      /** Empty until a desktop client exists, in Phase 8 (appendix P7.10). */
      clientVersions: [],
    };
  }

  private async moderate(
    actor: AdminIdentity,
    userId: string,
    reason: string,
    action: "user-suspended" | "user-unsuspended",
    change: (tx: DatabaseExecutor, user: UserRow) => Promise<UserRow>,
  ): Promise<AdminResult<AdminUserDetail>> {
    const user = await findUserById(this.db, userId);
    if (!user) {
      return { ok: false, reason: "unknown-user" };
    }

    const updated = await this.db.transaction(async (tx) => {
      const written = await change(tx, user);
      await insertAuditRecord(tx, {
        adminUserId: actor.userId,
        action,
        targetType: "user",
        targetId: userId,
        targetLabel: user.username,
        before: { status: user.status, suspendedReason: user.suspendedReason },
        after: { status: written.status, suspendedReason: written.suspendedReason },
        reason,
        createdAt: new Date(this.clock()),
      });
      return written;
    });

    return { ok: true, value: await this.detailOf(updated) };
  }

  private async summaryOf(user: UserRow): Promise<AdminUserSummary> {
    const rating = await findRating(this.db, user.id);
    return {
      userId: user.id,
      username: user.username,
      status: user.status,
      role: user.role,
      emailVerified: user.emailVerifiedAt !== null,
      rating: rating?.rating ?? null,
      createdAt: user.createdAt.toISOString(),
      lastSeenAt: user.lastSeenAt.toISOString(),
    };
  }

  private async detailOf(user: UserRow): Promise<AdminUserDetail> {
    const now = new Date(this.clock());
    const [summary, rating, casual, moderation, sessions, recentMatches] = await Promise.all([
      this.summaryOf(user),
      findRating(this.db, user.id),
      countCasualResults(this.db, user.id),
      listModerationHistory(this.db, user.id, MODERATION_HISTORY_LIMIT),
      countActiveSessions(this.db, user.id, now),
      listCompletedPlayerHistory(
        this.db,
        { actorType: "user", actorId: user.id },
        RECENT_MATCH_COUNT,
      ),
    ]);

    return {
      user: summary,
      email: user.email,
      displayName: user.displayName,
      suspendedAt: user.suspendedAt?.toISOString() ?? null,
      suspendedReason: user.suspendedReason,
      casual,
      ranked:
        rating === undefined
          ? null
          : {
              rating: rating.rating,
              wins: rating.wins,
              losses: rating.losses,
              draws: rating.draws,
              played: rating.gamesPlayed,
              currentStreak: rating.currentStreak,
              bestStreak: rating.bestStreak,
              ratedAt: rating.updatedAt.toISOString(),
            },
      recentMatches: recentMatches.map((match) => ({ ...match })),
      moderation: moderation.map((entry) => ({
        action: entry.action,
        adminUsername: entry.adminUsername,
        reason: entry.reason,
        createdAt: entry.createdAt.toISOString(),
      })),
      activeSessions: sessions,
    };
  }
}

function toAuditEntry(row: AuditEntryRow): AdminAuditEntry {
  return {
    auditId: row.id,
    action: row.action,
    adminUserId: row.adminUserId,
    adminUsername: row.adminUsername,
    targetType: row.targetType,
    targetId: row.targetId,
    targetLabel: row.targetLabel,
    before: row.before,
    after: row.after,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  };
}
