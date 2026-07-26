import { applyMove, fromSerializableGameState, toSerializableGameState } from "@gobblet/game-core";
import type { Move } from "@gobblet/protocol";
import { describe, expect, it } from "vitest";
import {
  INITIAL_MATCH_CHANNEL,
  isInputLocked,
  matchChannelReducer,
  previewSnapshot,
} from "../src/match/channel";
import type { MatchChannelState, PendingCommand } from "../src/match/channel";
import { MATCH_ID, SERVER_TIME, makeSnapshot } from "./helpers/match";

const OPENING: Move = { kind: "reserve", reserveStack: 0, to: "r1c1" };

function withSnapshot(): MatchChannelState {
  return matchChannelReducer(
    { ...INITIAL_MATCH_CHANNEL, phase: "ready" },
    { type: "snapshot", snapshot: makeSnapshot() },
  );
}

function pendingMove(expectedVersion: number): PendingCommand {
  return {
    kind: "move",
    commandId: "44444444-4444-4444-8444-444444444444",
    matchId: MATCH_ID,
    expectedVersion,
    move: OPENING,
    sentAt: SERVER_TIME,
  };
}

function committedFrom(version: number) {
  const snapshot = makeSnapshot();
  const result = applyMove(fromSerializableGameState(snapshot.state), OPENING);
  if (!result.ok) {
    throw new Error("the opening move must be legal");
  }
  return {
    matchId: MATCH_ID,
    version,
    move: OPENING,
    activePlayer: result.state.activePlayer,
    actor: "light" as const,
    clocks: {
      lightRemainingMs: 297_000,
      darkRemainingMs: 300_000,
      turnStartedAt: SERVER_TIME + 3000,
      serverTime: SERVER_TIME + 3000,
    },
    expectedState: toSerializableGameState(result.state),
  };
}

describe("match channel", () => {
  it("starts with nothing and takes the first snapshot", () => {
    expect(INITIAL_MATCH_CHANNEL.snapshot).toBeNull();

    const state = withSnapshot();

    expect(state.snapshot?.matchId).toBe(MATCH_ID);
    expect(state.resyncRequired).toBe(false);
  });

  it("ignores a snapshot older than the one it holds", () => {
    const held = matchChannelReducer(withSnapshot(), {
      type: "snapshot",
      snapshot: makeSnapshot({ version: 4 }),
    });

    const state = matchChannelReducer(held, {
      type: "snapshot",
      snapshot: makeSnapshot({ version: 2 }),
    });

    expect(state.snapshot?.version).toBe(4);
  });

  it("replaces the channel when the snapshot names another match", () => {
    const ended = matchChannelReducer(
      matchChannelReducer(withSnapshot(), { type: "command-sent", command: pendingMove(0) }),
      {
        type: "ended",
        event: {
          matchId: MATCH_ID,
          version: 7,
          result: "light",
          reason: "line",
          ratings: null,
        },
      },
    );

    const rematch = matchChannelReducer(ended, {
      type: "snapshot",
      snapshot: makeSnapshot({ matchId: "11111111-2222-4333-8444-555555555555", version: 0 }),
    });

    expect(rematch.snapshot?.matchId).toBe("11111111-2222-4333-8444-555555555555");
    expect(rematch.snapshot?.version).toBe(0);
    expect(rematch.ended).toBeNull();
    expect(rematch.pending).toBeNull();
    expect(rematch.phase).toBe("ready");
  });

  it("applies a committed move that follows the held version", () => {
    const committed = committedFrom(1);

    const state = matchChannelReducer(withSnapshot(), {
      type: "move-committed",
      event: {
        matchId: committed.matchId,
        version: committed.version,
        move: committed.move,
        activePlayer: committed.activePlayer,
        actor: committed.actor,
        clocks: committed.clocks,
      },
    });

    expect(state.snapshot?.version).toBe(1);
    expect(state.snapshot?.state).toEqual(committed.expectedState);
    expect(state.snapshot?.activePlayer).toBe("dark");
    expect(state.snapshot?.lastMove).toEqual({ move: OPENING, version: 1 });
    expect(state.resyncRequired).toBe(false);
  });

  it("asks for a snapshot instead of patching a gap", () => {
    const committed = committedFrom(5);

    const state = matchChannelReducer(withSnapshot(), {
      type: "move-committed",
      event: {
        matchId: committed.matchId,
        version: committed.version,
        move: committed.move,
        activePlayer: committed.activePlayer,
        actor: committed.actor,
        clocks: committed.clocks,
      },
    });

    expect(state.resyncRequired).toBe(true);
    expect(state.snapshot?.version).toBe(0);
  });

  it("discards a committed move it cannot replay and asks for a snapshot", () => {
    const state = matchChannelReducer(withSnapshot(), {
      type: "move-committed",
      event: {
        matchId: MATCH_ID,
        version: 1,
        move: { kind: "board", from: "r0c0", to: "r0c1" },
        activePlayer: "dark",
        actor: "light",
        clocks: makeSnapshot().clocks,
      },
    });

    expect(state.discarded).toBe(1);
    expect(state.resyncRequired).toBe(true);
  });

  it("clears a pending command a replay already contains", () => {
    const sent = matchChannelReducer(withSnapshot(), {
      type: "command-sent",
      command: pendingMove(0),
    });
    const committed = committedFrom(1);

    const state = matchChannelReducer(sent, {
      type: "move-committed",
      event: {
        matchId: committed.matchId,
        version: committed.version,
        move: committed.move,
        activePlayer: committed.activePlayer,
        actor: committed.actor,
        clocks: committed.clocks,
      },
    });

    expect(state.pending).toBeNull();
  });

  it("keeps a pending command when the event is one it already knows", () => {
    const sent = matchChannelReducer(
      matchChannelReducer(withSnapshot(), {
        type: "snapshot",
        snapshot: makeSnapshot({ version: 2 }),
      }),
      { type: "command-sent", command: pendingMove(2) },
    );

    const state = matchChannelReducer(sent, {
      type: "move-committed",
      event: {
        matchId: MATCH_ID,
        version: 2,
        move: OPENING,
        activePlayer: "dark",
        actor: "light",
        clocks: makeSnapshot().clocks,
      },
    });

    expect(state.pending).not.toBeNull();
    expect(state.snapshot?.version).toBe(2);
  });

  it("ignores events that name another match", () => {
    const other = "55555555-5555-4555-8555-555555555555";
    const held = withSnapshot();

    expect(
      matchChannelReducer(held, {
        type: "move-committed",
        event: {
          matchId: other,
          version: 1,
          move: OPENING,
          activePlayer: "dark",
          actor: "light",
          clocks: makeSnapshot().clocks,
        },
      }),
    ).toBe(held);
    expect(
      matchChannelReducer(held, {
        type: "clock-sync",
        event: {
          matchId: other,
          version: 0,
          activePlayer: "light",
          lightRemainingMs: 1,
          darkRemainingMs: 1,
          serverTime: SERVER_TIME,
        },
      }),
    ).toBe(held);
    expect(
      matchChannelReducer(held, {
        type: "ended",
        event: { matchId: other, version: 1, result: "light", reason: "resignation" },
      }),
    ).toBe(held);
  });

  it("takes a clock reading for the version it holds", () => {
    const state = matchChannelReducer(withSnapshot(), {
      type: "clock-sync",
      event: {
        matchId: MATCH_ID,
        version: 0,
        activePlayer: "light",
        lightRemainingMs: 291_000,
        darkRemainingMs: 300_000,
        serverTime: SERVER_TIME + 9000,
      },
    });

    expect(state.snapshot?.clocks.lightRemainingMs).toBe(291_000);
    expect(state.snapshot?.clocks.serverTime).toBe(SERVER_TIME + 9000);
  });

  it("asks for a snapshot when a clock reading is ahead of it, and ignores a stale one", () => {
    const ahead = matchChannelReducer(withSnapshot(), {
      type: "clock-sync",
      event: {
        matchId: MATCH_ID,
        version: 3,
        activePlayer: "dark",
        lightRemainingMs: 1000,
        darkRemainingMs: 1000,
        serverTime: SERVER_TIME,
      },
    });
    expect(ahead.resyncRequired).toBe(true);

    const held = matchChannelReducer(withSnapshot(), {
      type: "snapshot",
      snapshot: makeSnapshot({ version: 6 }),
    });
    const stale = matchChannelReducer(held, {
      type: "clock-sync",
      event: {
        matchId: MATCH_ID,
        version: 5,
        activePlayer: "dark",
        lightRemainingMs: 1000,
        darkRemainingMs: 1000,
        serverTime: SERVER_TIME,
      },
    });
    expect(stale).toBe(held);
  });

  it("records the end of a match and stops accepting input", () => {
    const state = matchChannelReducer(withSnapshot(), {
      type: "ended",
      event: { matchId: MATCH_ID, version: 1, result: "dark", reason: "timeout" },
    });

    expect(state.ended?.result).toBe("dark");
    expect(state.resyncRequired).toBe(true);
    expect(state.pending).toBeNull();
  });

  it("restores the snapshot a rejection carried and explains why", () => {
    const sent = matchChannelReducer(withSnapshot(), {
      type: "command-sent",
      command: pendingMove(0),
    });

    const state = matchChannelReducer(sent, {
      type: "command-answered",
      ack: {
        ok: false,
        commandId: pendingMove(0).commandId,
        reason: "stale-version",
        snapshot: makeSnapshot({ version: 3 }),
      },
    });

    expect(state.pending).toBeNull();
    expect(state.snapshot?.version).toBe(3);
    expect(state.resyncRequired).toBe(false);
    expect(state.notice).toContain("board had already moved on");
  });

  it("asks for a snapshot when a rejection carried none", () => {
    const sent = matchChannelReducer(withSnapshot(), {
      type: "command-sent",
      command: pendingMove(0),
    });

    const state = matchChannelReducer(sent, {
      type: "command-answered",
      ack: { ok: false, commandId: pendingMove(0).commandId, reason: "illegal-move" },
    });

    expect(state.resyncRequired).toBe(true);
    expect(state.notice).toBe("That move is not legal");
  });

  it("accepts an acknowledgement and clears the pending command", () => {
    const sent = matchChannelReducer(withSnapshot(), {
      type: "command-sent",
      command: pendingMove(0),
    });

    const state = matchChannelReducer(sent, {
      type: "command-answered",
      ack: { ok: true, commandId: pendingMove(0).commandId, newVersion: 1 },
    });

    expect(state.pending).toBeNull();
    expect(state.selection).toBeNull();
  });

  it("ignores an acknowledgement for another command", () => {
    const sent = matchChannelReducer(withSnapshot(), {
      type: "command-sent",
      command: pendingMove(0),
    });

    const state = matchChannelReducer(sent, {
      type: "command-answered",
      ack: { ok: true, commandId: "66666666-6666-4666-8666-666666666666", newVersion: 1 },
    });

    expect(state).toBe(sent);
  });

  it("previews a pending move without changing the held version", () => {
    const sent = matchChannelReducer(withSnapshot(), {
      type: "command-sent",
      command: pendingMove(0),
    });

    const preview = previewSnapshot(sent);

    expect(sent.snapshot?.version).toBe(0);
    expect(preview?.version).toBe(0);
    expect(preview?.activePlayer).toBe("dark");
    expect(preview?.state).toEqual(committedFrom(1).expectedState);
  });

  it("previews nothing when there is no pending move or it no longer fits", () => {
    const held = withSnapshot();
    expect(previewSnapshot(held)).toBe(held.snapshot);

    const stalePending = matchChannelReducer(held, {
      type: "command-sent",
      command: pendingMove(7),
    });
    expect(previewSnapshot(stalePending)).toBe(held.snapshot);

    const illegal = matchChannelReducer(held, {
      type: "command-sent",
      command: { ...pendingMove(0), move: { kind: "board", from: "r0c0", to: "r0c1" } },
    });
    expect(previewSnapshot(illegal)).toBe(held.snapshot);

    expect(previewSnapshot(INITIAL_MATCH_CHANNEL)).toBeNull();
  });

  it("locks selection while a command is pending or the socket is not ready", () => {
    const ready = withSnapshot();
    expect(isInputLocked(ready)).toBe(false);

    const selected = matchChannelReducer(ready, {
      type: "select",
      selection: { player: "light", kind: "reserve", reserveStack: 0 },
    });
    expect(selected.selection).toEqual({ player: "light", kind: "reserve", reserveStack: 0 });

    const pending = matchChannelReducer(selected, {
      type: "command-sent",
      command: pendingMove(0),
    });
    expect(isInputLocked(pending)).toBe(true);
    expect(matchChannelReducer(pending, { type: "select", selection: null })).toBe(pending);

    const reconnecting = matchChannelReducer(ready, { type: "phase", phase: "reconnecting" });
    expect(isInputLocked(reconnecting)).toBe(true);
  });

  it("counts a discarded payload and asks for a snapshot", () => {
    const state = matchChannelReducer(withSnapshot(), {
      type: "discarded",
      reason: "unreadable",
    });

    expect(state.discarded).toBe(1);
    expect(state.resyncRequired).toBe(true);
    expect(state.notice).toBe("unreadable");
    expect(matchChannelReducer(state, { type: "resynced" }).resyncRequired).toBe(false);
    expect(matchChannelReducer(state, { type: "notice", notice: null }).notice).toBeNull();
  });
});
