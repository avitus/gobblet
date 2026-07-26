import { describe, expect, it } from "vitest";
import {
  createDevMatchRequestSchema,
  createDevMatchResponseSchema,
  createGuestRequestSchema,
  createGuestResponseSchema,
  httpErrorBodySchema,
  httpErrorDetails,
  matchHistoryResponseSchema,
  matchSummarySchema,
  playerMatchSummarySchema,
  type CreateDevMatchRequest,
  type CreateGuestResponse,
} from "../src/index";
import { DARK_ACTOR_ID, LIGHT_ACTOR_ID, MATCH_ID, buildSnapshot } from "./helpers/fixtures";

const guestResponse: CreateGuestResponse = {
  guestId: DARK_ACTOR_ID,
  displayName: "guest-7f21",
  sessionToken: "session-token-placeholder",
  expiresAt: "2026-07-26T10:00:00.000Z",
};

const devMatchRequest: CreateDevMatchRequest = {
  mode: "casual",
  timeControlSeconds: 300,
  light: { actorType: "user", actorId: LIGHT_ACTOR_ID, displayName: "ada" },
  dark: { actorType: "guest", actorId: DARK_ACTOR_ID, displayName: "guest-7f21" },
  firstPlayer: "light",
};

describe("guest endpoints", () => {
  it("round trips a guest response", () => {
    expect(createGuestResponseSchema.parse(guestResponse)).toEqual(guestResponse);
  });

  it("rejects a guest response with a non-ISO expiry or an unknown field", () => {
    expect(
      createGuestResponseSchema.safeParse({ ...guestResponse, expiresAt: 1753392000000 }).success,
    ).toBe(false);
    expect(createGuestResponseSchema.safeParse({ ...guestResponse, tokenHash: "x" }).success).toBe(
      false,
    );
  });

  it("treats the requested display name as optional but bounded", () => {
    expect(createGuestRequestSchema.parse({})).toEqual({});
    expect(createGuestRequestSchema.parse({ displayName: "ada" })).toEqual({ displayName: "ada" });
    // Trimmed before validation, so padding cannot create two identical looking names.
    expect(createGuestRequestSchema.parse({ displayName: "  ada  " })).toEqual({
      displayName: "ada",
    });
    expect(createGuestRequestSchema.safeParse({ displayName: "   " }).success).toBe(false);
    expect(createGuestRequestSchema.safeParse({ displayName: "" }).success).toBe(false);
    expect(createGuestRequestSchema.safeParse({ displayName: "a".repeat(33) }).success).toBe(false);
  });
});

describe("error bodies", () => {
  it("accepts the documented problem shape with and without details", () => {
    const withoutDetails = {
      error: { code: "not_found", message: "Unknown match", requestId: "req-1" },
    };
    const withDetails = {
      error: {
        code: "validation_failed",
        message: "Invalid request",
        requestId: "req-2",
        details: [{ path: "timeControlSeconds", issue: "invalid_value" }],
      },
    };

    expect(httpErrorBodySchema.parse(withoutDetails)).toEqual(withoutDetails);
    expect(httpErrorBodySchema.parse(withDetails)).toEqual(withDetails);
  });

  it("rejects an undocumented code or a missing request id", () => {
    expect(
      httpErrorBodySchema.safeParse({
        error: { code: "kaboom", message: "no", requestId: "req-3" },
      }).success,
    ).toBe(false);
    expect(
      httpErrorBodySchema.safeParse({ error: { code: "internal_error", message: "no" } }).success,
    ).toBe(false);
  });

  it("describes a validation failure by path and rule, never by value", () => {
    const result = createDevMatchRequestSchema.safeParse({
      ...devMatchRequest,
      timeControlSeconds: 60,
      light: { actorType: "guest", actorId: "not-a-uuid", displayName: "ada" },
    });
    if (result.success) {
      throw new Error("expected the request to be rejected");
    }

    const details = httpErrorDetails(result.error);

    expect(details).toEqual(
      expect.arrayContaining([
        { path: "timeControlSeconds", issue: expect.any(String) },
        { path: "light.actorId", issue: expect.any(String) },
      ]),
    );
    expect(JSON.stringify(details)).not.toContain("not-a-uuid");
  });
});

describe("dev match endpoint", () => {
  it("accepts a valid request with and without an explicit first player", () => {
    const { firstPlayer: _firstPlayer, ...withoutFirstPlayer } = devMatchRequest;

    expect(createDevMatchRequestSchema.parse(devMatchRequest)).toEqual(devMatchRequest);
    expect(createDevMatchRequestSchema.parse(withoutFirstPlayer)).toEqual(withoutFirstPlayer);
  });

  it("rejects an unsupported time control", () => {
    expect(
      createDevMatchRequestSchema.safeParse({ ...devMatchRequest, timeControlSeconds: 60 }).success,
    ).toBe(false);
  });

  it("rejects an unknown mode", () => {
    expect(
      createDevMatchRequestSchema.safeParse({ ...devMatchRequest, mode: "blitz" }).success,
    ).toBe(false);
  });

  it("rejects an unknown first player", () => {
    expect(
      createDevMatchRequestSchema.safeParse({ ...devMatchRequest, firstPlayer: "white" }).success,
    ).toBe(false);
  });

  it("returns the created match with its snapshot", () => {
    const response = { matchId: MATCH_ID, snapshot: buildSnapshot({ status: "queued" }) };

    expect(createDevMatchResponseSchema.parse(response)).toEqual(response);
  });
});

describe("matchSummarySchema", () => {
  it("accepts an in-progress summary with null result and end timestamps", () => {
    const summary = {
      matchId: MATCH_ID,
      mode: "ranked",
      timeControlSeconds: 600,
      status: "active",
      result: null,
      players: buildSnapshot().players,
      moveCount: 4,
      createdAt: "2026-07-25T09:59:00.000Z",
      startedAt: "2026-07-25T10:00:00.000Z",
      endedAt: null,
    };

    expect(matchSummarySchema.parse(summary)).toEqual(summary);
    expect(matchSummarySchema.safeParse({ ...summary, moveCount: -1 }).success).toBe(false);
  });

  it("accepts a completed summary and rejects an unknown end reason", () => {
    const summary = {
      matchId: MATCH_ID,
      mode: "casual",
      timeControlSeconds: 180,
      status: "completed",
      result: { outcome: "draw", reason: "repetition" },
      players: buildSnapshot().players,
      moveCount: 42,
      createdAt: "2026-07-25T09:59:00.000Z",
      startedAt: "2026-07-25T10:00:00.000Z",
      endedAt: "2026-07-25T10:07:00.000Z",
    };

    expect(matchSummarySchema.parse(summary)).toEqual(summary);
    expect(
      matchSummarySchema.safeParse({
        ...summary,
        result: { outcome: "draw", reason: "agreement" },
      }).success,
    ).toBe(false);
  });
});

describe("playerMatchSummarySchema", () => {
  const summary = {
    matchId: MATCH_ID,
    mode: "ranked",
    timeControlSeconds: 300,
    status: "completed",
    result: { outcome: "light", reason: "line" },
    players: buildSnapshot().players,
    moveCount: 11,
    createdAt: "2026-07-25T09:59:00.000Z",
    startedAt: "2026-07-25T10:00:00.000Z",
    endedAt: "2026-07-25T10:07:00.000Z",
    side: "light",
    outcome: "win",
    ratingDelta: 16,
  };

  it("carries the reader's colour, their result and their rating change", () => {
    expect(playerMatchSummarySchema.parse(summary)).toEqual(summary);
  });

  it("leaves the outcome and the rating change unset where there is none", () => {
    expect(
      playerMatchSummarySchema.parse({
        ...summary,
        mode: "casual",
        status: "active",
        result: null,
        outcome: null,
        ratingDelta: null,
        endedAt: null,
      }).ratingDelta,
    ).toBeNull();
  });

  it("rejects a result that is not one of win, loss or draw", () => {
    expect(playerMatchSummarySchema.safeParse({ ...summary, outcome: "light" }).success).toBe(
      false,
    );
    expect(playerMatchSummarySchema.safeParse({ ...summary, side: "white" }).success).toBe(false);
  });
});

describe("matchHistoryResponseSchema", () => {
  it("accepts an empty history and a history of summaries", () => {
    const summary = {
      matchId: MATCH_ID,
      mode: "casual",
      timeControlSeconds: 300,
      status: "completed",
      result: { outcome: "light", reason: "line" },
      players: buildSnapshot().players,
      moveCount: 7,
      createdAt: "2026-07-25T09:59:00.000Z",
      startedAt: "2026-07-25T10:00:00.000Z",
      endedAt: "2026-07-25T10:07:00.000Z",
      side: "dark",
      outcome: "loss",
      ratingDelta: null,
    };

    expect(matchHistoryResponseSchema.parse({ matches: [] })).toEqual({ matches: [] });
    expect(matchHistoryResponseSchema.parse({ matches: [summary] }).matches).toHaveLength(1);
    expect(matchHistoryResponseSchema.safeParse({ matches: [{ matchId: MATCH_ID }] }).success).toBe(
      false,
    );
  });
});
