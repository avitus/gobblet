import { describe, expect, it } from "vitest";
import {
  createDevMatchRequestSchema,
  createDevMatchResponseSchema,
  createGuestRequestSchema,
  createGuestResponseSchema,
  matchSummarySchema,
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
    expect(createGuestRequestSchema.safeParse({ displayName: "" }).success).toBe(false);
    expect(createGuestRequestSchema.safeParse({ displayName: "a".repeat(33) }).success).toBe(false);
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
      createdAt: "2026-07-25T09:59:00.000Z",
      startedAt: "2026-07-25T10:00:00.000Z",
      endedAt: null,
    };

    expect(matchSummarySchema.parse(summary)).toEqual(summary);
  });

  it("accepts a completed summary and rejects an unknown end reason", () => {
    const summary = {
      matchId: MATCH_ID,
      mode: "casual",
      timeControlSeconds: 180,
      status: "completed",
      result: { outcome: "draw", reason: "repetition" },
      players: buildSnapshot().players,
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
