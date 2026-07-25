import { randomUUID } from "node:crypto";
import { countMatchEvents, findMatchById, listMatchEvents } from "@gobblet/db";
import type { DatabaseHandle } from "@gobblet/db";
import { matchSnapshotSchema, commandAckSchema } from "@gobblet/protocol";
import type { MatchSnapshot } from "@gobblet/protocol";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MatchRuntime } from "../src/match/runtime";
import type { CommandResult } from "../src/match/runtime";
import {
  DARK_ACTOR,
  LIGHT_ACTOR,
  REPETITION_SCRIPT,
  STRANGER,
  TestClock,
  WINNING_SCRIPT,
  envelope,
} from "./helpers/match-fixtures";
import { setupTestDatabase, truncateAll } from "./helpers/test-database";

let handle: DatabaseHandle;
let clock: TestClock;
let runtime: MatchRuntime;

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
});

async function createMatch(
  timeControlSeconds: 180 | 300 | 600 | 900 = 300,
): Promise<MatchSnapshot> {
  return runtime.createMatch({
    mode: "casual",
    timeControlSeconds,
    light: LIGHT_ACTOR,
    dark: DARK_ACTOR,
  });
}

function expectAccepted(result: CommandResult, newVersion: number): void {
  expect(commandAckSchema.parse(result.ack)).toEqual({
    ok: true,
    commandId: result.ack.commandId,
    newVersion,
  });
}

function rejectionReason(result: CommandResult): string {
  if (result.ack.ok) {
    throw new Error("expected a rejection");
  }
  return result.ack.reason;
}

describe("createMatch", () => {
  it("starts an active match with full clocks and a creation event", async () => {
    const snapshot = await createMatch();

    expect(matchSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(snapshot.status).toBe("active");
    expect(snapshot.version).toBe(0);
    expect(snapshot.activePlayer).toBe("light");
    expect(snapshot.clocks).toEqual({
      lightRemainingMs: 300_000,
      darkRemainingMs: 300_000,
      turnStartedAt: clock.now(),
      serverTime: clock.now(),
    });
    expect(snapshot.players.light.displayName).toBe("light-player");
    expect(snapshot.result).toBeNull();
    expect(snapshot.lastMove).toBeNull();

    const events = await listMatchEvents(handle.db, snapshot.matchId);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("match-created");
    expect(events[0]?.sequence).toBe(0);
    expect(events[0]?.commandId).toBeNull();
  });

  it("honours a dark opening and the chosen time control", async () => {
    const snapshot = await runtime.createMatch({
      mode: "ranked",
      timeControlSeconds: 180,
      light: LIGHT_ACTOR,
      dark: DARK_ACTOR,
      firstPlayer: "dark",
    });

    expect(snapshot.activePlayer).toBe("dark");
    expect(snapshot.mode).toBe("ranked");
    expect(snapshot.clocks.darkRemainingMs).toBe(180_000);
  });
});

describe("playing a match through the runtime", () => {
  it("lets two clients complete a match and commits the outcome once", async () => {
    const { matchId } = await createMatch();

    for (const [index, move] of WINNING_SCRIPT.entries()) {
      const actor = index % 2 === 0 ? LIGHT_ACTOR : DARK_ACTOR;
      clock.advance(1_000);
      const result = await runtime.applyMoveCommand(actor, {
        ...envelope(matchId, index),
        payload: { move },
      });

      expectAccepted(result, index + 1);
      expect(result.moveCommitted?.version).toBe(index + 1);
      expect(result.moveCommitted?.actor).toBe(index % 2 === 0 ? "light" : "dark");
    }

    const final = await runtime.getSnapshot(matchId);
    expect(final?.status).toBe("completed");
    expect(final?.result).toEqual({ outcome: "light", reason: "line" });
    expect(final?.version).toBe(WINNING_SCRIPT.length);
    expect(final?.clocks.turnStartedAt).toBeNull();
    expect(final?.lastMove).toEqual({ move: WINNING_SCRIPT.at(-1), version: 7 });

    const row = await findMatchById(handle.db, matchId);
    expect(row?.moveCount).toBe(WINNING_SCRIPT.length);
    expect(row?.endedAt).not.toBeNull();

    const events = await listMatchEvents(handle.db, matchId);
    expect(events.map((event) => event.sequence)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(events.filter((event) => event.type === "move")).toHaveLength(7);
    expect(events.filter((event) => event.stateHash.length !== 64)).toHaveLength(0);
  });

  it("finalises a threefold repetition as a draw", async () => {
    const { matchId } = await createMatch();

    for (const [index, move] of REPETITION_SCRIPT.entries()) {
      const actor = index % 2 === 0 ? LIGHT_ACTOR : DARK_ACTOR;
      const result = await runtime.applyMoveCommand(actor, {
        ...envelope(matchId, index),
        payload: { move },
      });
      expectAccepted(result, index + 1);
    }

    const final = await runtime.getSnapshot(matchId);
    expect(final?.status).toBe("completed");
    expect(final?.result).toEqual({ outcome: "draw", reason: "repetition" });
  });

  it("charges only the moving side and restarts the turn clock", async () => {
    const { matchId } = await createMatch();

    clock.advance(4_500);
    const result = await runtime.applyMoveCommand(LIGHT_ACTOR, {
      ...envelope(matchId, 0),
      payload: { move: WINNING_SCRIPT[0]! },
    });

    expect(result.moveCommitted?.clocks).toEqual({
      lightRemainingMs: 295_500,
      darkRemainingMs: 300_000,
      turnStartedAt: clock.now(),
      serverTime: clock.now(),
    });
  });

  it("rejects a move after the match ended", async () => {
    const { matchId } = await createMatch();
    await runtime.applyResignCommand(LIGHT_ACTOR, envelope(matchId, 0));

    const result = await runtime.applyMoveCommand(DARK_ACTOR, {
      ...envelope(matchId, 1),
      payload: { move: WINNING_SCRIPT[0]! },
    });

    expect(rejectionReason(result)).toBe("match-ended");
    expect(result.ack.ok ? null : result.ack.snapshot?.status).toBe("completed");
  });
});

describe("command rejections", () => {
  it("rejects a duplicate command without applying it twice", async () => {
    const { matchId } = await createMatch();
    const command = { ...envelope(matchId, 0), payload: { move: WINNING_SCRIPT[0]! } };

    expectAccepted(await runtime.applyMoveCommand(LIGHT_ACTOR, command), 1);
    const replay = await runtime.applyMoveCommand(LIGHT_ACTOR, command);

    expect(rejectionReason(replay)).toBe("duplicate-command");
    expect(replay.snapshot?.version).toBe(1);
    expect(await countMatchEvents(handle.db, matchId)).toBe(2);
  });

  it("reports a duplicate even when the state moved on", async () => {
    const { matchId } = await createMatch();
    const command = { ...envelope(matchId, 0), payload: { move: WINNING_SCRIPT[0]! } };
    await runtime.applyMoveCommand(LIGHT_ACTOR, command);
    await runtime.applyMoveCommand(DARK_ACTOR, {
      ...envelope(matchId, 1),
      payload: { move: WINNING_SCRIPT[1]! },
    });

    const replay = await runtime.applyMoveCommand(LIGHT_ACTOR, command);

    expect(rejectionReason(replay)).toBe("duplicate-command");
    expect(replay.snapshot?.version).toBe(2);
  });

  it("rejects a stale expected version and returns the authoritative snapshot", async () => {
    const { matchId } = await createMatch();
    await runtime.applyMoveCommand(LIGHT_ACTOR, {
      ...envelope(matchId, 0),
      payload: { move: WINNING_SCRIPT[0]! },
    });

    const result = await runtime.applyMoveCommand(DARK_ACTOR, {
      ...envelope(matchId, 0),
      payload: { move: WINNING_SCRIPT[1]! },
    });

    expect(rejectionReason(result)).toBe("stale-version");
    expect(result.snapshot?.version).toBe(1);
    expect(await countMatchEvents(handle.db, matchId)).toBe(2);
  });

  it("rejects a move from the side that is not on turn", async () => {
    const { matchId } = await createMatch();

    const result = await runtime.applyMoveCommand(DARK_ACTOR, {
      ...envelope(matchId, 0),
      payload: { move: WINNING_SCRIPT[1]! },
    });

    expect(rejectionReason(result)).toBe("not-your-turn");
  });

  it("rejects an illegal move and leaves the version untouched", async () => {
    const { matchId } = await createMatch();

    const result = await runtime.applyMoveCommand(LIGHT_ACTOR, {
      ...envelope(matchId, 0),
      payload: { move: { kind: "board", from: "r0c0", to: "r0c1" } },
    });

    expect(rejectionReason(result)).toBe("illegal-move");
    expect(result.snapshot?.version).toBe(0);
    expect(await countMatchEvents(handle.db, matchId)).toBe(1);
  });

  it("rejects a non-participant without revealing a snapshot", async () => {
    const { matchId } = await createMatch();

    const result = await runtime.applyMoveCommand(STRANGER, {
      ...envelope(matchId, 0),
      payload: { move: WINNING_SCRIPT[0]! },
    });

    expect(rejectionReason(result)).toBe("not-authorized");
    expect(result.snapshot).toBeNull();
  });

  it("rejects a command for a match that does not exist", async () => {
    const result = await runtime.applyMoveCommand(LIGHT_ACTOR, {
      ...envelope(randomUUID(), 0),
      payload: { move: WINNING_SCRIPT[0]! },
    });

    expect(rejectionReason(result)).toBe("not-authorized");
  });
});

describe("resignation", () => {
  it("awards the win to the opponent and can be sent off turn", async () => {
    const { matchId } = await createMatch();
    await runtime.applyMoveCommand(LIGHT_ACTOR, {
      ...envelope(matchId, 0),
      payload: { move: WINNING_SCRIPT[0]! },
    });

    const result = await runtime.applyResignCommand(LIGHT_ACTOR, envelope(matchId, 1));

    expectAccepted(result, 2);
    expect(result.ended).toEqual({
      matchId,
      version: 2,
      result: "dark",
      reason: "resignation",
    });
    expect(result.snapshot?.status).toBe("completed");
    expect(result.moveCommitted).toBeNull();

    const row = await findMatchById(handle.db, matchId);
    expect(row?.moveCount).toBe(1);
    expect(row?.turnStartedAt).toBeNull();
  });

  it("stops the clock of the side that was thinking", async () => {
    const { matchId } = await createMatch();
    clock.advance(7_000);

    const result = await runtime.applyResignCommand(DARK_ACTOR, envelope(matchId, 0));

    expect(result.snapshot?.clocks.lightRemainingMs).toBe(293_000);
    expect(result.snapshot?.result).toEqual({ outcome: "light", reason: "resignation" });
  });
});

describe("clock expiry", () => {
  it("settles a timeout when a command arrives too late", async () => {
    const { matchId } = await createMatch(180);
    clock.advance(180_001);

    const result = await runtime.applyMoveCommand(LIGHT_ACTOR, {
      ...envelope(matchId, 0),
      payload: { move: WINNING_SCRIPT[0]! },
    });

    expect(rejectionReason(result)).toBe("clock-expired");
    expect(result.ended).toEqual({ matchId, version: 1, result: "dark", reason: "timeout" });
    expect(result.snapshot?.status).toBe("completed");
    expect(result.snapshot?.clocks.lightRemainingMs).toBe(0);

    const events = await listMatchEvents(handle.db, matchId);
    expect(events.map((event) => event.type)).toEqual(["match-created", "timeout"]);
  });

  it("settles a timeout without any command", async () => {
    const { matchId } = await createMatch(180);
    clock.advance(200_000);

    const settled = await runtime.settleExpiredClock(matchId);

    expect(settled?.ended).toEqual({ matchId, version: 1, result: "dark", reason: "timeout" });
    expect(settled?.snapshot.clocks.lightRemainingMs).toBe(0);
    expect(settled?.snapshot.clocks.darkRemainingMs).toBe(180_000);
  });

  it("leaves a running clock alone", async () => {
    const { matchId } = await createMatch();
    clock.advance(1_000);

    const settled = await runtime.settleExpiredClock(matchId);

    expect(settled?.ended).toBeNull();
    expect(settled?.snapshot.status).toBe("active");
    expect(await countMatchEvents(handle.db, matchId)).toBe(1);
  });

  it("never settles twice", async () => {
    const { matchId } = await createMatch(180);
    clock.advance(180_500);

    const first = await runtime.settleExpiredClock(matchId);
    const second = await runtime.settleExpiredClock(matchId);

    expect(first?.ended).not.toBeNull();
    expect(second?.ended).toBeNull();
    expect(await countMatchEvents(handle.db, matchId)).toBe(2);
  });

  it("returns null for an unknown match", async () => {
    expect(await runtime.settleExpiredClock(randomUUID())).toBeNull();
  });

  it("settles exactly once when two commands race", async () => {
    const { matchId } = await createMatch(180);
    clock.advance(181_000);

    const [light, dark] = await Promise.all([
      runtime.applyMoveCommand(LIGHT_ACTOR, {
        ...envelope(matchId, 0),
        payload: { move: WINNING_SCRIPT[0]! },
      }),
      runtime.applyResignCommand(DARK_ACTOR, envelope(matchId, 0)),
    ]);

    const reasons = [rejectionReason(light), rejectionReason(dark)].sort();
    expect(reasons).toEqual(["clock-expired", "match-ended"]);
    expect(await countMatchEvents(handle.db, matchId)).toBe(2);

    const row = await findMatchById(handle.db, matchId);
    expect(row?.result).toBe("dark");
    expect(row?.endReason).toBe("timeout");
  });
});

describe("restart recovery", () => {
  it("recovers active matches and settles the ones whose clock ran out", async () => {
    const expiring = await createMatch(180);
    const surviving = await createMatch(900);
    clock.advance(181_000);

    const restarted = new MatchRuntime({ db: handle.db, now: clock.now });
    const settled = await restarted.recoverUnfinishedMatches();

    expect(settled).toEqual([
      { matchId: expiring.matchId, version: 1, result: "dark", reason: "timeout" },
    ]);

    const recovered = await restarted.getSnapshot(surviving.matchId);
    expect(recovered?.status).toBe("active");
    expect(recovered?.clocks.lightRemainingMs).toBe(900_000);
    expect(recovered?.clocks.turnStartedAt).toBe(clock.now() - 181_000);

    expect(await restarted.recoverUnfinishedMatches()).toEqual([]);
  });

  it("keeps playing a recovered match from the persisted version", async () => {
    const { matchId } = await createMatch();
    await runtime.applyMoveCommand(LIGHT_ACTOR, {
      ...envelope(matchId, 0),
      payload: { move: WINNING_SCRIPT[0]! },
    });

    const restarted = new MatchRuntime({ db: handle.db, now: clock.now });
    const snapshot = await restarted.getSnapshot(matchId);
    expect(snapshot?.version).toBe(1);
    expect(snapshot?.activePlayer).toBe("dark");
    expect(snapshot?.lastMove).toEqual({ move: WINNING_SCRIPT[0], version: 1 });

    const result = await restarted.applyMoveCommand(DARK_ACTOR, {
      ...envelope(matchId, 1),
      payload: { move: WINNING_SCRIPT[1]! },
    });

    expectAccepted(result, 2);
  });
});

describe("reads", () => {
  it("falls back to the wall clock when no clock is injected", () => {
    const before = Date.now();
    const wallClockRuntime = new MatchRuntime({ db: handle.db });

    expect(wallClockRuntime.now()).toBeGreaterThanOrEqual(before);
  });

  it("returns null for unknown matches", async () => {
    const unknown = randomUUID();

    expect(await runtime.getSnapshot(unknown)).toBeNull();
    expect(await runtime.getSummary(unknown)).toBeNull();
    expect(await runtime.getClockSync(unknown)).toBeNull();
  });

  it("summarises a match for the HTTP surface", async () => {
    const { matchId } = await createMatch();

    const summary = await runtime.getSummary(matchId);

    expect(summary?.status).toBe("active");
    expect(summary?.players.dark.displayName).toBe("dark-player");
    expect(summary?.startedAt).toBe(new Date(clock.now()).toISOString());
    expect(summary?.endedAt).toBeNull();
  });

  it("publishes clock sync only while the match runs", async () => {
    const { matchId } = await createMatch();
    clock.advance(2_000);

    expect(await runtime.getClockSync(matchId)).toEqual({
      matchId,
      version: 0,
      activePlayer: "light",
      lightRemainingMs: 300_000,
      darkRemainingMs: 300_000,
      serverTime: clock.now(),
    });

    await runtime.applyResignCommand(LIGHT_ACTOR, envelope(matchId, 0));
    expect(await runtime.getClockSync(matchId)).toBeNull();
  });

  it("uses the server clock, not the client timestamp", async () => {
    const { matchId } = await createMatch();
    clock.advance(30_000);

    const result = await runtime.applyMoveCommand(LIGHT_ACTOR, {
      ...envelope(matchId, 0, { sentAtClient: clock.now() + 5_000_000 }),
      payload: { move: WINNING_SCRIPT[0]! },
    });

    expect(result.snapshot?.clocks.lightRemainingMs).toBe(270_000);
  });
});
