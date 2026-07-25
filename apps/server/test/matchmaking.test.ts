import { loadServerConfig } from "@gobblet/config";
import type { ServerConfig } from "@gobblet/config";
import { findMatchById, upsertRating } from "@gobblet/db";
import type { DatabaseHandle, UserRow } from "@gobblet/db";
import { STARTING_RATING } from "@gobblet/protocol";
import type { QueueKey } from "@gobblet/protocol";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GuestService } from "../src/guests/service";
import { IdentityService } from "../src/identity/service";
import { MatchRuntime } from "../src/match/runtime";
import { MatchmakingService } from "../src/matchmaking/service";
import type { JoinResult, QueueCandidate } from "../src/matchmaking/service";
import { TestClock } from "./helpers/match-fixtures";
import { setupTestDatabase, truncateAll } from "./helpers/test-database";

const config: ServerConfig = loadServerConfig({
  APP_ENV: "local",
  APP_VERSION: "9.9.9",
  GIT_SHA: "testsha",
  LOG_LEVEL: "fatal",
});

const RANKED: QueueKey = { mode: "ranked", timeControlSeconds: 300 };
const CASUAL: QueueKey = { mode: "casual", timeControlSeconds: 300 };

let handle: DatabaseHandle;
let clock: TestClock;
let runtime: MatchRuntime;
let identity: IdentityService;
let guests: GuestService;
let matchmaking: MatchmakingService;
let accounts = 0;

beforeAll(async () => {
  handle = await setupTestDatabase();
});

afterAll(async () => {
  await handle.close();
});

beforeEach(async () => {
  await truncateAll(handle);
  clock = new TestClock();
  runtime = new MatchRuntime({ db: handle.db, now: clock.now });
  identity = new IdentityService({ db: handle.db, config, now: clock.now });
  guests = new GuestService({ db: handle.db, config, now: clock.now });
  matchmaking = new MatchmakingService({
    runtime,
    identity,
    now: clock.now,
    // Light always goes to the first of the pair, so seats are assertable.
    random: () => 0.1,
  });
});

/** A verified account, which is what a ranked seat requires (appendix P3). */
async function verifiedAccount(rating?: number): Promise<QueueCandidate & { user: UserRow }> {
  accounts += 1;
  const username = `player${accounts}`;
  const registered = await identity.register({
    email: `${username}@example.com`,
    password: "correct-horse-7",
    username,
  });
  if (!registered.ok) {
    throw new Error(`registration failed: ${registered.reason}`);
  }
  await identity.verifyEmail(registered.value.emailVerification?.token ?? "");
  const userId = registered.value.account.userId;
  if (rating !== undefined) {
    await upsertRating(handle.db, userId, {
      rating,
      gamesPlayed: 1,
      wins: 1,
      losses: 0,
      draws: 0,
      currentStreak: 1,
      bestStreak: 1,
    });
  }

  return {
    actor: { actorType: "user", actorId: userId },
    displayName: username,
    user: { id: userId } as UserRow,
  };
}

async function guest(displayName: string): Promise<QueueCandidate> {
  const created = await guests.createGuest(displayName);
  return { actor: { actorType: "guest", actorId: created.guestId }, displayName };
}

function expectQueued(result: JoinResult): Extract<JoinResult, { outcome: "queued" }> {
  if (result.outcome !== "queued") {
    throw new Error(`expected the player to be queued, got ${result.outcome}`);
  }
  return result;
}

function expectSeated(result: JoinResult): Extract<JoinResult, { outcome: "seated" }> {
  if (result.outcome !== "seated") {
    throw new Error(`expected a match, got ${result.outcome}`);
  }
  return result;
}

describe("joining a queue", () => {
  it("reports the queue a player is waiting in", async () => {
    const ada = await verifiedAccount(1500);

    const result = expectQueued(await matchmaking.join(ada, RANKED));

    expect(result.status).toEqual({
      mode: "ranked",
      timeControlSeconds: 300,
      rating: 1500,
      waitingMs: 0,
      ratingWindow: { minimum: 1400, maximum: 1600 },
      depth: 1,
      serverTime: clock.now(),
    });
    expect(matchmaking.depths()).toEqual([{ ...RANKED, depth: 1 }]);
  });

  it("queues a guest as unrated in casual and reports the starting rating", async () => {
    const result = expectQueued(await matchmaking.join(await guest("guest-one"), CASUAL));

    expect(result.status).toMatchObject({ rating: STARTING_RATING, ratingWindow: null });
  });

  it("refuses a guest in ranked, and an account whose email is unverified", async () => {
    const unverified = await identity.register({
      email: "unverified@example.com",
      password: "correct-horse-7",
      username: "unverified",
    });
    if (!unverified.ok) {
      throw new Error("expected registration to succeed");
    }

    expect(await matchmaking.join(await guest("guest-two"), RANKED)).toEqual({
      outcome: "refused",
      reason: "ineligible",
      ineligibility: "guest-ranked",
    });
    expect(
      await matchmaking.join(
        {
          actor: { actorType: "user", actorId: unverified.value.account.userId },
          displayName: "unverified",
        },
        RANKED,
      ),
    ).toMatchObject({ reason: "ineligible", ineligibility: "email-unverified" });
  });

  it("refuses a suspended account", async () => {
    const ada = await verifiedAccount();
    await identity.suspend(ada.actor.actorId, "testing");

    expect(await matchmaking.join(ada, CASUAL)).toMatchObject({
      reason: "ineligible",
      ineligibility: "suspended",
    });
  });

  it("refuses a player who is already holding a clock", async () => {
    const ada = await verifiedAccount();
    const grace = await verifiedAccount();
    await runtime.createMatch({
      mode: "casual",
      timeControlSeconds: 300,
      light: { ...ada.actor, displayName: ada.displayName },
      dark: { ...grace.actor, displayName: grace.displayName },
    });

    expect(await matchmaking.join(ada, CASUAL)).toEqual({
      outcome: "refused",
      reason: "already-in-match",
    });
  });

  it("moves a player who joins a second queue instead of leaving two entries", async () => {
    const ada = await verifiedAccount(1500);

    expectQueued(await matchmaking.join(ada, RANKED));
    const moved = expectQueued(await matchmaking.join(ada, CASUAL));

    expect(moved.status.mode).toBe("casual");
    expect(matchmaking.depths()).toEqual([{ ...CASUAL, depth: 1 }]);
  });

  it("refuses every entry once the process is draining (spec section 7.6)", async () => {
    const ada = await verifiedAccount();
    expectQueued(await matchmaking.join(ada, CASUAL));

    matchmaking.stopAcceptingEntries();

    expect(matchmaking.depths()).toEqual([]);
    expect(await matchmaking.join(ada, CASUAL)).toEqual({
      outcome: "refused",
      reason: "queue-closed",
    });
  });
});

describe("leaving a queue", () => {
  it("removes the entry once and says so, however often it is asked", async () => {
    const ada = await verifiedAccount();
    expectQueued(await matchmaking.join(ada, CASUAL));

    expect(matchmaking.statusOf(ada.actor.actorId)).toMatchObject({ mode: "casual", depth: 1 });
    expect(matchmaking.leave(ada.actor.actorId)).toBe(true);
    expect(matchmaking.leave(ada.actor.actorId)).toBe(false);
    expect(matchmaking.statusOf(ada.actor.actorId)).toBeNull();
    expect(matchmaking.depths()).toEqual([]);
  });
});

describe("pairing", () => {
  it("seats two waiting guests in casual and tells each its own colour", async () => {
    const one = await guest("guest-one");
    const two = await guest("guest-two");

    expectQueued(await matchmaking.join(one, CASUAL));
    clock.advance(4_000);
    const seated = expectSeated(await matchmaking.join(two, CASUAL)).seated;

    expect(seated.snapshot.mode).toBe("casual");
    expect(seated.snapshot.players.light.actorId).toBe(one.actor.actorId);
    expect(seated.events.map((published) => published.event.yourColor)).toEqual(["light", "dark"]);
    const first = seated.events[0]?.event;
    expect(first?.opponent).toEqual({
      actorType: "guest",
      displayName: "guest-two",
      rating: null,
    });
    expect(first?.waitedMs).toBe(4_000);
    expect(matchmaking.depths()).toEqual([]);
  });

  it("records that the colours were chosen at random (spec section 9.4)", async () => {
    const one = await guest("guest-one");
    const two = await guest("guest-two");
    expectQueued(await matchmaking.join(one, CASUAL));
    const seated = expectSeated(await matchmaking.join(two, CASUAL)).seated;

    const row = await findMatchById(handle.db, seated.snapshot.matchId);

    expect(row).toMatchObject({ colorAssignment: "random", rematchOfMatchId: null });
  });

  it("uses the injected randomness to decide which player takes light", async () => {
    const other = new MatchmakingService({ runtime, identity, now: clock.now, random: () => 0.9 });
    const one = await guest("guest-one");
    const two = await guest("guest-two");

    expectQueued(await other.join(one, CASUAL));
    const seated = expectSeated(await other.join(two, CASUAL)).seated;

    expect(seated.snapshot.players.light.actorId).toBe(two.actor.actorId);
  });

  it("keeps two ranked players apart while their ratings are too far apart", async () => {
    const ada = await verifiedAccount(1200);
    const grace = await verifiedAccount(1600);

    expectQueued(await matchmaking.join(ada, RANKED));
    expectQueued(await matchmaking.join(grace, RANKED));

    expect(matchmaking.depths()).toEqual([{ ...RANKED, depth: 2 }]);
    expect((await matchmaking.tick()).seated).toEqual([]);
  });

  it("pairs them once both windows have widened enough", async () => {
    const ada = await verifiedAccount(1200);
    const grace = await verifiedAccount(1600);
    expectQueued(await matchmaking.join(ada, RANKED));
    expectQueued(await matchmaking.join(grace, RANKED));

    clock.advance(60_000);
    const { seated } = await matchmaking.tick();

    expect(seated).toHaveLength(1);
    expect(seated[0]?.snapshot.mode).toBe("ranked");
    expect(matchmaking.depths()).toEqual([]);
  });

  it("never pairs across a mode or a time control", async () => {
    const ada = await verifiedAccount(1200);
    const grace = await verifiedAccount(1200);
    expectQueued(await matchmaking.join(ada, RANKED));
    expectQueued(await matchmaking.join(grace, { mode: "ranked", timeControlSeconds: 600 }));

    clock.advance(120_000);

    expect((await matchmaking.tick()).seated).toEqual([]);
    expect(matchmaking.depths()).toHaveLength(2);
  });

  it("drops a player suspended while waiting rather than seating them", async () => {
    const ada = await verifiedAccount(1200);
    const grace = await verifiedAccount(1200);
    expectQueued(await matchmaking.join(ada, RANKED));
    await identity.suspend(ada.actor.actorId, "testing");

    const queued = await matchmaking.join(grace, RANKED);

    expect(queued.outcome).toBe("queued");
    expect(matchmaking.statusOf(ada.actor.actorId)).toBeNull();
  });

  it("pairs on arrival, so a fourth player does not wait for a tick", async () => {
    const first = expectQueued(await matchmaking.join(await verifiedAccount(1200), RANKED));
    expect(first.status.depth).toBe(1);
    expectSeated(await matchmaking.join(await verifiedAccount(1200), RANKED));

    expectQueued(await matchmaking.join(await verifiedAccount(1200), RANKED));
    expectSeated(await matchmaking.join(await verifiedAccount(1200), RANKED));

    expect(matchmaking.depths()).toEqual([]);
    expect(await matchmaking.tick()).toEqual({ seated: [], statuses: [] });
  });

  it("seats every pair that waiting has made possible in one tick", async () => {
    for (const rating of [1200, 1600, 2000, 2400]) {
      expectQueued(await matchmaking.join(await verifiedAccount(rating), RANKED));
    }
    expect(matchmaking.depths()).toEqual([{ ...RANKED, depth: 4 }]);

    clock.advance(60_000);
    const { seated } = await matchmaking.tick();

    expect(seated).toHaveLength(2);
    expect(matchmaking.depths()).toEqual([]);
  });

  it("leaves an odd player waiting after the others are paired", async () => {
    for (const rating of [1200, 1600, 2400]) {
      expectQueued(await matchmaking.join(await verifiedAccount(rating), RANKED));
    }

    clock.advance(60_000);
    const { seated } = await matchmaking.tick();

    expect(seated).toHaveLength(1);
    expect(matchmaking.depths()).toEqual([{ ...RANKED, depth: 1 }]);
  });
});

describe("queue metrics", () => {
  it("reports depth per mode and time control (spec section 17.1)", async () => {
    expectQueued(await matchmaking.join(await guest("guest-one"), CASUAL));
    expectQueued(await matchmaking.join(await verifiedAccount(1200), RANKED));
    expectQueued(
      await matchmaking.join(await verifiedAccount(1200), {
        mode: "ranked",
        timeControlSeconds: 900,
      }),
    );

    expect(matchmaking.depths()).toEqual(
      expect.arrayContaining([
        { ...CASUAL, depth: 1 },
        { ...RANKED, depth: 1 },
        { mode: "ranked", timeControlSeconds: 900, depth: 1 },
      ]),
    );
  });

  it("refreshes a waiting player's status on the interval, not on every tick", async () => {
    const ada = await verifiedAccount(1200);
    expectQueued(await matchmaking.join(ada, RANKED));

    expect((await matchmaking.tick()).statuses).toEqual([]);
    clock.advance(2_000);
    const statuses = (await matchmaking.tick()).statuses;

    expect(statuses).toHaveLength(1);
    expect(statuses[0]?.status).toMatchObject({ waitingMs: 2_000, depth: 1 });
    expect((await matchmaking.tick()).statuses).toEqual([]);
  });

  it("reads the wall clock and real randomness when neither is supplied", async () => {
    const service = new MatchmakingService({ runtime, identity });
    const one = await guest("guest-one");
    const two = await guest("guest-two");

    const queued = expectQueued(await service.join(one, CASUAL));
    const seated = expectSeated(await service.join(two, CASUAL)).seated;

    expect(queued.status.serverTime).toBeGreaterThan(clock.now());
    expect([one.actor.actorId, two.actor.actorId]).toContain(seated.snapshot.players.light.actorId);
  });

  it("reports nothing at all when no queue holds anyone", async () => {
    expect(matchmaking.depths()).toEqual([]);
    expect(await matchmaking.tick()).toEqual({ seated: [], statuses: [] });
  });
});
