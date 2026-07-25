import { randomUUID } from "node:crypto";
import { loadServerConfig } from "@gobblet/config";
import type { ServerConfig } from "@gobblet/config";
import { findMatchById } from "@gobblet/db";
import type { DatabaseHandle } from "@gobblet/db";
import { REMATCH_OFFER_MS } from "@gobblet/protocol";
import type { MatchSnapshot } from "@gobblet/protocol";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GuestService } from "../src/guests/service";
import { IdentityService } from "../src/identity/service";
import { RematchService } from "../src/matchmaking/rematch";
import type { RematchBroadcast, RematchResult } from "../src/matchmaking/rematch";
import { MatchRuntime } from "../src/match/runtime";
import type { Actor } from "../src/match/snapshot";
import { TestClock, WINNING_SCRIPT, envelope } from "./helpers/match-fixtures";
import { setupTestDatabase, truncateAll } from "./helpers/test-database";

const config: ServerConfig = loadServerConfig({
  NODE_ENV: "test",
  APP_ENV: "local",
  APP_VERSION: "0.1.0-test",
  GIT_SHA: "test",
  CORS_ORIGINS: "http://127.0.0.1:5173",
});

let handle: DatabaseHandle;
let clock: TestClock;
let runtime: MatchRuntime;
let guests: GuestService;
let identity: IdentityService;
let rematch: RematchService;

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
  guests = new GuestService({ db: handle.db, config, now: clock.now });
  identity = new IdentityService({ db: handle.db, config, now: clock.now });
  rematch = new RematchService({ runtime, identity, now: clock.now });
});

type Table = Readonly<{
  snapshot: MatchSnapshot;
  light: Actor;
  dark: Actor;
}>;

async function guestActor(displayName: string): Promise<Actor & Readonly<{ displayName: string }>> {
  const guest = await guests.createGuest(displayName);
  return { actorType: "guest", actorId: guest.guestId, displayName: guest.displayName };
}

/** A casual match played to a light win, which is the state a rematch follows. */
async function finishedMatch(): Promise<Table> {
  const light = await guestActor("light-player");
  const dark = await guestActor("dark-player");
  const snapshot = await runtime.createMatch({
    mode: "casual",
    timeControlSeconds: 300,
    light,
    dark,
  });

  for (const [index, move] of WINNING_SCRIPT.entries()) {
    clock.advance(1_000);
    const actor = index % 2 === 0 ? light : dark;
    await runtime.applyMoveCommand(actor, {
      ...envelope(snapshot.matchId, index),
      payload: { move },
    });
  }

  return { snapshot, light, dark };
}

async function activeMatch(): Promise<Table> {
  const light = await guestActor("light-player");
  const dark = await guestActor("dark-player");
  const snapshot = await runtime.createMatch({
    mode: "casual",
    timeControlSeconds: 300,
    light,
    dark,
  });
  return { snapshot, light, dark };
}

function expectAccepted(result: RematchResult): RematchBroadcast {
  if (!result.ok) {
    throw new Error(`expected an answer, got ${result.reason}`);
  }
  return result.broadcast;
}

function expectRefusal(result: RematchResult): string {
  if (result.ok) {
    throw new Error(`expected a refusal, got ${result.broadcast.status.state}`);
  }
  return result.reason;
}

describe("offering a rematch", () => {
  it("offers to the opponent for thirty seconds and names who is waiting", async () => {
    const table = await finishedMatch();

    const broadcast = expectAccepted(await rematch.request(table.light, table.snapshot.matchId));

    expect(broadcast.status).toEqual({
      matchId: table.snapshot.matchId,
      state: "offered",
      requestedBy: table.light.actorId,
      expiresAt: clock.now() + REMATCH_OFFER_MS,
      nextMatchId: null,
    });
    expect(broadcast.actorIds).toEqual([table.light.actorId, table.dark.actorId]);
    expect(broadcast.next).toBeUndefined();
  });

  it("offers from the dark seat just as well as from the light one", async () => {
    const table = await finishedMatch();

    const broadcast = expectAccepted(await rematch.request(table.dark, table.snapshot.matchId));

    expect(broadcast.status.requestedBy).toBe(table.dark.actorId);
    expect(broadcast.actorIds).toEqual([table.dark.actorId, table.light.actorId]);
  });

  it("refuses a second offer of the same match from the same player", async () => {
    const table = await finishedMatch();
    await rematch.request(table.light, table.snapshot.matchId);

    expect(expectRefusal(await rematch.request(table.light, table.snapshot.matchId))).toBe(
      "already-offered",
    );
  });

  it("refuses an offer from a player who is already waiting on another match", async () => {
    const first = await finishedMatch();
    await rematch.request(first.light, first.snapshot.matchId);
    const second = await runtime.createMatch({
      mode: "casual",
      timeControlSeconds: 300,
      light: { ...first.light, displayName: "light-player" },
      dark: { ...first.dark, displayName: "dark-player" },
    });
    await runtime.applyResignCommand(first.light, envelope(second.matchId, 0));

    expect(expectRefusal(await rematch.request(first.light, second.matchId))).toBe(
      "already-offered",
    );
  });

  it("refuses a player who did not play the match", async () => {
    const table = await finishedMatch();
    const stranger = await guestActor("stranger");

    expect(expectRefusal(await rematch.request(stranger, table.snapshot.matchId))).toBe(
      "not-participant",
    );
  });

  it("refuses a match that does not exist", async () => {
    const table = await finishedMatch();

    expect(expectRefusal(await rematch.request(table.light, randomUUID()))).toBe("not-participant");
  });

  it("refuses a match that is still being played", async () => {
    const table = await activeMatch();

    expect(expectRefusal(await rematch.request(table.light, table.snapshot.matchId))).toBe(
      "match-not-ended",
    );
  });

  it("refuses a suspended account", async () => {
    const registered = await identity.register({
      email: "ada@example.com",
      password: "correct-horse-7",
      username: "ada",
    });
    if (!registered.ok) {
      throw new Error("expected registration to succeed");
    }
    const light: Actor = { actorType: "user", actorId: registered.value.account.userId };
    const dark = await guestActor("dark-player");
    const snapshot = await runtime.createMatch({
      mode: "casual",
      timeControlSeconds: 300,
      light: { ...light, displayName: "ada" },
      dark,
    });
    await runtime.applyResignCommand(light, envelope(snapshot.matchId, 0));
    await identity.suspend(registered.value.account.userId, "abuse");

    expect(expectRefusal(await rematch.request(light, snapshot.matchId))).toBe("ineligible");
  });

  it("refuses a player who has since started another match", async () => {
    const table = await finishedMatch();
    await runtime.createMatch({
      mode: "casual",
      timeControlSeconds: 300,
      light: { ...table.light, displayName: "light-player" },
      dark: { ...(await guestActor("someone-else")) },
    });

    expect(expectRefusal(await rematch.request(table.light, table.snapshot.matchId))).toBe(
      "ineligible",
    );
  });
});

describe("answering a rematch", () => {
  it("creates a new match with the colours alternated and records the predecessor", async () => {
    const table = await finishedMatch();
    await rematch.request(table.light, table.snapshot.matchId);

    const broadcast = expectAccepted(
      await rematch.respond(table.dark, table.snapshot.matchId, true),
    );

    const next = broadcast.next;
    if (!next) {
      throw new Error("expected the answer to create a match");
    }
    expect(broadcast.status).toMatchObject({
      state: "accepted",
      nextMatchId: next.snapshot.matchId,
    });
    expect(next.snapshot.players.light.actorId).toBe(table.dark.actorId);
    expect(next.snapshot.players.dark.actorId).toBe(table.light.actorId);
    expect(next.snapshot.mode).toBe(table.snapshot.mode);
    expect(next.snapshot.timeControlSeconds).toBe(table.snapshot.timeControlSeconds);
    expect(next.snapshot.status).toBe("active");
    expect(next.snapshot.version).toBe(0);

    const row = await findMatchById(handle.db, next.snapshot.matchId);
    expect(row?.rematchOfMatchId).toBe(table.snapshot.matchId);
    expect(row?.colorAssignment).toBe("alternated");
  });

  it("tells each player its own colour in the new match", async () => {
    const table = await finishedMatch();
    await rematch.request(table.light, table.snapshot.matchId);

    const broadcast = expectAccepted(
      await rematch.respond(table.dark, table.snapshot.matchId, true),
    );

    expect(broadcast.next?.events).toEqual([
      expect.objectContaining({
        actorId: table.dark.actorId,
        event: expect.objectContaining({ yourColor: "light", waitedMs: 0 }),
      }),
      expect.objectContaining({
        actorId: table.light.actorId,
        event: expect.objectContaining({ yourColor: "dark" }),
      }),
    ]);
  });

  it("pairs two players who both ask for a rematch", async () => {
    const table = await finishedMatch();
    await rematch.request(table.light, table.snapshot.matchId);

    const broadcast = expectAccepted(await rematch.request(table.dark, table.snapshot.matchId));

    expect(broadcast.status.state).toBe("accepted");
    expect(broadcast.next).toBeDefined();
  });

  it("returns both players to the post-match state when the offer is declined", async () => {
    const table = await finishedMatch();
    await rematch.request(table.light, table.snapshot.matchId);

    const broadcast = expectAccepted(
      await rematch.respond(table.dark, table.snapshot.matchId, false),
    );

    expect(broadcast.status).toMatchObject({ state: "declined", nextMatchId: null });
    expect(expectRefusal(await rematch.respond(table.dark, table.snapshot.matchId, true))).toBe(
      "no-offer",
    );
  });

  it("lets the player who offered withdraw it", async () => {
    const table = await finishedMatch();
    await rematch.request(table.light, table.snapshot.matchId);

    const broadcast = expectAccepted(
      await rematch.respond(table.light, table.snapshot.matchId, false),
    );

    expect(broadcast.status.state).toBe("cancelled");
    expect(expectRefusal(await rematch.respond(table.dark, table.snapshot.matchId, true))).toBe(
      "no-offer",
    );
  });

  it("does not let the player who offered accept their own offer", async () => {
    const table = await finishedMatch();
    await rematch.request(table.light, table.snapshot.matchId);

    expect(expectRefusal(await rematch.respond(table.light, table.snapshot.matchId, true))).toBe(
      "no-offer",
    );
  });

  it("refuses an answer when nothing was offered", async () => {
    const table = await finishedMatch();

    expect(expectRefusal(await rematch.respond(table.dark, table.snapshot.matchId, true))).toBe(
      "no-offer",
    );
  });

  it("refuses an answer from someone who did not play the match", async () => {
    const table = await finishedMatch();
    await rematch.request(table.light, table.snapshot.matchId);
    const stranger = await guestActor("stranger");

    expect(expectRefusal(await rematch.respond(stranger, table.snapshot.matchId, true))).toBe(
      "no-offer",
    );
  });

  it("refuses to seat a rematch when the accepting player has started another match", async () => {
    const table = await finishedMatch();
    await rematch.request(table.light, table.snapshot.matchId);
    await runtime.createMatch({
      mode: "casual",
      timeControlSeconds: 300,
      light: { ...table.dark, displayName: "dark-player" },
      dark: { ...(await guestActor("someone-else")) },
    });

    expect(expectRefusal(await rematch.respond(table.dark, table.snapshot.matchId, true))).toBe(
      "ineligible",
    );
  });

  it("refuses to seat a rematch when the offering player has started another match", async () => {
    const table = await finishedMatch();
    await rematch.request(table.light, table.snapshot.matchId);
    await runtime.createMatch({
      mode: "casual",
      timeControlSeconds: 300,
      light: { ...table.light, displayName: "light-player" },
      dark: { ...(await guestActor("someone-else")) },
    });

    expect(expectRefusal(await rematch.respond(table.dark, table.snapshot.matchId, true))).toBe(
      "ineligible",
    );
  });

  it("refuses an answer about a match the answering player cannot read", async () => {
    const table = await finishedMatch();
    await rematch.request(table.light, table.snapshot.matchId);
    // The offer is forgotten by the runtime's own eyes: the match row is gone, so the
    // acceptance cannot be verified against a finished match.
    await handle.db.execute(
      `delete from match_events where match_id = '${table.snapshot.matchId}'`,
    );
    await handle.db.execute(`delete from matches where id = '${table.snapshot.matchId}'`);

    expect(expectRefusal(await rematch.respond(table.dark, table.snapshot.matchId, true))).toBe(
      "not-participant",
    );
  });
});

describe("offers that end without an answer", () => {
  it("expires exactly once, thirty seconds after it was made", async () => {
    const table = await finishedMatch();
    const offered = expectAccepted(await rematch.request(table.light, table.snapshot.matchId));

    clock.advance(REMATCH_OFFER_MS - 1);
    expect(rematch.sweep()).toEqual([]);
    clock.advance(1);
    const expired = rematch.sweep();

    expect(expired).toHaveLength(1);
    expect(expired[0]?.status).toEqual({
      ...offered.status,
      state: "expired",
    });
    expect(rematch.sweep()).toEqual([]);
  });

  it("lets a player offer again after their first offer expired", async () => {
    const table = await finishedMatch();
    await rematch.request(table.light, table.snapshot.matchId);
    clock.advance(REMATCH_OFFER_MS);
    rematch.sweep();

    expect(
      expectAccepted(await rematch.request(table.light, table.snapshot.matchId)).status.state,
    ).toBe("offered");
  });

  it("ends when the player who offered disconnects", async () => {
    const table = await finishedMatch();
    await rematch.request(table.light, table.snapshot.matchId);

    const cancelled = rematch.cancelFor(table.light.actorId);

    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]?.status.state).toBe("cancelled");
    expect(expectRefusal(await rematch.respond(table.dark, table.snapshot.matchId, true))).toBe(
      "no-offer",
    );
  });

  it("ends when the player who was offered a rematch disconnects", async () => {
    const table = await finishedMatch();
    await rematch.request(table.light, table.snapshot.matchId);

    const cancelled = rematch.cancelFor(table.dark.actorId);

    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]?.status.state).toBe("cancelled");
  });

  it("ignores a disconnect from someone with no offer", async () => {
    const table = await finishedMatch();
    await rematch.request(table.light, table.snapshot.matchId);
    const stranger = await guestActor("stranger");

    expect(rematch.cancelFor(stranger.actorId)).toEqual([]);
  });

  it("keeps nothing across a restart, and names the offers it ended", async () => {
    const table = await finishedMatch();
    await rematch.request(table.light, table.snapshot.matchId);

    const cancelled = rematch.forgetAll();

    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]?.status).toMatchObject({
      matchId: table.snapshot.matchId,
      state: "cancelled",
    });
    expect(rematch.forgetAll()).toEqual([]);
    expect(rematch.sweep()).toEqual([]);
    expect(
      expectAccepted(await rematch.request(table.light, table.snapshot.matchId)).status.state,
    ).toBe("offered");
  });

  it("reads the wall clock when no clock is supplied", async () => {
    const service = new RematchService({ runtime, identity });
    const table = await finishedMatch();

    const broadcast = expectAccepted(await service.request(table.light, table.snapshot.matchId));

    expect(broadcast.status.expiresAt).toBeGreaterThan(clock.now() + REMATCH_OFFER_MS);
  });
});
