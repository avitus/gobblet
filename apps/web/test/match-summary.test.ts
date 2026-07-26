import type { PlayerMatchSummary } from "@gobblet/protocol";
import { describe, expect, it } from "vitest";
import { describePlayerResult, describeRatingDelta } from "../src/match/summary";
import { MATCH_ID, makeSnapshot } from "./helpers/match";

function summary(overrides: Partial<PlayerMatchSummary> = {}): PlayerMatchSummary {
  return {
    matchId: MATCH_ID,
    mode: "ranked",
    timeControlSeconds: 300,
    status: "completed",
    result: { outcome: "light", reason: "line" },
    players: makeSnapshot().players,
    moveCount: 18,
    createdAt: "2026-07-20T09:00:00.000Z",
    startedAt: "2026-07-20T09:00:01.000Z",
    endedAt: "2026-07-20T09:08:00.000Z",
    side: "light",
    outcome: "win",
    ratingDelta: 12,
    ...overrides,
  };
}

describe("describePlayerResult", () => {
  it("tells the result from the seat the player held", () => {
    expect(describePlayerResult(summary())).toBe("won by line");
    expect(
      describePlayerResult(
        summary({ side: "dark", outcome: "loss", result: { outcome: "light", reason: "timeout" } }),
      ),
    ).toBe("lost by timeout");
  });

  it("names the reason a hyphen away as words", () => {
    expect(
      describePlayerResult(summary({ result: { outcome: "light", reason: "revealed-line" } })),
    ).toBe("won by revealed line");
  });

  it("says draw once, without a reason", () => {
    expect(
      describePlayerResult(
        summary({ outcome: "draw", result: { outcome: "draw", reason: "repetition" } }),
      ),
    ).toBe("draw");
  });

  it("falls back to the status while a match has no result", () => {
    expect(describePlayerResult(summary({ status: "active", result: null, outcome: null }))).toBe(
      "active",
    );
    expect(describePlayerResult(summary({ status: "aborted", outcome: null, endedAt: null }))).toBe(
      "aborted",
    );
  });
});

describe("describeRatingDelta", () => {
  it("signs a change and marks a match that moved no rating", () => {
    expect(describeRatingDelta(12)).toBe("+12");
    expect(describeRatingDelta(-8)).toBe("-8");
    expect(describeRatingDelta(0)).toBe("+0");
    expect(describeRatingDelta(null)).toBe("-");
  });
});
