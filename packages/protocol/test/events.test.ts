import { describe, expect, it } from "vitest";
import {
  fatalErrorSchema,
  matchClockSyncEventSchema,
  matchEndedEventSchema,
  matchMoveCommittedEventSchema,
  matchSnapshotEventSchema,
  matchSyncAckSchema,
  matchSyncRequestSchema,
  recoverableErrorSchema,
} from "../src/index";
import { MATCH_ID, buildSnapshot, clocks } from "./helpers/fixtures";

describe("match events", () => {
  it("validates a sync request", () => {
    expect(matchSyncRequestSchema.parse({ matchId: MATCH_ID })).toEqual({ matchId: MATCH_ID });
    expect(matchSyncRequestSchema.safeParse({ matchId: "match-1" }).success).toBe(false);
  });

  it("validates the snapshot event against the snapshot contract", () => {
    const snapshot = buildSnapshot();

    expect(matchSnapshotEventSchema.parse(snapshot)).toEqual(snapshot);
  });

  it("validates a committed move", () => {
    const event = {
      matchId: MATCH_ID,
      version: 18,
      move: { kind: "reserve", reserveStack: 1, to: "r1c1" },
      activePlayer: "dark",
      clocks,
      actor: "light",
    };

    expect(matchMoveCommittedEventSchema.parse(event)).toEqual(event);
    expect(matchMoveCommittedEventSchema.safeParse({ ...event, actor: "white" }).success).toBe(
      false,
    );
  });

  it("validates a clock sync and rejects a negative remaining time", () => {
    const event = {
      matchId: MATCH_ID,
      version: 18,
      activePlayer: "dark",
      lightRemainingMs: 214300,
      darkRemainingMs: 0,
      serverTime: 1753392003250,
    };

    expect(matchClockSyncEventSchema.parse(event)).toEqual(event);
    expect(matchClockSyncEventSchema.safeParse({ ...event, darkRemainingMs: -1 }).success).toBe(
      false,
    );
  });

  it("validates a terminal outcome", () => {
    const event = { matchId: MATCH_ID, version: 19, result: "light", reason: "revealed-line" };

    expect(matchEndedEventSchema.parse(event)).toEqual(event);
    expect(matchEndedEventSchema.safeParse({ ...event, reason: "stalemate" }).success).toBe(false);
    expect(matchEndedEventSchema.safeParse({ ...event, ratingChange: 8 }).success).toBe(false);
  });
});

describe("error events", () => {
  it("requires retryable true on a recoverable error and allows context", () => {
    const error = {
      code: "rate_limited",
      message: "Too many commands, slow down.",
      retryable: true,
      context: { retryAfterMs: 1000 },
    };

    expect(recoverableErrorSchema.parse(error)).toEqual(error);
    expect(recoverableErrorSchema.parse({ ...error, context: undefined }).context).toBeUndefined();
    expect(recoverableErrorSchema.safeParse({ ...error, retryable: false }).success).toBe(false);
  });

  it("closes the fatal error action set", () => {
    const error = {
      code: "client_unsupported",
      message: "Update required.",
      action: "update-client",
    };

    expect(fatalErrorSchema.parse(error)).toEqual(error);
    expect(fatalErrorSchema.safeParse({ ...error, action: "retry" }).success).toBe(false);
  });
});

describe("matchSyncAckSchema", () => {
  it("accepts a snapshot", () => {
    const ack = { ok: true, snapshot: buildSnapshot() };

    expect(matchSyncAckSchema.parse(ack)).toEqual(ack);
  });

  it("accepts a refusal with a reason from the rejection set", () => {
    expect(matchSyncAckSchema.parse({ ok: false, reason: "not-authorized" })).toEqual({
      ok: false,
      reason: "not-authorized",
    });
    expect(matchSyncAckSchema.safeParse({ ok: false, reason: "because" }).success).toBe(false);
  });

  it("rejects a refusal that carries a snapshot", () => {
    expect(
      matchSyncAckSchema.safeParse({
        ok: false,
        reason: "not-authorized",
        snapshot: buildSnapshot(),
      }).success,
    ).toBe(false);
  });
});
