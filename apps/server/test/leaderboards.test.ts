import { loadServerConfig } from "@gobblet/config";
import type { ServerConfig } from "@gobblet/config";
import {
  insertMatch,
  insertProfile,
  insertRatingChanges,
  insertUser,
  upsertRating,
} from "@gobblet/db";
import type { DatabaseHandle, UserRow } from "@gobblet/db";
import {
  encodeLeaderboardCursor,
  httpErrorBodySchema,
  leaderboardResponseSchema,
} from "@gobblet/protocol";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { GuestService } from "../src/guests/service";
import { IdentityService } from "../src/identity/service";
import { leaderboardWindow } from "../src/leaderboard/periods";
import { readAllTimeRank } from "../src/leaderboard/rank";
import { LeaderboardService } from "../src/leaderboard/service";
import { MatchRuntime } from "../src/match/runtime";
import { createSilentTelemetry } from "../src/observability/telemetry";
import { adminServiceFixture, releaseServiceFixture } from "./helpers/admin-service";
import { TestClock } from "./helpers/match-fixtures";
import { setupTestDatabase, truncateAll } from "./helpers/test-database";

const config: ServerConfig = loadServerConfig({
  APP_ENV: "local",
  APP_VERSION: "9.9.9",
  GIT_SHA: "testsha",
  LOG_LEVEL: "fatal",
});

/** A Wednesday, so the ISO week of the fixture clock starts two days earlier. */
const WEDNESDAY = Date.parse("2026-07-15T12:00:00.000Z");

let handle: DatabaseHandle;
let clock: TestClock;
let leaderboards: LeaderboardService;
let app: FastifyInstance;
let sequence = 0;

beforeAll(async () => {
  handle = await setupTestDatabase();
});

afterAll(async () => {
  await handle.close();
});

beforeEach(async () => {
  await truncateAll(handle);
  clock = new TestClock(WEDNESDAY);
  leaderboards = new LeaderboardService({ db: handle.db, now: clock.now });
  const runtime = new MatchRuntime({ db: handle.db, now: clock.now });
  const identity = new IdentityService({ db: handle.db, config, now: clock.now });
  app = await buildApp({
    config,
    services: {
      runtime,
      guests: new GuestService({ db: handle.db, config, now: clock.now }),
      identity,
      leaderboards,
      admin: adminServiceFixture({ db: handle.db, config, runtime, identity, now: clock.now }),
      releases: releaseServiceFixture({ db: handle.db, now: clock.now }),
      db: handle.db,
    },
    telemetry: createSilentTelemetry(),
    now: clock.now,
  });
});

afterEach(async () => {
  await app.close();
});

async function createRated(
  rating: number,
  extras: Readonly<{ wins?: number; games?: number }> = {},
): Promise<UserRow> {
  sequence += 1;
  const username = `player${sequence}`;
  const user = await insertUser(handle.db, {
    email: `${username}@example.com`,
    passwordHash: "scrypt$32768$8$1$placeholder$placeholder",
    username,
    usernameNormalized: username,
    displayName: username,
  });
  await insertProfile(handle.db, { userId: user.id, countryCode: "GB" });
  await upsertRating(handle.db, user.id, {
    rating,
    gamesPlayed: extras.games ?? 1,
    wins: extras.wins ?? 1,
    losses: 0,
    draws: 0,
    currentStreak: 1,
    bestStreak: 1,
  });
  return user;
}

/** One rating audit row, which is what a period board counts its members by. */
async function recordRankedResult(
  user: UserRow,
  outcome: "win" | "loss",
  at: number,
): Promise<void> {
  const match = await insertMatch(handle.db, {
    mode: "ranked",
    timeControlSeconds: 300,
    status: "completed",
    result: outcome === "win" ? "light" : "dark",
    endReason: "line",
    lightPlayerType: "user",
    lightPlayerId: user.id,
    lightDisplayName: user.displayName,
    darkPlayerType: "guest",
    darkPlayerId: "22222222-2222-4222-8222-222222222222",
    darkDisplayName: "guest-1",
    gameState: { version: 1, ply: 0 },
    stateVersion: 1,
    lightRemainingMs: 1_000,
    darkRemainingMs: 1_000,
    activePlayer: "light",
  });

  await insertRatingChanges(handle.db, [
    {
      matchId: match.id,
      userId: user.id,
      side: "light",
      outcome,
      ratingBefore: 1200,
      ratingAfter: 1200,
      delta: 0,
      opponentRatingBefore: 1200,
      formulaVersion: 1,
      createdAt: new Date(at),
    },
  ]);
}

describe("leaderboard periods", () => {
  it("bounds the day, the ISO week from Monday and the calendar month in UTC", () => {
    expect(leaderboardWindow("daily", WEDNESDAY)).toEqual({
      start: new Date("2026-07-15T00:00:00.000Z"),
      end: new Date("2026-07-16T00:00:00.000Z"),
    });
    expect(leaderboardWindow("weekly", WEDNESDAY)).toEqual({
      start: new Date("2026-07-13T00:00:00.000Z"),
      end: new Date("2026-07-20T00:00:00.000Z"),
    });
    expect(leaderboardWindow("monthly", WEDNESDAY)).toEqual({
      start: new Date("2026-07-01T00:00:00.000Z"),
      end: new Date("2026-08-01T00:00:00.000Z"),
    });
    expect(leaderboardWindow("all-time", WEDNESDAY)).toBeNull();
  });

  it("keeps a Sunday in the week that began on the Monday before it", () => {
    expect(leaderboardWindow("weekly", Date.parse("2026-07-19T23:00:00.000Z"))).toEqual({
      start: new Date("2026-07-13T00:00:00.000Z"),
      end: new Date("2026-07-20T00:00:00.000Z"),
    });
    expect(leaderboardWindow("weekly", Date.parse("2026-07-20T00:00:00.000Z"))).toEqual({
      start: new Date("2026-07-20T00:00:00.000Z"),
      end: new Date("2026-07-27T00:00:00.000Z"),
    });
  });

  it("crosses a month and a year boundary rather than clamping", () => {
    expect(leaderboardWindow("daily", Date.parse("2026-12-31T18:00:00.000Z"))).toEqual({
      start: new Date("2026-12-31T00:00:00.000Z"),
      end: new Date("2027-01-01T00:00:00.000Z"),
    });
    expect(leaderboardWindow("monthly", Date.parse("2026-12-05T00:00:00.000Z"))).toEqual({
      start: new Date("2026-12-01T00:00:00.000Z"),
      end: new Date("2027-01-01T00:00:00.000Z"),
    });
  });
});

describe("GET /v1/leaderboards", () => {
  it("ranks rated accounts by rating and defaults to the all-time board", async () => {
    await createRated(1300);
    await createRated(1500);
    await createRated(1400);

    const response = await app.inject({ method: "GET", url: "/v1/leaderboards" });

    expect(response.statusCode).toBe(200);
    const board = leaderboardResponseSchema.parse(response.json());
    expect(board.period).toBe("all-time");
    expect(board.periodStart).toBeNull();
    expect(board.generatedAt).toBe(new Date(WEDNESDAY).toISOString());
    expect(board.entries.map((entry) => entry.rating)).toEqual([1500, 1400, 1300]);
    expect(board.entries.map((entry) => entry.rank)).toEqual([1, 2, 3]);
    expect(board.you).toBeNull();
    expect(board.nextCursor).toBeNull();
  });

  it("counts only the ranked results inside a period, and bounds the period", async () => {
    const thisWeek = await createRated(1500);
    const lastWeek = await createRated(1600);
    await recordRankedResult(thisWeek, "win", WEDNESDAY);
    await recordRankedResult(lastWeek, "win", Date.parse("2026-07-06T12:00:00.000Z"));

    const response = await app.inject({ method: "GET", url: "/v1/leaderboards?period=weekly" });

    const board = leaderboardResponseSchema.parse(response.json());
    expect(board.periodStart).toBe("2026-07-13T00:00:00.000Z");
    expect(board.periodEnd).toBe("2026-07-20T00:00:00.000Z");
    expect(board.entries).toHaveLength(1);
    expect(board.entries[0]).toMatchObject({ rank: 1, username: thisWeek.username, wins: 1 });
  });

  it("pages with a cursor over the composite key rather than an offset", async () => {
    await createRated(1500);
    await createRated(1400);
    await createRated(1300);

    const first = leaderboardResponseSchema.parse(
      (await app.inject({ method: "GET", url: "/v1/leaderboards?limit=2" })).json(),
    );
    const second = leaderboardResponseSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: `/v1/leaderboards?limit=2&cursor=${encodeURIComponent(first.nextCursor ?? "")}`,
        })
      ).json(),
    );

    expect(first.entries.map((entry) => entry.rating)).toEqual([1500, 1400]);
    expect(first.nextCursor).not.toBeNull();
    expect(second.entries.map((entry) => entry.rating)).toEqual([1300]);
    expect(second.entries[0]?.rank).toBe(3);
    expect(second.nextCursor).toBeNull();
  });

  it("shows the caller their own row even when it falls outside the page", async () => {
    await createRated(1500);
    await createRated(1400);
    const registered = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email: "ada@example.com", password: "correct-horse-7", username: "ada" },
    });
    const session = registered.json().session.sessionToken as string;
    await upsertRating(handle.db, registered.json().account.userId as string, {
      rating: 1100,
      gamesPlayed: 2,
      wins: 0,
      losses: 2,
      draws: 0,
      currentStreak: -2,
      bestStreak: 0,
    });

    const board = leaderboardResponseSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: "/v1/leaderboards?limit=1",
          headers: { authorization: `Bearer ${session}` },
        })
      ).json(),
    );

    expect(board.entries.map((entry) => entry.rating)).toEqual([1500]);
    expect(board.you).toMatchObject({ rank: 3, username: "ada", rating: 1100 });
  });

  it("has no own row for a guest, who has no rating", async () => {
    await createRated(1500);
    const guest = await app.inject({ method: "POST", url: "/v1/guests", payload: {} });

    const board = leaderboardResponseSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: "/v1/leaderboards",
          headers: { authorization: `Bearer ${guest.json().sessionToken as string}` },
        })
      ).json(),
    );

    expect(board.you).toBeNull();
  });

  it("refuses an unknown period, an oversized page and a tampered cursor", async () => {
    const period = await app.inject({ method: "GET", url: "/v1/leaderboards?period=hourly" });
    const limit = await app.inject({ method: "GET", url: "/v1/leaderboards?limit=1000" });
    const cursor = await app.inject({ method: "GET", url: "/v1/leaderboards?cursor=nonsense" });

    expect(period.statusCode).toBe(400);
    expect(httpErrorBodySchema.parse(period.json()).error.code).toBe("validation_failed");
    expect(limit.statusCode).toBe(400);
    expect(cursor.statusCode).toBe(400);
  });

  it("accepts a well-formed cursor for a row that is no longer there", async () => {
    await createRated(1500);
    const stale = encodeLeaderboardCursor({
      rating: 4000,
      wins: 0,
      games: 0,
      ratedAt: WEDNESDAY,
      userId: "11111111-1111-4111-8111-111111111111",
    });

    const board = leaderboardResponseSchema.parse(
      (await app.inject({ method: "GET", url: `/v1/leaderboards?cursor=${stale}` })).json(),
    );

    expect(board.entries.map((entry) => entry.rating)).toEqual([1500]);
  });
});

describe("the leaderboard service", () => {
  it("reads the wall clock when no clock is injected", async () => {
    const before = Date.now();
    const board = await new LeaderboardService({ db: handle.db }).read({ period: "daily" });

    expect(new Date(board.generatedAt).getTime()).toBeGreaterThanOrEqual(before);
  });
});

describe("the all-time rank of one account", () => {
  it("is the position on the board, and nothing for an unrated account", async () => {
    await createRated(1500);
    const second = await createRated(1400);
    const unrated = await insertUser(handle.db, {
      email: "grace@example.com",
      passwordHash: "scrypt$32768$8$1$placeholder$placeholder",
      username: "grace",
      usernameNormalized: "grace",
      displayName: "grace",
    });

    expect(await readAllTimeRank(handle.db, second.id)).toBe(2);
    expect(await readAllTimeRank(handle.db, unrated.id)).toBeNull();
  });
});
