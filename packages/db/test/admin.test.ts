import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  countActiveActors,
  countActiveSessions,
  insertGuestSession,
  insertMatch,
  insertUser,
  insertUserSession,
  searchUsers,
  setUserRole,
  setUserSuspension,
  summariseMatches,
  summarisePairings,
  touchUser,
  upsertRating,
} from "../src/index";
import type { DatabaseHandle, NewMatchRow, UserRow } from "../src/index";
import { guestFixture, matchFixture, userFixture } from "./helpers/fixtures";
import { setupTestDatabase, truncateAll } from "./helpers/test-database";

let handle: DatabaseHandle;

beforeAll(async () => {
  handle = await setupTestDatabase();
});

afterEach(async () => {
  await truncateAll(handle);
});

afterAll(async () => {
  await handle.close();
});

const HOUR = 60 * 60 * 1000;

async function createUser(username: string, seenAt?: Date): Promise<UserRow> {
  const user = await insertUser(
    handle.db,
    userFixture({ username, usernameNormalized: username.toLowerCase() }),
  );
  if (seenAt !== undefined) {
    await touchUser(handle.db, user.id, seenAt);
  }
  return user;
}

async function finishedMatch(overrides: Partial<NewMatchRow>): Promise<void> {
  await insertMatch(handle.db, matchFixture(overrides));
}

describe("searching for an account", () => {
  it("matches a username prefix, case insensitively", async () => {
    await createUser("Willow_Grey");
    await createUser("othername");

    const found = await searchUsers(handle.db, { query: "will", limit: 10 });
    expect(found.map((row) => row.username)).toEqual(["Willow_Grey"]);
  });

  it("matches an address in full but not in part", async () => {
    const user = await createUser("addressed_one");

    expect(
      (await searchUsers(handle.db, { query: "ADDRESSED_ONE@example.com", limit: 10 })).map(
        (row) => row.userId,
      ),
    ).toEqual([user.id]);
    expect(await searchUsers(handle.db, { query: "@example.com", limit: 10 })).toEqual([]);
  });

  it("matches an internal id", async () => {
    const user = await createUser("by_id");

    const found = await searchUsers(handle.db, { query: user.id, limit: 10 });
    expect(found.map((row) => row.userId)).toEqual([user.id]);
  });

  it("treats a wildcard in the term as an ordinary character", async () => {
    await createUser("percent_free");

    expect(await searchUsers(handle.db, { query: "%", limit: 10 })).toEqual([]);
  });

  it("reports the status, the role, the rating and whether the address is verified", async () => {
    const user = await createUser("described_one");
    await setUserRole(handle.db, user.id, "admin");
    await upsertRating(handle.db, user.id, {
      rating: 1620,
      gamesPlayed: 9,
      wins: 5,
      losses: 3,
      draws: 1,
      currentStreak: 1,
      bestStreak: 2,
    });

    const [found] = await searchUsers(handle.db, { query: "described", limit: 10 });
    expect(found).toMatchObject({
      username: "described_one",
      status: "active",
      role: "admin",
      emailVerified: false,
      rating: 1620,
    });
    expect(found?.createdAt).toBeInstanceOf(Date);
  });

  it("reports no rating for an account that has never played ranked", async () => {
    await createUser("unrated_one");

    const [found] = await searchUsers(handle.db, { query: "unrated", limit: 10 });
    expect(found?.rating).toBeNull();
  });

  it("filters by status", async () => {
    await createUser("active_one");
    const suspended = await createUser("suspended_one");
    await setUserSuspension(handle.db, suspended.id, {
      status: "suspended",
      suspendedAt: new Date(),
      suspendedReason: "Abusive preset message spam in ranked matches.",
    });

    const found = await searchUsers(handle.db, { status: "suspended", limit: 10 });
    expect(found.map((row) => row.username)).toEqual(["suspended_one"]);
  });

  it("lists the most recently seen accounts first and pages by that order", async () => {
    const now = Date.now();
    await createUser("seen_first", new Date(now - 3 * HOUR));
    await createUser("seen_second", new Date(now - 2 * HOUR));
    await createUser("seen_third", new Date(now - HOUR));

    const first = await searchUsers(handle.db, { limit: 2 });
    expect(first.map((row) => row.username)).toEqual(["seen_third", "seen_second"]);

    const boundary = first[1];
    if (boundary === undefined) {
      throw new Error("expected two accounts");
    }
    const second = await searchUsers(handle.db, {
      limit: 2,
      cursor: { lastSeenAt: boundary.lastSeenAt, userId: boundary.userId },
    });
    expect(second.map((row) => row.username)).toEqual(["seen_first"]);
  });
});

describe("the sessions an account can still use", () => {
  it("counts the live ones only", async () => {
    const user = await createUser("session_holder");
    const now = new Date();
    await insertUserSession(handle.db, {
      userId: user.id,
      tokenHash: `live-${randomUUID()}`,
      expiresAt: new Date(now.getTime() + HOUR),
    });
    await insertUserSession(handle.db, {
      userId: user.id,
      tokenHash: `expired-${randomUUID()}`,
      expiresAt: new Date(now.getTime() - HOUR),
    });
    await insertUserSession(handle.db, {
      userId: user.id,
      tokenHash: `revoked-${randomUUID()}`,
      expiresAt: new Date(now.getTime() + HOUR),
      revokedAt: now,
    });

    expect(await countActiveSessions(handle.db, user.id, now)).toBe(1);
  });

  it("counts none for an account that has never signed in", async () => {
    const user = await createUser("never_signed_in");

    expect(await countActiveSessions(handle.db, user.id, new Date())).toBe(0);
  });
});

describe("who was active in the window", () => {
  it("counts accounts and guests separately", async () => {
    const now = Date.now();
    await createUser("recent_one", new Date(now - HOUR));
    await createUser("stale_one", new Date(now - 48 * HOUR));
    await insertGuestSession(handle.db, guestFixture("guest-recent"));

    const activity = await countActiveActors(handle.db, new Date(now - 24 * HOUR));
    expect(activity).toEqual({ accounts: 1, guests: 1 });
  });
});

describe("the match figures behind the dashboard", () => {
  it("counts what is in flight now and what finished in the window", async () => {
    const now = Date.now();
    await finishedMatch({ status: "active", startedAt: new Date(now - HOUR) });
    await finishedMatch({
      status: "completed",
      result: "light",
      endReason: "line",
      endedAt: new Date(now - 2 * HOUR),
    });
    await finishedMatch({
      status: "completed",
      result: "dark",
      endReason: "timeout",
      endedAt: new Date(now - 3 * HOUR),
    });
    await finishedMatch({
      status: "aborted",
      endReason: "admin",
      endedAt: new Date(now - 4 * HOUR),
    });
    await finishedMatch({
      status: "completed",
      result: "draw",
      endReason: "repetition",
      endedAt: new Date(now - 40 * HOUR),
    });

    const summary = await summariseMatches(handle.db, new Date(now - 24 * HOUR));
    expect(summary).toMatchObject({ active: 1, completed: 2, aborted: 1 });
    expect(summary.byEndReason).toEqual([
      { reason: "line", count: 1 },
      { reason: "timeout", count: 1 },
      { reason: "admin", count: 1 },
    ]);
  });

  it("averages the waits of the pairings made in the window", async () => {
    const now = Date.now();
    await finishedMatch({ pairingWaitMs: 1_000, createdAt: new Date(now - HOUR) });
    await finishedMatch({ pairingWaitMs: 2_001, createdAt: new Date(now - 2 * HOUR) });
    await finishedMatch({ pairingWaitMs: 90_000, createdAt: new Date(now - 40 * HOUR) });
    await finishedMatch({ createdAt: new Date(now - HOUR) });

    expect(await summarisePairings(handle.db, new Date(now - 24 * HOUR))).toEqual({
      pairings: 2,
      averageWaitMs: 1_501,
    });
  });

  it("reports no average when nothing was paired", async () => {
    expect(await summarisePairings(handle.db, new Date())).toEqual({
      pairings: 0,
      averageWaitMs: null,
    });
  });

  it("reports zeroes on an empty database", async () => {
    expect(await summariseMatches(handle.db, new Date())).toEqual({
      active: 0,
      completed: 0,
      aborted: 0,
      byEndReason: [],
    });
    expect(await countActiveActors(handle.db, new Date())).toEqual({ accounts: 0, guests: 0 });
  });
});
