import { describe, expect, it } from "vitest";
import {
  LEADERBOARD_PAGE_SIZE,
  LEADERBOARD_PERIODS,
  decodeLeaderboardCursor,
  encodeLeaderboardCursor,
  isLeaderboardPeriod,
  leaderboardEntrySchema,
  leaderboardQuerySchema,
  leaderboardResponseSchema,
  type LeaderboardCursor,
  type LeaderboardEntry,
} from "../src/index";
import { LIGHT_ACTOR_ID } from "./helpers/fixtures";

const entry: LeaderboardEntry = {
  rank: 1,
  username: "ada",
  avatarUrl: null,
  countryCode: "GB",
  rating: 1642,
  wins: 12,
  games: 15,
  ratedAt: "2026-07-25T10:07:00.000Z",
};

const cursor: LeaderboardCursor = {
  rating: 1642,
  wins: 12,
  games: 15,
  ratedAt: 1_784_980_800_000,
  userId: LIGHT_ACTOR_ID,
};

describe("the leaderboard periods", () => {
  it("offers the four boards of section 11.3", () => {
    expect([...LEADERBOARD_PERIODS]).toEqual(["daily", "weekly", "monthly", "all-time"]);
    expect(isLeaderboardPeriod("weekly")).toBe(true);
    expect(isLeaderboardPeriod("hourly")).toBe(false);
  });

  it("caps a page at the top hundred", () => {
    expect(LEADERBOARD_PAGE_SIZE).toBe(100);
    expect(leaderboardQuerySchema.parse({ period: "daily", limit: 100 }).limit).toBe(100);
    expect(leaderboardQuerySchema.safeParse({ period: "daily", limit: 101 }).success).toBe(false);
    expect(leaderboardQuerySchema.safeParse({ period: "daily", limit: 0 }).success).toBe(false);
  });

  it("takes a period alone, and rejects an unknown period or field", () => {
    expect(leaderboardQuerySchema.parse({ period: "all-time" })).toEqual({ period: "all-time" });
    expect(leaderboardQuerySchema.safeParse({ period: "yearly" }).success).toBe(false);
    expect(leaderboardQuerySchema.safeParse({ period: "daily", offset: 100 }).success).toBe(false);
  });
});

describe("leaderboardEntrySchema", () => {
  it("shows the public identity and the period record, never the user id", () => {
    expect(leaderboardEntrySchema.parse(entry)).toEqual(entry);
    expect(leaderboardEntrySchema.safeParse({ ...entry, userId: LIGHT_ACTOR_ID }).success).toBe(
      false,
    );
  });

  it("rejects a rank of zero, because a rank is a position not an index", () => {
    expect(leaderboardEntrySchema.safeParse({ ...entry, rank: 0 }).success).toBe(false);
  });
});

describe("leaderboardResponseSchema", () => {
  it("bounds a period board and leaves the all-time board unbounded", () => {
    const daily = {
      period: "daily",
      periodStart: "2026-07-25T00:00:00.000Z",
      periodEnd: "2026-07-26T00:00:00.000Z",
      generatedAt: "2026-07-25T10:07:00.000Z",
      entries: [entry],
      nextCursor: encodeLeaderboardCursor(cursor),
      you: { ...entry, rank: 412, username: "grace" },
    };
    const allTime = {
      ...daily,
      period: "all-time",
      periodStart: null,
      periodEnd: null,
      nextCursor: null,
      you: null,
    };

    expect(leaderboardResponseSchema.parse(daily)).toEqual(daily);
    expect(leaderboardResponseSchema.parse(allTime)).toEqual(allTime);
  });

  it("rejects a response that omits the caller's row or the snapshot instant", () => {
    const { you: _you, ...withoutYou } = {
      period: "monthly" as const,
      periodStart: null,
      periodEnd: null,
      generatedAt: "2026-07-25T10:07:00.000Z",
      entries: [],
      nextCursor: null,
      you: null,
    };

    expect(leaderboardResponseSchema.safeParse(withoutYou).success).toBe(false);
    expect(leaderboardResponseSchema.safeParse({ ...withoutYou, you: null }).success).toBe(true);
  });
});

describe("the leaderboard cursor", () => {
  it("round trips the whole sort key, so a page cannot skip or repeat an account", () => {
    expect(decodeLeaderboardCursor(encodeLeaderboardCursor(cursor))).toEqual(cursor);
  });

  it("is opaque text a client can echo back unchanged", () => {
    const encoded = encodeLeaderboardCursor(cursor);

    expect(encoded).toBe(`1642.12.15.1784980800000.${LIGHT_ACTOR_ID}`);
    expect(encodeURIComponent(encoded)).toBe(encoded);
  });

  it("refuses a malformed or tampered cursor instead of guessing", () => {
    expect(decodeLeaderboardCursor("")).toBeNull();
    expect(decodeLeaderboardCursor("1642.12.15")).toBeNull();
    expect(decodeLeaderboardCursor(`1642.12.15.1784980800000.${LIGHT_ACTOR_ID}.x`)).toBeNull();
    expect(decodeLeaderboardCursor("abc.12.15.1784980800000.not-a-uuid")).toBeNull();
    expect(decodeLeaderboardCursor(`1642.12.15.1784980800000.nope`)).toBeNull();
    expect(decodeLeaderboardCursor(`-1.12.15.1784980800000.${LIGHT_ACTOR_ID}`)).toBeNull();
  });
});
