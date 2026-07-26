import { loadServerConfig } from "@gobblet/config";
import {
  findAchievementByCode,
  insertAchievement,
  insertMatch,
  listAuditRecords,
  setUserRole,
  updateAchievement,
  upsertRating,
} from "@gobblet/db";
import type { DatabaseHandle } from "@gobblet/db";
import { deleteAchievementByCode } from "@gobblet/db/testing";
import {
  ACHIEVEMENT_CATALOGUE,
  ACHIEVEMENT_RULE_VERSION,
  adminAchievementListResponseSchema,
  adminAchievementSchema,
  adminActiveMatchesResponseSchema,
  adminAuditResponseSchema,
  adminMatchDetailSchema,
  adminMetricsSummarySchema,
  adminRatingAdjustResponseSchema,
  adminUserDetailSchema,
  adminUserListResponseSchema,
  authResponseSchema,
  createGuestResponseSchema,
  httpErrorBodySchema,
} from "@gobblet/protocol";
import type { AuthResponse } from "@gobblet/protocol";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AdminService } from "../src/admin/service";
import { buildApp } from "../src/app";
import { GuestService } from "../src/guests/service";
import { IdentityService } from "../src/identity/service";
import { LeaderboardService } from "../src/leaderboard/service";
import { MatchRuntime } from "../src/match/runtime";
import { MatchmakingService } from "../src/matchmaking/service";
import { RecentErrors } from "../src/observability/error-log";
import { MetricsRegistry } from "../src/observability/metrics";
import { NullAnalytics } from "../src/observability/analytics";
import { NullErrorReporting } from "../src/observability/error-reporting";
import { TelemetryService } from "../src/observability/telemetry";
import { TestClock, WINNING_SCRIPT, envelope } from "./helpers/match-fixtures";
import { setupTestDatabase, truncateAll } from "./helpers/test-database";

/**
 * The administrative surface of spec section 16 over HTTP: the role check, the
 * audited mutations and the dashboard read
 * (docs/adr/0029-administration-is-a-role-on-the-account.md).
 */

const config = loadServerConfig({
  APP_ENV: "local",
  APP_VERSION: "7.0.0",
  GIT_SHA: "phase7",
  LOG_LEVEL: "fatal",
});

let handle: DatabaseHandle;
let clock: TestClock;
let app: FastifyInstance;
let runtime: MatchRuntime;
let identity: IdentityService;
let telemetry: TelemetryService;
let queue: MatchmakingService;
let ready = true;
let sockets = 0;
let sequence = 0;

beforeAll(async () => {
  handle = await setupTestDatabase();
});

afterAll(async () => {
  await handle.close();
});

beforeEach(async () => {
  await truncateAll(handle);
  clock = new TestClock();
  ready = true;
  sockets = 0;
  telemetry = new TelemetryService({
    analytics: new NullAnalytics(),
    errors: new NullErrorReporting(),
    metrics: new MetricsRegistry({ appVersion: "7.0.0", gitSha: "phase7", appEnv: "local" }),
    recentErrors: new RecentErrors(),
    pseudonymise: null,
    now: clock.now,
  });
  runtime = new MatchRuntime({ db: handle.db, now: clock.now, telemetry });
  identity = new IdentityService({ db: handle.db, config, now: clock.now });
  queue = new MatchmakingService({ runtime, identity, now: clock.now });
  app = await buildApp({
    config,
    services: {
      runtime,
      guests: new GuestService({ db: handle.db, config, now: clock.now }),
      identity,
      leaderboards: new LeaderboardService({ db: handle.db, now: clock.now }),
      admin: new AdminService({
        db: handle.db,
        config,
        queue,
        telemetry,
        readiness: () => Promise.resolve([{ name: "database", ok: ready }]),
        connectedSockets: () => sockets,
        startedAt: clock.now() - 30_000,
        now: clock.now,
      }),
      db: handle.db,
    },
    telemetry,
    now: clock.now,
  });
});

afterEach(async () => {
  await app.close();
  await restoreCatalogue();
});

/**
 * The catalogue is seeded by a migration and survives truncation, so a suite that
 * edits it puts every entry back the way the protocol defines it.
 */
async function restoreCatalogue(): Promise<void> {
  for (const entry of ACHIEVEMENT_CATALOGUE) {
    const existing = await findAchievementByCode(handle.db, entry.code);
    if (!existing) {
      await insertAchievement(handle.db, {
        code: entry.code,
        name: entry.name,
        description: entry.description,
        badgeAsset: entry.badge,
        ruleVersion: entry.ruleVersion,
        enabled: true,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      });
      continue;
    }
    await updateAchievement(handle.db, existing.id, {
      name: entry.name,
      description: entry.description,
      badgeAsset: entry.badge,
      enabled: true,
    });
  }
}

async function register(name: string): Promise<AuthResponse> {
  sequence += 1;
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: {
      email: `${name}${sequence}@example.com`,
      username: `${name}${sequence}`,
      password: "correct horse battery staple 7",
    },
  });
  expect(response.statusCode).toBe(201);
  return authResponseSchema.parse(response.json());
}

/** An account with the role, which is the only thing that opens the surface. */
async function registerAdmin(): Promise<AuthResponse> {
  const account = await register("root");
  await setUserRole(handle.db, account.account.userId, "admin");
  return account;
}

/** A rated account, which is what a correction and a listing need. */
async function rate(userId: string, rating: number): Promise<void> {
  await upsertRating(handle.db, userId, {
    rating,
    gamesPlayed: 10,
    wins: 5,
    losses: 4,
    draws: 1,
    currentStreak: 1,
    bestStreak: 3,
  });
}

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

async function guestToken(): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/v1/guests", payload: {} });
  return createGuestResponseSchema.parse(response.json()).sessionToken;
}

async function seatedMatch(): Promise<Readonly<{ matchId: string; lightUserId: string }>> {
  const light = await register("light");
  const dark = await register("dark");
  const snapshot = await runtime.createMatch({
    mode: "casual",
    timeControlSeconds: 300,
    light: {
      actorType: "user",
      actorId: light.account.userId,
      displayName: light.account.username,
    },
    dark: { actorType: "user", actorId: dark.account.userId, displayName: dark.account.username },
    pairingWaitMs: 4_000,
  });
  return { matchId: snapshot.matchId, lightUserId: light.account.userId };
}

async function auditActions(): Promise<readonly string[]> {
  const rows = await listAuditRecords(handle.db, {
    action: undefined,
    targetId: undefined,
    limit: 20,
    cursor: null,
  });
  return rows.map((row) => row.action);
}

describe("the role that opens the administrative surface", () => {
  it("refuses an anonymous caller", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/admin/users" });

    expect(response.statusCode).toBe(401);
  });

  it("refuses a player and an administrator identically, revealing nothing", async () => {
    const player = await register("player");
    const guest = await guestToken();

    const asPlayer = await app.inject({
      method: "GET",
      url: "/v1/admin/users",
      headers: auth(player.session.sessionToken),
    });
    const asGuest = await app.inject({
      method: "GET",
      url: "/v1/admin/users",
      headers: auth(guest),
    });

    expect(asPlayer.statusCode).toBe(403);
    expect(asGuest.statusCode).toBe(403);
    const asPlayerError = httpErrorBodySchema.parse(asPlayer.json()).error;
    const asGuestError = httpErrorBodySchema.parse(asGuest.json()).error;
    expect(asPlayerError.code).toBe(asGuestError.code);
    expect(asPlayerError.message).toBe(asGuestError.message);
  });

  it("reads the role from the account on every request", async () => {
    const account = await register("promoted");
    const before = await app.inject({
      method: "GET",
      url: "/v1/admin/users",
      headers: auth(account.session.sessionToken),
    });
    expect(before.statusCode).toBe(403);

    await setUserRole(handle.db, account.account.userId, "admin");
    const after = await app.inject({
      method: "GET",
      url: "/v1/admin/users",
      headers: auth(account.session.sessionToken),
    });

    expect(after.statusCode).toBe(200);
  });

  it("refuses an administrator whose own account is suspended", async () => {
    const root = await registerAdmin();
    const other = await registerAdmin();
    await app.inject({
      method: "POST",
      url: `/v1/admin/users/${other.account.userId}/suspend`,
      headers: auth(root.session.sessionToken),
      payload: { reason: "abuse of the surface" },
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/admin/users",
      headers: auth(other.session.sessionToken),
    });

    expect(response.statusCode).toBe(401);
  });

  it("refuses a request with no body at all, on every route that needs one", async () => {
    const root = await registerAdmin();
    const headers = auth(root.session.sessionToken);
    const id = "9f8c1f3e-3a3a-4a3a-8a3a-3a3a3a3a3a3a";
    const routes = [
      { method: "POST" as const, url: `/v1/admin/users/${id}/suspend` },
      { method: "POST" as const, url: `/v1/admin/users/${id}/reinstate` },
      { method: "POST" as const, url: `/v1/admin/users/${id}/rating` },
      { method: "POST" as const, url: "/v1/admin/achievements" },
      { method: "PATCH" as const, url: `/v1/admin/achievements/${id}` },
    ];

    const statuses = await Promise.all(
      routes.map(async (route) => (await app.inject({ ...route, headers })).statusCode),
    );

    expect(statuses).toEqual(routes.map(() => 400));
    expect(await auditActions()).toEqual([]);
  });

  it("refuses a player at every route of the surface", async () => {
    const player = await register("curious");
    const headers = auth(player.session.sessionToken);
    const id = "9f8c1f3e-3a3a-4a3a-8a3a-3a3a3a3a3a3a";
    const routes = [
      { method: "GET" as const, url: "/v1/admin/users" },
      { method: "GET" as const, url: `/v1/admin/users/${id}` },
      { method: "POST" as const, url: `/v1/admin/users/${id}/suspend` },
      { method: "POST" as const, url: `/v1/admin/users/${id}/reinstate` },
      { method: "POST" as const, url: `/v1/admin/users/${id}/rating` },
      { method: "GET" as const, url: `/v1/admin/matches/${id}` },
      { method: "GET" as const, url: "/v1/admin/matches" },
      { method: "GET" as const, url: "/v1/admin/achievements" },
      { method: "POST" as const, url: "/v1/admin/achievements" },
      { method: "PATCH" as const, url: `/v1/admin/achievements/${id}` },
      { method: "GET" as const, url: "/v1/admin/metrics" },
      { method: "GET" as const, url: "/v1/admin/audit" },
    ];

    const statuses = await Promise.all(
      routes.map(
        async (route) => (await app.inject({ ...route, headers, payload: {} })).statusCode,
      ),
    );

    expect(statuses).toEqual(routes.map(() => 403));
    expect(await auditActions()).toEqual([]);
  });

  it("reports the role on the account, so a client knows to offer the dashboard", async () => {
    const root = await registerAdmin();
    const response = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: auth(root.session.sessionToken),
    });

    expect(response.json()).toMatchObject({ account: { role: "admin" } });
  });
});

describe("GET /v1/admin/users", () => {
  it("lists accounts with the fields the console needs", async () => {
    const root = await registerAdmin();
    const player = await register("searchable");
    await rate(player.account.userId, 1_275);

    const response = await app.inject({
      method: "GET",
      url: "/v1/admin/users",
      headers: auth(root.session.sessionToken),
    });

    const body = adminUserListResponseSchema.parse(response.json());
    expect(body.users.map((user) => user.username)).toContain(player.account.username);
    expect(body.users.find((user) => user.userId === player.account.userId)).toMatchObject({
      status: "active",
      role: "player",
      rating: 1_275,
    });
  });

  it("finds an account by a prefix of its username", async () => {
    const root = await registerAdmin();
    const wanted = await register("zebra");
    await register("aardvark");

    const response = await app.inject({
      method: "GET",
      url: "/v1/admin/users?query=zeb",
      headers: auth(root.session.sessionToken),
    });

    const body = adminUserListResponseSchema.parse(response.json());
    expect(body.users.map((user) => user.username)).toEqual([wanted.account.username]);
  });

  it("filters by status", async () => {
    const root = await registerAdmin();
    const player = await register("suspendable");
    await app.inject({
      method: "POST",
      url: `/v1/admin/users/${player.account.userId}/suspend`,
      headers: auth(root.session.sessionToken),
      payload: { reason: "a rule was broken" },
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/admin/users?status=suspended",
      headers: auth(root.session.sessionToken),
    });

    const body = adminUserListResponseSchema.parse(response.json());
    expect(body.users.map((user) => user.userId)).toEqual([player.account.userId]);
  });

  it("pages with a cursor and stops when the last page is reached", async () => {
    const root = await registerAdmin();
    await register("first");
    await register("second");

    const first = await app.inject({
      method: "GET",
      url: "/v1/admin/users?limit=2",
      headers: auth(root.session.sessionToken),
    });
    const firstPage = adminUserListResponseSchema.parse(first.json());
    expect(firstPage.users).toHaveLength(2);
    expect(firstPage.nextCursor).not.toBeNull();

    const second = await app.inject({
      method: "GET",
      url: `/v1/admin/users?limit=2&cursor=${encodeURIComponent(firstPage.nextCursor ?? "")}`,
      headers: auth(root.session.sessionToken),
    });
    const secondPage = adminUserListResponseSchema.parse(second.json());

    expect(secondPage.users).toHaveLength(1);
    expect(secondPage.nextCursor).toBeNull();
    expect(secondPage.users.map((user) => user.userId)).not.toContain(firstPage.users[0]?.userId);
  });

  it("refuses a query it cannot read", async () => {
    const root = await registerAdmin();
    const response = await app.inject({
      method: "GET",
      url: "/v1/admin/users?limit=900",
      headers: auth(root.session.sessionToken),
    });

    expect(response.statusCode).toBe(400);
    expect(httpErrorBodySchema.parse(response.json()).error.code).toBe("validation_failed");
  });

  it("ignores a cursor that has been tampered with, rather than trusting it", async () => {
    const root = await registerAdmin();
    const tampered = [
      "not-a-cursor",
      Buffer.from("later:", "utf8").toString("base64url"),
      Buffer.from(":an-id", "utf8").toString("base64url"),
    ];

    for (const cursor of tampered) {
      const response = await app.inject({
        method: "GET",
        url: `/v1/admin/users?cursor=${encodeURIComponent(cursor)}`,
        headers: auth(root.session.sessionToken),
      });

      expect(response.statusCode).toBe(200);
      expect(adminUserListResponseSchema.parse(response.json()).users.length).toBeGreaterThan(0);
    }
  });
});

describe("GET /v1/admin/users/:userId", () => {
  it("shows the address, the standing and the moderation history", async () => {
    const root = await registerAdmin();
    const player = await register("detailed");
    await rate(player.account.userId, 1_310);

    const response = await app.inject({
      method: "GET",
      url: `/v1/admin/users/${player.account.userId}`,
      headers: auth(root.session.sessionToken),
    });

    const body = adminUserDetailSchema.parse(response.json());
    expect(body.email).toBe(`detailed${sequence}@example.com`);
    expect(body.ranked?.rating).toBe(1_310);
    expect(body.activeSessions).toBe(1);
    expect(body.moderation).toEqual([]);
  });

  it("answers not found for an account that does not exist", async () => {
    const root = await registerAdmin();
    const response = await app.inject({
      method: "GET",
      url: "/v1/admin/users/9f8c1f3e-3a3a-4a3a-8a3a-3a3a3a3a3a3a",
      headers: auth(root.session.sessionToken),
    });

    expect(response.statusCode).toBe(404);
  });
});

describe("suspension and reinstatement", () => {
  it("refuses a suspension with no reason worth recording", async () => {
    const root = await registerAdmin();
    const player = await register("brief");
    const response = await app.inject({
      method: "POST",
      url: `/v1/admin/users/${player.account.userId}/suspend`,
      headers: auth(root.session.sessionToken),
      payload: { reason: "spam" },
    });

    expect(response.statusCode).toBe(400);
    expect(await auditActions()).toEqual([]);
  });

  it("refuses a reinstatement with no reason worth recording", async () => {
    const root = await registerAdmin();
    const player = await register("terse");
    const response = await app.inject({
      method: "POST",
      url: `/v1/admin/users/${player.account.userId}/reinstate`,
      headers: auth(root.session.sessionToken),
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(await auditActions()).toEqual([]);
  });

  it("suspends an account, revokes its sessions and records the reason", async () => {
    const root = await registerAdmin();
    const player = await register("offender");

    const response = await app.inject({
      method: "POST",
      url: `/v1/admin/users/${player.account.userId}/suspend`,
      headers: auth(root.session.sessionToken),
      payload: { reason: "abusive conduct in a match" },
    });

    const body = adminUserDetailSchema.parse(response.json());
    expect(body.user.status).toBe("suspended");
    expect(body.suspendedReason).toBe("abusive conduct in a match");
    expect(body.activeSessions).toBe(0);
    expect(body.moderation[0]).toMatchObject({
      action: "user-suspended",
      adminUsername: root.account.username,
      reason: "abusive conduct in a match",
    });

    const stillSignedIn = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: auth(player.session.sessionToken),
    });
    expect(stillSignedIn.statusCode).toBe(401);
  });

  it("reinstates an account and keeps both records", async () => {
    const root = await registerAdmin();
    const player = await register("forgiven");
    await app.inject({
      method: "POST",
      url: `/v1/admin/users/${player.account.userId}/suspend`,
      headers: auth(root.session.sessionToken),
      payload: { reason: "a first offence" },
    });
    clock.advance(60_000);

    const response = await app.inject({
      method: "POST",
      url: `/v1/admin/users/${player.account.userId}/reinstate`,
      headers: auth(root.session.sessionToken),
      payload: { reason: "the appeal was accepted" },
    });

    const body = adminUserDetailSchema.parse(response.json());
    expect(body.user.status).toBe("active");
    expect(body.suspendedAt).toBeNull();
    expect(body.moderation.map((entry) => entry.action)).toEqual([
      "user-unsuspended",
      "user-suspended",
    ]);
  });

  it("requires a reason", async () => {
    const root = await registerAdmin();
    const player = await register("unreasoned");

    const response = await app.inject({
      method: "POST",
      url: `/v1/admin/users/${player.account.userId}/suspend`,
      headers: auth(root.session.sessionToken),
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(await auditActions()).toEqual([]);
  });

  it("answers not found for an account that does not exist", async () => {
    const root = await registerAdmin();
    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/users/9f8c1f3e-3a3a-4a3a-8a3a-3a3a3a3a3a3a/reinstate",
      headers: auth(root.session.sessionToken),
      payload: { reason: "nobody is there" },
    });

    expect(response.statusCode).toBe(404);
  });
});

describe("POST /v1/admin/users/:userId/rating", () => {
  it("corrects a rating and records the correction beside the audit record", async () => {
    const root = await registerAdmin();
    const player = await register("misrated");
    await rate(player.account.userId, 1_500);

    const response = await app.inject({
      method: "POST",
      url: `/v1/admin/users/${player.account.userId}/rating`,
      headers: auth(root.session.sessionToken),
      payload: { rating: 1_200, reason: "the pairing was rated in error" },
    });

    expect(adminRatingAdjustResponseSchema.parse(response.json())).toMatchObject({
      userId: player.account.userId,
      ratingBefore: 1_500,
      ratingAfter: 1_200,
    });

    const detail = await app.inject({
      method: "GET",
      url: `/v1/admin/users/${player.account.userId}`,
      headers: auth(root.session.sessionToken),
    });
    expect(adminUserDetailSchema.parse(detail.json()).ranked?.rating).toBe(1_200);
    expect(await auditActions()).toEqual(["rating-adjusted"]);
  });

  it("refuses to correct an account that has never been rated", async () => {
    const root = await registerAdmin();
    const player = await register("unrated");

    const response = await app.inject({
      method: "POST",
      url: `/v1/admin/users/${player.account.userId}/rating`,
      headers: auth(root.session.sessionToken),
      payload: { rating: 1_200, reason: "there is nothing to correct" },
    });

    expect(response.statusCode).toBe(409);
    expect(httpErrorBodySchema.parse(response.json()).error.code).toBe("conflict");
  });

  it("refuses a rating below the floor a display can show", async () => {
    const root = await registerAdmin();
    const player = await register("outofrange");
    await rate(player.account.userId, 1_200);

    const response = await app.inject({
      method: "POST",
      url: `/v1/admin/users/${player.account.userId}/rating`,
      headers: auth(root.session.sessionToken),
      payload: { rating: -50, reason: "a typing mistake" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("answers not found for an account that does not exist", async () => {
    const root = await registerAdmin();
    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/users/9f8c1f3e-3a3a-4a3a-8a3a-3a3a3a3a3a3a/rating",
      headers: auth(root.session.sessionToken),
      payload: { rating: 1_200, reason: "nobody is there" },
    });

    expect(response.statusCode).toBe(404);
  });
});

describe("the match inspector", () => {
  it("lists the matches that are still running", async () => {
    const root = await registerAdmin();
    const match = await seatedMatch();

    const response = await app.inject({
      method: "GET",
      url: "/v1/admin/matches",
      headers: auth(root.session.sessionToken),
    });

    const body = adminActiveMatchesResponseSchema.parse(response.json());
    expect(body.matches.map((entry) => entry.matchId)).toEqual([match.matchId]);
    expect(body.matches[0]).toMatchObject({ mode: "casual", status: "active", version: 0 });
  });

  it("reports a match that has not started as having no start", async () => {
    const root = await registerAdmin();
    const light = await register("waitinglight");
    const dark = await register("waitingdark");
    await insertMatch(handle.db, {
      mode: "casual",
      timeControlSeconds: 300,
      status: "active",
      lightPlayerType: "user",
      lightPlayerId: light.account.userId,
      lightDisplayName: light.account.username,
      darkPlayerType: "user",
      darkPlayerId: dark.account.userId,
      darkDisplayName: dark.account.username,
      gameState: { version: 1, ply: 0 },
      stateVersion: 0,
      lightRemainingMs: 300_000,
      darkRemainingMs: 300_000,
      activePlayer: "light",
      createdAt: new Date(clock.now()),
      startedAt: null,
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/admin/matches",
      headers: auth(root.session.sessionToken),
    });

    expect(
      adminActiveMatchesResponseSchema.parse(response.json()).matches[0]?.startedAt,
    ).toBeNull();
  });

  it("shows every event of one match with its state hash", async () => {
    const root = await registerAdmin();
    const match = await seatedMatch();
    const snapshot = await runtime.getSnapshotForActor(match.matchId, {
      actorType: "user",
      actorId: match.lightUserId,
    });
    expect(snapshot).not.toBeNull();
    const light = { actorType: "user" as const, actorId: match.lightUserId };
    await runtime.applyMoveCommand(light, {
      ...envelope(match.matchId, 0),
      payload: { move: WINNING_SCRIPT[0] as never },
    });

    const response = await app.inject({
      method: "GET",
      url: `/v1/admin/matches/${match.matchId}`,
      headers: auth(root.session.sessionToken),
    });

    const body = adminMatchDetailSchema.parse(response.json());
    expect(body.version).toBe(1);
    expect(body.events.map((event) => event.type)).toEqual(["match-created", "move"]);
    expect(body.events[1]?.stateHash).toMatch(/^[0-9a-f]{64}$/);
    expect(body.events[1]?.payload).toMatchObject({ move: { kind: "reserve", to: "r0c0" } });
    expect(body.connections).toEqual([]);
  });

  it("shows the connection history a socket wrote", async () => {
    const root = await registerAdmin();
    const match = await seatedMatch();
    await runtime.recordConnectionEvent({
      matchId: match.matchId,
      kind: "attached",
      actor: { actorType: "user", actorId: match.lightUserId },
      socketId: "aVerySmallSocketId",
    });
    await runtime.recordConnectionEvent({
      matchId: match.matchId,
      kind: "detached",
      actor: { actorType: "user", actorId: match.lightUserId },
      socketId: "aVerySmallSocketId",
      reason: "transport close",
    });

    const response = await app.inject({
      method: "GET",
      url: `/v1/admin/matches/${match.matchId}`,
      headers: auth(root.session.sessionToken),
    });

    const body = adminMatchDetailSchema.parse(response.json());
    expect(body.connections.map((event) => event.kind)).toEqual(["attached", "detached"]);
    expect(body.connections[1]?.reason).toBe("transport close");
  });

  it("answers not found for a match that does not exist", async () => {
    const root = await registerAdmin();
    const response = await app.inject({
      method: "GET",
      url: "/v1/admin/matches/9f8c1f3e-3a3a-4a3a-8a3a-3a3a3a3a3a3a",
      headers: auth(root.session.sessionToken),
    });

    expect(response.statusCode).toBe(404);
  });
});

describe("the achievement catalogue", () => {
  it("lists the catalogue with how many accounts hold each badge", async () => {
    const root = await registerAdmin();
    const response = await app.inject({
      method: "GET",
      url: "/v1/admin/achievements",
      headers: auth(root.session.sessionToken),
    });

    const body = adminAchievementListResponseSchema.parse(response.json());
    expect(body.achievements.length).toBeGreaterThan(0);
    expect(body.achievements.every((entry) => entry.awarded === 0)).toBe(true);
  });

  it("refuses a code the server has no rule for", async () => {
    const root = await registerAdmin();
    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/achievements",
      headers: auth(root.session.sessionToken),
      payload: {
        code: "invented-by-an-administrator",
        name: "Invented",
        description: "Nothing can earn this.",
        badge: "bronze",
        reason: "an experiment",
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("refuses a code that already has a row", async () => {
    const root = await registerAdmin();
    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/achievements",
      headers: auth(root.session.sessionToken),
      payload: {
        code: "first-victory",
        name: "First victory",
        description: "Win a match.",
        badge: "bronze",
        reason: "a duplicate",
      },
    });

    expect(response.statusCode).toBe(409);
  });

  it("creates a row for a rule that has none, audited", async () => {
    const root = await registerAdmin();
    await deleteAchievementByCode(handle.db, "first-victory");

    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/achievements",
      headers: auth(root.session.sessionToken),
      payload: {
        code: "first-victory",
        name: "First victory",
        description: "Win your first match.",
        badge: "bronze",
        reason: "restoring the catalogue",
      },
    });

    expect(adminAchievementSchema.parse(response.json())).toMatchObject({
      code: "first-victory",
      enabled: true,
      awarded: 0,
      ruleVersion: ACHIEVEMENT_RULE_VERSION,
    });
    expect(await auditActions()).toEqual(["achievement-created"]);
  });

  it("updates a row and records what changed", async () => {
    const root = await registerAdmin();
    const listed = await app.inject({
      method: "GET",
      url: "/v1/admin/achievements",
      headers: auth(root.session.sessionToken),
    });
    const first = adminAchievementListResponseSchema.parse(listed.json()).achievements[0];
    expect(first).toBeDefined();

    const response = await app.inject({
      method: "PATCH",
      url: `/v1/admin/achievements/${first?.achievementId ?? ""}`,
      headers: auth(root.session.sessionToken),
      payload: { description: "A clearer description.", enabled: false, reason: "clearer wording" },
    });

    expect(adminAchievementSchema.parse(response.json())).toMatchObject({
      description: "A clearer description.",
      enabled: false,
    });

    const audit = await app.inject({
      method: "GET",
      url: "/v1/admin/audit",
      headers: auth(root.session.sessionToken),
    });
    const entries = adminAuditResponseSchema.parse(audit.json()).entries;
    expect(entries[0]).toMatchObject({
      action: "achievement-updated",
      targetType: "achievement",
      after: { description: "A clearer description.", enabled: false },
    });
  });

  it("renames a row without touching what was not sent", async () => {
    const root = await registerAdmin();
    const listed = await app.inject({
      method: "GET",
      url: "/v1/admin/achievements",
      headers: auth(root.session.sessionToken),
    });
    const first = adminAchievementListResponseSchema.parse(listed.json()).achievements[0];

    const response = await app.inject({
      method: "PATCH",
      url: `/v1/admin/achievements/${first?.achievementId ?? ""}`,
      headers: auth(root.session.sessionToken),
      payload: { name: "A Better Name", badge: "gold", reason: "a better name for it" },
    });

    expect(adminAchievementSchema.parse(response.json())).toMatchObject({
      name: "A Better Name",
      badge: "gold",
      description: first?.description,
      enabled: first?.enabled,
    });
  });

  it("refuses an update with nothing in it", async () => {
    const root = await registerAdmin();
    const response = await app.inject({
      method: "PATCH",
      url: "/v1/admin/achievements/9f8c1f3e-3a3a-4a3a-8a3a-3a3a3a3a3a3a",
      headers: auth(root.session.sessionToken),
      payload: { reason: "nothing at all to say" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("answers not found for an achievement that does not exist", async () => {
    const root = await registerAdmin();
    const response = await app.inject({
      method: "PATCH",
      url: "/v1/admin/achievements/9f8c1f3e-3a3a-4a3a-8a3a-3a3a3a3a3a3a",
      headers: auth(root.session.sessionToken),
      payload: { enabled: false, reason: "nobody is there" },
    });

    expect(response.statusCode).toBe(404);
  });
});

describe("GET /v1/admin/audit", () => {
  it("names the administrator who acted and what changed", async () => {
    const root = await registerAdmin();
    const player = await register("audited");
    await app.inject({
      method: "POST",
      url: `/v1/admin/users/${player.account.userId}/suspend`,
      headers: auth(root.session.sessionToken),
      payload: { reason: "a rule was broken" },
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/admin/audit",
      headers: auth(root.session.sessionToken),
    });

    const body = adminAuditResponseSchema.parse(response.json());
    expect(body.entries[0]).toMatchObject({
      action: "user-suspended",
      adminUsername: root.account.username,
      targetType: "user",
      targetId: player.account.userId,
      targetLabel: player.account.username,
      before: { status: "active" },
      after: { status: "suspended" },
      reason: "a rule was broken",
    });
  });

  it("filters by action and by target", async () => {
    const root = await registerAdmin();
    const first = await register("subject");
    const second = await register("bystander");
    for (const account of [first, second]) {
      await app.inject({
        method: "POST",
        url: `/v1/admin/users/${account.account.userId}/suspend`,
        headers: auth(root.session.sessionToken),
        payload: { reason: "a rule was broken" },
      });
    }

    const byAction = await app.inject({
      method: "GET",
      url: "/v1/admin/audit?action=user-unsuspended",
      headers: auth(root.session.sessionToken),
    });
    expect(adminAuditResponseSchema.parse(byAction.json()).entries).toEqual([]);

    const byTarget = await app.inject({
      method: "GET",
      url: `/v1/admin/audit?targetId=${first.account.userId}`,
      headers: auth(root.session.sessionToken),
    });
    const entries = adminAuditResponseSchema.parse(byTarget.json()).entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.targetId).toBe(first.account.userId);
  });

  it("pages the log", async () => {
    const root = await registerAdmin();
    const player = await register("repeatedly");
    for (const reason of ["first", "second", "third"]) {
      await app.inject({
        method: "POST",
        url: `/v1/admin/users/${player.account.userId}/suspend`,
        headers: auth(root.session.sessionToken),
        payload: { reason: `${reason} offence` },
      });
      clock.advance(1_000);
    }

    const first = await app.inject({
      method: "GET",
      url: "/v1/admin/audit?limit=2",
      headers: auth(root.session.sessionToken),
    });
    const firstPage = adminAuditResponseSchema.parse(first.json());
    expect(firstPage.entries).toHaveLength(2);

    const second = await app.inject({
      method: "GET",
      url: `/v1/admin/audit?limit=2&cursor=${encodeURIComponent(firstPage.nextCursor ?? "")}`,
      headers: auth(root.session.sessionToken),
    });
    const secondPage = adminAuditResponseSchema.parse(second.json());

    expect(secondPage.entries).toHaveLength(1);
    expect(secondPage.nextCursor).toBeNull();
  });

  it("refuses an action it does not know", async () => {
    const root = await registerAdmin();
    const response = await app.inject({
      method: "GET",
      url: "/v1/admin/audit?action=deleted-the-database",
      headers: auth(root.session.sessionToken),
    });

    expect(response.statusCode).toBe(400);
  });
});

describe("GET /v1/admin/metrics", () => {
  it("summarises the day, the queue and this process", async () => {
    const root = await registerAdmin();
    await seatedMatch();
    sockets = 3;
    telemetry.recordFailure("not_found", "/v1/matches/:matchId");

    const response = await app.inject({
      method: "GET",
      url: "/v1/admin/metrics",
      headers: auth(root.session.sessionToken),
    });

    const body = adminMetricsSummarySchema.parse(response.json());
    expect(body.deployment).toMatchObject({
      appVersion: "7.0.0",
      gitSha: "phase7",
      appEnv: "local",
      uptimeSeconds: 30,
    });
    expect(body.health).toEqual({ ready: true, checks: [{ name: "database", ok: true }] });
    expect(body.matches.active).toBe(1);
    expect(body.matches.completionRate).toBeNull();
    expect(body.matchmaking.pairings).toBe(1);
    expect(body.matchmaking.averageWaitMs).toBe(4_000);
    expect(body.sockets.connected).toBe(3);
    expect(body.errors.total).toBe(1);
    expect(body.errors.recent[0]).toMatchObject({ code: "not_found", count: 1 });
    expect(body.clientVersions).toEqual([]);
  });

  it("reports a failing dependency as not ready", async () => {
    const root = await registerAdmin();
    ready = false;

    const response = await app.inject({
      method: "GET",
      url: "/v1/admin/metrics",
      headers: auth(root.session.sessionToken),
    });

    expect(adminMetricsSummarySchema.parse(response.json()).health.ready).toBe(false);
  });

  it("reports the completion and abandonment of the matches that finished", async () => {
    const root = await registerAdmin();
    const light = await register("winner");
    const dark = await register("loser");
    const players = {
      light: {
        actorType: "user" as const,
        actorId: light.account.userId,
        displayName: light.account.username,
      },
      dark: {
        actorType: "user" as const,
        actorId: dark.account.userId,
        displayName: dark.account.username,
      },
    };
    for (const finished of [
      { status: "completed" as const, result: "light" as const, endReason: "line" as const },
      { status: "aborted" as const, result: null, endReason: "admin" as const },
    ]) {
      await insertMatch(handle.db, {
        mode: "casual",
        timeControlSeconds: 300,
        ...finished,
        lightPlayerType: "user",
        lightPlayerId: light.account.userId,
        lightDisplayName: players.light.displayName,
        darkPlayerType: "user",
        darkPlayerId: dark.account.userId,
        darkDisplayName: players.dark.displayName,
        gameState: { version: 1, ply: 0 },
        stateVersion: 1,
        lightRemainingMs: 300_000,
        darkRemainingMs: 300_000,
        activePlayer: "light",
        createdAt: new Date(clock.now()),
        startedAt: new Date(clock.now()),
        endedAt: new Date(clock.now()),
      });
    }

    const response = await app.inject({
      method: "GET",
      url: "/v1/admin/metrics",
      headers: auth(root.session.sessionToken),
    });

    const body = adminMetricsSummarySchema.parse(response.json());
    expect(body.matches).toMatchObject({ completed: 1, aborted: 1 });
    expect(body.matches.completionRate).toBeCloseTo(0.5);
    expect(body.matches.abandonmentRate).toBeCloseTo(0.5);
    expect(body.matches.byEndReason).toEqual([
      { reason: "line", count: 1 },
      { reason: "admin", count: 1 },
    ]);
    expect(body.activity.dailyActiveAccounts).toBeGreaterThan(0);
  });

  it("reports the queue as it stands at the moment of the request", async () => {
    const root = await registerAdmin();
    const waiting = await register("waiting");
    await queue.join(
      { actor: { actorType: "user", actorId: waiting.account.userId }, displayName: "waiting" },
      { mode: "casual", timeControlSeconds: 300 },
    );

    const response = await app.inject({
      method: "GET",
      url: "/v1/admin/metrics",
      headers: auth(root.session.sessionToken),
    });

    expect(adminMetricsSummarySchema.parse(response.json()).matchmaking.queueDepth).toEqual([
      { mode: "casual", timeControlSeconds: 300, waiting: 1 },
    ]);
  });
});
