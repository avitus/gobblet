import { describe, expect, it } from "vitest";
import { ELO_K_FACTOR, RATING_FORMULA_VERSION, STARTING_RATING } from "@gobblet/protocol";
import {
  applyResult,
  expectedScore,
  nextRating,
  outcomesOf,
  ratingChange,
  scoreOf,
  startingAggregate,
} from "../src/rating/elo";

/**
 * Reference vectors for the formula in docs/product-spec.md section 10, computed
 * by hand from `expected = 1 / (1 + 10 ^ ((opponent - rating) / 400))` with K = 32
 * and rounded to the nearest integer. They are the fixed point the implementation
 * is held against, so a refactor cannot quietly change anyone's rating.
 */
const VECTORS: readonly Readonly<{
  rating: number;
  opponent: number;
  outcome: "win" | "loss" | "draw";
  expected: number;
}>[] = Object.freeze([
  { rating: 1200, opponent: 1200, outcome: "win", expected: 1216 },
  { rating: 1200, opponent: 1200, outcome: "loss", expected: 1184 },
  { rating: 1200, opponent: 1200, outcome: "draw", expected: 1200 },
  { rating: 1400, opponent: 1200, outcome: "win", expected: 1408 },
  { rating: 1400, opponent: 1200, outcome: "loss", expected: 1376 },
  { rating: 1400, opponent: 1200, outcome: "draw", expected: 1392 },
  { rating: 1200, opponent: 1400, outcome: "win", expected: 1224 },
  { rating: 1200, opponent: 1400, outcome: "loss", expected: 1192 },
  { rating: 1200, opponent: 1400, outcome: "draw", expected: 1208 },
  { rating: 1000, opponent: 1800, outcome: "win", expected: 1032 },
  { rating: 1800, opponent: 1000, outcome: "loss", expected: 1768 },
  { rating: 2400, opponent: 2000, outcome: "draw", expected: 2387 },
]);

describe("expectedScore", () => {
  it("is one half between equal ratings and complementary between unequal ones", () => {
    expect(expectedScore(1200, 1200)).toBe(0.5);
    expect(expectedScore(1400, 1200) + expectedScore(1200, 1400)).toBeCloseTo(1, 12);
    expect(expectedScore(1600, 1200)).toBeCloseTo(0.909_090_909, 8);
  });

  it.each([
    [0, 4000],
    [4000, 0],
    [0, 0],
    [1200, 1201],
  ])("stays inside the open unit interval for %i against %i", (rating, opponent) => {
    const expected = expectedScore(rating, opponent);

    expect(expected).toBeGreaterThan(0);
    expect(expected).toBeLessThan(1);
  });
});

describe("scoreOf", () => {
  it("uses the scores the specification fixes", () => {
    expect(scoreOf("win")).toBe(1);
    expect(scoreOf("draw")).toBe(0.5);
    expect(scoreOf("loss")).toBe(0);
  });
});

describe("nextRating", () => {
  it.each(VECTORS)(
    "moves $rating against $opponent on a $outcome to $expected",
    ({ rating, opponent, outcome, expected }) => {
      expect(nextRating(rating, opponent, outcome)).toBe(expected);
    },
  );

  it.each([
    [1200, 1200],
    [1500, 1200],
    [1200, 1500],
    [2400, 800],
  ])("exchanges the same number of points between %i and %i", (winner, loser) => {
    const gained = nextRating(winner, loser, "win") - winner;
    const lost = loser - nextRating(loser, winner, "loss");

    expect(gained).toBe(lost);
  });

  it("gives the favourite less for a win than the underdog", () => {
    const favourite = nextRating(1600, 1200, "win") - 1600;
    const underdog = nextRating(1200, 1600, "win") - 1200;

    expect(favourite).toBeLessThan(underdog);
    expect(favourite + underdog).toBe(ELO_K_FACTOR);
  });

  it("never returns a negative rating, however far a loss would push it", () => {
    expect(nextRating(5, 5, "loss")).toBe(0);
    expect(nextRating(0, 1200, "loss")).toBe(0);
  });

  it("accepts an explicit K factor, which the specification fixes at 32 by default", () => {
    expect(nextRating(1200, 1200, "win", 16)).toBe(1208);
    expect(nextRating(1200, 1200, "win")).toBe(nextRating(1200, 1200, "win", ELO_K_FACTOR));
  });
});

describe("ratingChange", () => {
  it("records what section 10 requires to be stored", () => {
    expect(ratingChange(1200, 1400, "win")).toEqual({
      before: 1200,
      after: 1224,
      delta: 24,
      opponentBefore: 1400,
      outcome: "win",
      formulaVersion: RATING_FORMULA_VERSION,
    });
  });

  it("reports a delta that always reconstructs the new rating", () => {
    for (const vector of VECTORS) {
      const change = ratingChange(vector.rating, vector.opponent, vector.outcome);

      expect(change.before + change.delta).toBe(change.after);
      expect(change.after).toBe(vector.expected);
    }
  });
});

describe("outcomesOf", () => {
  it("turns a match result into the outcome each side records", () => {
    expect(outcomesOf("light")).toEqual({ light: "win", dark: "loss" });
    expect(outcomesOf("dark")).toEqual({ light: "loss", dark: "win" });
    expect(outcomesOf("draw")).toEqual({ light: "draw", dark: "draw" });
  });
});

describe("aggregates", () => {
  it("starts every account at the rating the specification fixes", () => {
    expect(startingAggregate()).toEqual({
      rating: STARTING_RATING,
      gamesPlayed: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      currentStreak: 0,
      bestStreak: 0,
    });
  });

  it("counts a win, extends the streak and remembers the best one", () => {
    const first = applyResult(startingAggregate(), "win", 1216);
    const second = applyResult(first, "win", 1230);

    expect(second).toMatchObject({
      rating: 1230,
      gamesPlayed: 2,
      wins: 2,
      currentStreak: 2,
      bestStreak: 2,
    });
  });

  it("turns the streak negative on a loss and keeps the best streak", () => {
    const winning = applyResult(applyResult(startingAggregate(), "win", 1216), "win", 1230);
    const losing = applyResult(applyResult(winning, "loss", 1214), "loss", 1198);

    expect(losing).toMatchObject({
      rating: 1198,
      gamesPlayed: 4,
      wins: 2,
      losses: 2,
      currentStreak: -2,
      bestStreak: 2,
    });
  });

  it("ends a streak on a draw without counting it as a best streak", () => {
    const drawn = applyResult(applyResult(startingAggregate(), "loss", 1184), "draw", 1184);

    expect(drawn).toMatchObject({
      draws: 1,
      losses: 1,
      currentStreak: 0,
      bestStreak: 0,
    });
  });

  it("keeps games played equal to the sum of the results", () => {
    const outcomes = ["win", "win", "draw", "loss", "loss", "loss", "win", "draw"] as const;

    const aggregate = outcomes.reduce(
      (carry, outcome) => applyResult(carry, outcome, carry.rating),
      startingAggregate(),
    );

    expect(aggregate.gamesPlayed).toBe(aggregate.wins + aggregate.losses + aggregate.draws);
    expect(aggregate).toMatchObject({ wins: 3, losses: 3, draws: 2, currentStreak: 0 });
    expect(aggregate.bestStreak).toBe(2);
  });
});
