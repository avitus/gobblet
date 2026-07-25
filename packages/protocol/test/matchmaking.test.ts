import { describe, expect, it } from "vitest";
import {
  COLOR_ASSIGNMENTS,
  ELO_K_FACTOR,
  MINIMUM_RATING,
  QUEUE_REJECTION_REASONS,
  RATING_FORMULA_VERSION,
  RATING_OUTCOMES,
  REMATCH_REJECTION_REASONS,
  REMATCH_STATES,
  STARTING_RATING,
  isColorAssignment,
  isRematchState,
  matchEndedEventSchema,
  matchFoundEventSchema,
  matchRatingChangesSchema,
  queueJoinAckSchema,
  queueJoinRequestSchema,
  queueLeaveAckSchema,
  queueStatusSchema,
  rankedRecordSchema,
  ratingChangeSchema,
  ratingValueSchema,
  rematchAckSchema,
  rematchRequestSchema,
  rematchRespondSchema,
  rematchStatusEventSchema,
  type MatchFoundEvent,
  type QueueStatus,
  type RatingChange,
  type RematchStatusEvent,
} from "../src/index";
import { DARK_ACTOR_ID, LIGHT_ACTOR_ID, MATCH_ID, buildSnapshot } from "./helpers/fixtures";

const status: QueueStatus = {
  mode: "ranked",
  timeControlSeconds: 300,
  rating: 1200,
  waitingMs: 12_000,
  ratingWindow: { minimum: 1100, maximum: 1300 },
  depth: 3,
  serverTime: 1_784_980_800_000,
};

const found: MatchFoundEvent = {
  matchId: MATCH_ID,
  mode: "casual",
  timeControlSeconds: 180,
  yourColor: "light",
  opponent: { actorType: "guest", displayName: "guest-7f21", rating: null },
  waitedMs: 4_000,
  snapshot: buildSnapshot(),
};

const offer: RematchStatusEvent = {
  matchId: MATCH_ID,
  state: "offered",
  requestedBy: LIGHT_ACTOR_ID,
  expiresAt: 1_784_980_830_000,
  nextMatchId: null,
};

const change: RatingChange = {
  before: 1200,
  after: 1216,
  delta: 16,
  opponentBefore: 1200,
  outcome: "win",
  formulaVersion: RATING_FORMULA_VERSION,
};

describe("Elo constants", () => {
  it("match the values fixed by the specification", () => {
    expect(STARTING_RATING).toBe(1200);
    expect(ELO_K_FACTOR).toBe(32);
    expect(MINIMUM_RATING).toBe(0);
    expect(RATING_FORMULA_VERSION).toBe(1);
    expect([...RATING_OUTCOMES]).toEqual(["win", "loss", "draw"]);
  });
});

describe("queue vocabularies", () => {
  it("enumerate every refusal and every rematch state once", () => {
    expect(new Set(QUEUE_REJECTION_REASONS).size).toBe(QUEUE_REJECTION_REASONS.length);
    expect(new Set(REMATCH_REJECTION_REASONS).size).toBe(REMATCH_REJECTION_REASONS.length);
    expect([...REMATCH_STATES]).toEqual([
      "offered",
      "accepted",
      "declined",
      "expired",
      "cancelled",
    ]);
    expect([...COLOR_ASSIGNMENTS]).toEqual(["random", "alternated"]);
  });

  it("recognise their own members and nothing else", () => {
    expect(isRematchState("offered")).toBe(true);
    expect(isRematchState("pending")).toBe(false);
    expect(isColorAssignment("random")).toBe(true);
    expect(isColorAssignment("coin-toss")).toBe(false);
    expect(isColorAssignment(7)).toBe(false);
  });
});

describe("queueJoinRequestSchema", () => {
  it("accepts a supported queue and rejects an unsupported one", () => {
    expect(queueJoinRequestSchema.parse({ mode: "ranked", timeControlSeconds: 600 })).toEqual({
      mode: "ranked",
      timeControlSeconds: 600,
    });
    expect(
      queueJoinRequestSchema.safeParse({ mode: "ranked", timeControlSeconds: 60 }).success,
    ).toBe(false);
    expect(
      queueJoinRequestSchema.safeParse({ mode: "blitz", timeControlSeconds: 600 }).success,
    ).toBe(false);
    expect(
      queueJoinRequestSchema.safeParse({ mode: "ranked", timeControlSeconds: 600, region: "eu" })
        .success,
    ).toBe(false);
  });
});

describe("queueStatusSchema", () => {
  it("round trips a ranked status with a window", () => {
    expect(queueStatusSchema.parse(status)).toEqual(status);
  });

  it("allows a casual status with no window at all", () => {
    expect(
      queueStatusSchema.parse({ ...status, mode: "casual", ratingWindow: null }),
    ).toMatchObject({ ratingWindow: null });
  });

  it("rejects a negative wait and an empty queue the caller is supposedly in", () => {
    expect(queueStatusSchema.safeParse({ ...status, waitingMs: -1 }).success).toBe(false);
    expect(queueStatusSchema.safeParse({ ...status, depth: 0 }).success).toBe(false);
  });
});

describe("queue acknowledgements", () => {
  it("name which of the three outcomes a join had", () => {
    expect(queueJoinAckSchema.parse({ state: "queued", status })).toEqual({
      state: "queued",
      status,
    });
    expect(queueJoinAckSchema.parse({ state: "matched", matchId: MATCH_ID })).toEqual({
      state: "matched",
      matchId: MATCH_ID,
    });
    expect(queueJoinAckSchema.parse({ state: "refused", reason: "ineligible" })).toEqual({
      state: "refused",
      reason: "ineligible",
    });
  });

  it("cannot mix two outcomes or invent a third", () => {
    expect(
      queueJoinAckSchema.safeParse({ state: "queued", status, matchId: MATCH_ID }).success,
    ).toBe(false);
    expect(queueJoinAckSchema.safeParse({ state: "waiting", status }).success).toBe(false);
  });

  it("answer a leave with a confirmation or a reason", () => {
    expect(queueLeaveAckSchema.parse({ ok: true })).toEqual({ ok: true });
    expect(queueLeaveAckSchema.parse({ ok: false, reason: "not-queued" })).toEqual({
      ok: false,
      reason: "not-queued",
    });
    expect(queueLeaveAckSchema.safeParse({ ok: false, reason: "bored" }).success).toBe(false);
  });
});

describe("matchFoundEventSchema", () => {
  it("names the recipient's colour and carries the opening snapshot", () => {
    expect(matchFoundEventSchema.parse(found)).toEqual(found);
  });

  it("rejects a missing colour and an unknown field", () => {
    const { yourColor: _yourColor, ...withoutColor } = found;

    expect(matchFoundEventSchema.safeParse(withoutColor).success).toBe(false);
    expect(matchFoundEventSchema.safeParse({ ...found, queueId: MATCH_ID }).success).toBe(false);
  });
});

describe("rematch payloads", () => {
  it("round trip a request, a response and a status", () => {
    expect(rematchRequestSchema.parse({ matchId: MATCH_ID })).toEqual({ matchId: MATCH_ID });
    expect(rematchRespondSchema.parse({ matchId: MATCH_ID, accept: true })).toEqual({
      matchId: MATCH_ID,
      accept: true,
    });
    expect(rematchStatusEventSchema.parse(offer)).toEqual(offer);
    expect(
      rematchStatusEventSchema.parse({ ...offer, state: "accepted", nextMatchId: DARK_ACTOR_ID }),
    ).toMatchObject({ state: "accepted", nextMatchId: DARK_ACTOR_ID });
  });

  it("rejects an answer that is not a boolean and an unknown state", () => {
    expect(rematchRespondSchema.safeParse({ matchId: MATCH_ID, accept: "yes" }).success).toBe(
      false,
    );
    expect(rematchStatusEventSchema.safeParse({ ...offer, state: "maybe" }).success).toBe(false);
  });

  it("acknowledges with a status or a reason", () => {
    expect(rematchAckSchema.parse({ ok: true, status: offer })).toEqual({
      ok: true,
      status: offer,
    });
    expect(rematchAckSchema.parse({ ok: false, reason: "match-not-ended" })).toEqual({
      ok: false,
      reason: "match-not-ended",
    });
    expect(rematchAckSchema.safeParse({ ok: false, reason: "declined" }).success).toBe(false);
  });
});

describe("rating payloads", () => {
  it("round trip an audit record and a ranked aggregate", () => {
    expect(ratingChangeSchema.parse(change)).toEqual(change);
    const record = {
      rating: 1216,
      wins: 1,
      losses: 0,
      draws: 0,
      played: 1,
      currentStreak: 1,
      bestStreak: 1,
    };
    expect(rankedRecordSchema.parse(record)).toEqual(record);
  });

  it("refuses a negative rating and a fractional one", () => {
    expect(ratingValueSchema.safeParse(-1).success).toBe(false);
    expect(ratingValueSchema.safeParse(1200.5).success).toBe(false);
    expect(ratingValueSchema.parse(0)).toBe(0);
  });

  it("allows a negative current streak but never a negative best streak", () => {
    const losing = {
      rating: 1100,
      wins: 0,
      losses: 3,
      draws: 0,
      played: 3,
      currentStreak: -3,
      bestStreak: 0,
    };

    expect(rankedRecordSchema.parse(losing)).toEqual(losing);
    expect(rankedRecordSchema.safeParse({ ...losing, bestStreak: -1 }).success).toBe(false);
  });

  it("keys a match's changes by colour", () => {
    const changes = {
      light: change,
      dark: { ...change, after: 1184, delta: -16, outcome: "loss" },
    };

    expect(matchRatingChangesSchema.parse(changes)).toEqual(changes);
    expect(matchRatingChangesSchema.safeParse({ white: change }).success).toBe(false);
  });
});

describe("matchEndedEventSchema with ratings", () => {
  it("carries both sides when the match was ranked, and nothing when it was not", () => {
    const ended = {
      matchId: MATCH_ID,
      version: 7,
      result: "light" as const,
      reason: "line" as const,
    };

    expect(matchEndedEventSchema.parse(ended)).toEqual(ended);
    expect(matchEndedEventSchema.parse({ ...ended, ratings: null })).toMatchObject({
      ratings: null,
    });
    expect(
      matchEndedEventSchema.parse({
        ...ended,
        ratings: { light: change, dark: { ...change, delta: -16, after: 1184, outcome: "loss" } },
      }).ratings?.light.delta,
    ).toBe(16);
  });
});
