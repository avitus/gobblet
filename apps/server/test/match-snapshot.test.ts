import { matchSnapshotSchema, matchSummarySchema } from "@gobblet/protocol";
import { describe, expect, it } from "vitest";
import { matchResultOf, participantSide, toSnapshot, toSummary } from "../src/match/snapshot";
import {
  CLOCK_START,
  DARK_ACTOR,
  LIGHT_ACTOR,
  STRANGER,
  matchRowFixture,
} from "./helpers/match-fixtures";

describe("toSnapshot", () => {
  it("projects a row into the wire contract", () => {
    const snapshot = toSnapshot(matchRowFixture(), CLOCK_START + 3_000, null);

    expect(matchSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(snapshot.players.light.isGuest).toBe(true);
    expect(snapshot.players.dark.isGuest).toBe(false);
    expect(snapshot.players.dark.rating).toBeNull();
  });

  it("sends stored clocks with the turn start so the client applies the server formula", () => {
    const snapshot = toSnapshot(matchRowFixture(), CLOCK_START + 3_000, null);

    expect(snapshot.clocks).toEqual({
      lightRemainingMs: 300_000,
      darkRemainingMs: 300_000,
      turnStartedAt: CLOCK_START,
      serverTime: CLOCK_START + 3_000,
    });
  });

  it("carries the last move when one exists", () => {
    const lastMove = {
      move: { kind: "reserve", reserveStack: 0, to: "r0c0" },
      version: 1,
    } as const;

    expect(
      toSnapshot(matchRowFixture({ stateVersion: 1 }), CLOCK_START, lastMove).lastMove,
    ).toEqual(lastMove);
  });
});

describe("matchResultOf", () => {
  it("is null while the match runs", () => {
    expect(matchResultOf(matchRowFixture())).toBeNull();
  });

  it("pairs the outcome with its reason", () => {
    expect(matchResultOf(matchRowFixture({ result: "dark", endReason: "timeout" }))).toEqual({
      outcome: "dark",
      reason: "timeout",
    });
  });

  it("refuses a half written result", () => {
    expect(matchResultOf(matchRowFixture({ result: "dark", endReason: null }))).toBeNull();
  });
});

describe("participantSide", () => {
  it("identifies both participants", () => {
    const row = matchRowFixture();

    expect(participantSide(row, LIGHT_ACTOR)).toBe("light");
    expect(participantSide(row, { actorType: "user", actorId: DARK_ACTOR.actorId })).toBe("dark");
  });

  it("rejects a matching id with the wrong actor type", () => {
    expect(participantSide(matchRowFixture(), DARK_ACTOR)).toBeNull();
  });

  it("rejects an unrelated actor", () => {
    expect(participantSide(matchRowFixture(), STRANGER)).toBeNull();
  });
});

describe("toSummary", () => {
  it("uses ISO timestamps for the HTTP surface", () => {
    const summary = toSummary(
      matchRowFixture({
        status: "completed",
        result: "light",
        endReason: "line",
        endedAt: new Date(CLOCK_START + 60_000),
      }),
    );

    expect(matchSummarySchema.parse(summary)).toEqual(summary);
    expect(summary.startedAt).toBe(new Date(CLOCK_START).toISOString());
    expect(summary.endedAt).toBe(new Date(CLOCK_START + 60_000).toISOString());
  });

  it("reports a match that never started", () => {
    const summary = toSummary(matchRowFixture({ status: "queued", startedAt: null }));

    expect(summary.startedAt).toBeNull();
    expect(summary.endedAt).toBeNull();
  });
});
