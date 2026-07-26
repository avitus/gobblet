import { describe, expect, it } from "vitest";
import {
  ADMIN_PAGE_SIZE,
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
  USER_ROLES,
  adminAchievementCreateRequestSchema,
  adminAchievementSchema,
  adminAchievementUpdateRequestSchema,
  adminAuditEntrySchema,
  adminAuditQuerySchema,
  adminMatchDetailSchema,
  adminMetricsSummarySchema,
  adminRatingAdjustRequestSchema,
  adminSuspendRequestSchema,
  adminUserDetailSchema,
  adminUserSearchQuerySchema,
  adminUserSummarySchema,
  auditReasonSchema,
  isUserRole,
  type AdminMatchDetail,
  type AdminMetricsSummary,
  type AdminUserDetail,
  type AdminUserSummary,
} from "../src/index";
import { COMMAND_ID, DARK_ACTOR_ID, LIGHT_ACTOR_ID, MATCH_ID, clocks } from "./helpers/fixtures";

const ACHIEVEMENT_ID = "3d5e7c11-8a44-4e5c-9d21-6b7a8c9d0e12";
const AUDIT_ID = "4e6f8d22-9b55-4f6d-8e32-7c8b9d0e1f23";
const REASON = "Reported for stalling every match";

const summary: AdminUserSummary = {
  userId: LIGHT_ACTOR_ID,
  username: "ada",
  status: "active",
  role: "player",
  emailVerified: true,
  rating: 1243,
  createdAt: "2026-07-01T09:00:00.000Z",
  lastSeenAt: "2026-07-26T09:00:00.000Z",
};

const detail: AdminUserDetail = {
  user: summary,
  email: "ada@example.com",
  displayName: "ada",
  suspendedAt: null,
  suspendedReason: null,
  casual: { wins: 3, losses: 2, draws: 1, played: 6 },
  ranked: {
    rating: 1243,
    wins: 5,
    losses: 4,
    draws: 0,
    played: 9,
    currentStreak: 2,
    bestStreak: 3,
    ratedAt: "2026-07-25T18:00:00.000Z",
  },
  recentMatches: [],
  moderation: [
    {
      action: "user-suspended",
      adminUsername: "root",
      reason: REASON,
      createdAt: "2026-07-20T12:00:00.000Z",
    },
  ],
  activeSessions: 2,
};

const matchDetail: AdminMatchDetail = {
  match: {
    matchId: MATCH_ID,
    mode: "ranked",
    timeControlSeconds: 300,
    status: "completed",
    result: { outcome: "light", reason: "line" },
    players: {
      light: {
        actorId: LIGHT_ACTOR_ID,
        actorType: "user",
        displayName: "ada",
        isGuest: false,
        rating: 1243,
      },
      dark: {
        actorId: DARK_ACTOR_ID,
        actorType: "user",
        displayName: "linus",
        isGuest: false,
        rating: 1207,
      },
    },
    moveCount: 12,
    createdAt: "2026-07-25T17:00:00.000Z",
    startedAt: "2026-07-25T17:00:01.000Z",
    endedAt: "2026-07-25T17:06:11.000Z",
  },
  version: 13,
  clocks,
  events: [
    {
      sequence: 1,
      type: "move",
      actorType: "user",
      actorId: LIGHT_ACTOR_ID,
      commandId: COMMAND_ID,
      payload: { move: { kind: "reserve", reserveStack: 0, to: "r0c0" } },
      stateHash: "b7c3",
      revealedAndBlocked: false,
      createdAt: "2026-07-25T17:00:05.000Z",
    },
  ],
  connections: [
    {
      kind: "attached",
      actorType: "user",
      actorId: LIGHT_ACTOR_ID,
      socketId: "socket-1",
      reason: null,
      createdAt: "2026-07-25T17:00:02.000Z",
    },
  ],
};

const metrics: AdminMetricsSummary = {
  generatedAt: "2026-07-26T09:00:00.000Z",
  windowHours: 24,
  deployment: { appVersion: "0.1.0", gitSha: "abc1234", appEnv: "local", uptimeSeconds: 120 },
  health: { ready: true, checks: [{ name: "database", ok: true }] },
  activity: { dailyActiveAccounts: 4, dailyActiveGuests: 6, dailyActiveUsers: 10 },
  matches: {
    active: 2,
    completed: 8,
    aborted: 2,
    completionRate: 0.8,
    abandonmentRate: 0.2,
    byEndReason: [{ reason: "line", count: 6 }],
  },
  matchmaking: {
    queueDepth: [{ mode: "ranked", timeControlSeconds: 300, waiting: 1 }],
    averageWaitMs: 4200,
    pairings: 5,
  },
  sockets: { connected: 3 },
  errors: {
    total: 1,
    recent: [
      {
        code: "validation_failed",
        route: "POST /v1/auth/register",
        count: 1,
        lastSeenAt: "2026-07-26T08:59:00.000Z",
      },
    ],
  },
  clientVersions: [],
};

describe("the administrative vocabulary", () => {
  it("names two roles and every audited action", () => {
    expect([...USER_ROLES]).toEqual(["player", "admin"]);
    expect(isUserRole("admin")).toBe(true);
    expect(isUserRole("moderator")).toBe(false);
    expect([...AUDIT_ACTIONS]).toEqual([
      "user-suspended",
      "user-unsuspended",
      "rating-adjusted",
      "achievement-created",
      "achievement-updated",
      "role-granted",
    ]);
    expect([...AUDIT_TARGET_TYPES]).toEqual(["user", "achievement"]);
  });

  it("requires a reason long enough to be one", () => {
    expect(auditReasonSchema.safeParse("spam").success).toBe(false);
    expect(auditReasonSchema.parse("  stalling every match  ")).toBe("stalling every match");
    expect(auditReasonSchema.safeParse("x".repeat(501)).success).toBe(false);
  });

  it("requires a reason on every mutation", () => {
    expect(adminSuspendRequestSchema.safeParse({}).success).toBe(false);
    expect(adminSuspendRequestSchema.parse({ reason: REASON }).reason).toBe(REASON);
    expect(adminRatingAdjustRequestSchema.safeParse({ rating: 1300 }).success).toBe(false);
    expect(adminRatingAdjustRequestSchema.parse({ rating: 1300, reason: REASON }).rating).toBe(
      1300,
    );
    expect(adminRatingAdjustRequestSchema.safeParse({ rating: -1, reason: REASON }).success).toBe(
      false,
    );
  });
});

describe("the user search", () => {
  it("takes a query, a status and a page of at most fifty", () => {
    expect(ADMIN_PAGE_SIZE).toBe(50);
    expect(adminUserSearchQuerySchema.parse({ query: " ada ", limit: 50 })).toEqual({
      query: "ada",
      limit: 50,
    });
    expect(adminUserSearchQuerySchema.safeParse({ limit: 51 }).success).toBe(false);
    expect(adminUserSearchQuerySchema.safeParse({ status: "banned" }).success).toBe(false);
    expect(adminUserSearchQuerySchema.parse({})).toEqual({});
  });

  it("lists an account without its address, and shows one with it", () => {
    expect(adminUserSummarySchema.parse(summary)).toEqual(summary);
    expect("email" in adminUserSummarySchema.parse(summary)).toBe(false);
    expect(adminUserDetailSchema.parse(detail).email).toBe("ada@example.com");
  });

  it("keeps a rating absent rather than invented", () => {
    expect(adminUserSummarySchema.parse({ ...summary, rating: null }).rating).toBeNull();
    expect(adminUserDetailSchema.parse({ ...detail, ranked: null }).ranked).toBeNull();
  });
});

describe("match inspection", () => {
  it("carries the internal event log beside the connection history", () => {
    const parsed = adminMatchDetailSchema.parse(matchDetail);
    expect(parsed.events[0]?.stateHash).toBe("b7c3");
    expect(parsed.connections[0]?.kind).toBe("attached");
  });

  it("refuses a connection kind it does not know", () => {
    expect(
      adminMatchDetailSchema.safeParse({
        ...matchDetail,
        connections: [{ ...matchDetail.connections[0], kind: "resumed" }],
      }).success,
    ).toBe(false);
  });
});

describe("the achievement catalogue as an administrator sees it", () => {
  it("counts the awards beside the definition", () => {
    const row = {
      achievementId: ACHIEVEMENT_ID,
      code: "first-victory" as const,
      name: "First Victory",
      description: "Win your first match.",
      badge: "bronze" as const,
      ruleVersion: 1,
      enabled: true,
      awarded: 12,
      updatedAt: "2026-07-26T09:00:00.000Z",
    };
    expect(adminAchievementSchema.parse(row)).toEqual(row);
  });

  it("creates only a code the server can evaluate", () => {
    expect(
      adminAchievementCreateRequestSchema.parse({
        code: "century-club",
        name: "Century Club",
        description: "Complete one hundred matches.",
        badge: "gold",
        reason: REASON,
      }).code,
    ).toBe("century-club");
    expect(
      adminAchievementCreateRequestSchema.safeParse({
        code: "invented-badge",
        name: "Invented",
        description: "Nothing can earn this.",
        badge: "gold",
        reason: REASON,
      }).success,
    ).toBe(false);
  });

  it("changes at least one field, and never the code", () => {
    expect(adminAchievementUpdateRequestSchema.safeParse({ reason: REASON }).success).toBe(false);
    expect(
      adminAchievementUpdateRequestSchema.parse({ enabled: false, reason: REASON }).enabled,
    ).toBe(false);
    expect(
      adminAchievementUpdateRequestSchema.safeParse({ code: "on-a-roll", reason: REASON }).success,
    ).toBe(false);
  });
});

describe("the operational summary", () => {
  it("describes the window it was computed over", () => {
    expect(adminMetricsSummarySchema.parse(metrics).windowHours).toBe(24);
  });

  it("leaves a rate absent when nothing finished", () => {
    const quiet = {
      ...metrics,
      matches: { ...metrics.matches, completionRate: null, abandonmentRate: null },
      matchmaking: { ...metrics.matchmaking, averageWaitMs: null },
    };
    expect(adminMetricsSummarySchema.parse(quiet).matches.completionRate).toBeNull();
  });

  it("refuses a rate outside zero to one", () => {
    expect(
      adminMetricsSummarySchema.safeParse({
        ...metrics,
        matches: { ...metrics.matches, completionRate: 1.2 },
      }).success,
    ).toBe(false);
  });
});

describe("the audit log", () => {
  it("keeps the before and after states and names the actor", () => {
    const entry = {
      auditId: AUDIT_ID,
      action: "rating-adjusted" as const,
      adminUserId: DARK_ACTOR_ID,
      adminUsername: "root",
      targetType: "user" as const,
      targetId: LIGHT_ACTOR_ID,
      targetLabel: "ada",
      before: { rating: 1243 },
      after: { rating: 1300 },
      reason: REASON,
      createdAt: "2026-07-26T09:00:00.000Z",
    };
    expect(adminAuditEntrySchema.parse(entry)).toEqual(entry);
  });

  it("allows the console as an actor, which is nobody's account", () => {
    const consoleEntry = {
      auditId: AUDIT_ID,
      action: "role-granted" as const,
      adminUserId: null,
      adminUsername: null,
      targetType: "user" as const,
      targetId: LIGHT_ACTOR_ID,
      targetLabel: "ada",
      before: { role: "player" },
      after: { role: "admin" },
      reason: "Bootstrapping the first administrator",
      createdAt: "2026-07-26T09:00:00.000Z",
    };
    expect(adminAuditEntrySchema.parse(consoleEntry).adminUserId).toBeNull();
  });

  it("filters by action and target, and pages by cursor", () => {
    expect(adminAuditQuerySchema.parse({ action: "user-suspended" }).action).toBe("user-suspended");
    expect(adminAuditQuerySchema.safeParse({ action: "user-renamed" }).success).toBe(false);
    expect(adminAuditQuerySchema.safeParse({ targetId: "not-a-uuid" }).success).toBe(false);
    expect(adminAuditQuerySchema.parse({ cursor: "42" }).cursor).toBe("42");
  });
});
