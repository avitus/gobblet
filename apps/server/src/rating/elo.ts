import {
  ELO_K_FACTOR,
  MINIMUM_RATING,
  RATING_FORMULA_VERSION,
  STARTING_RATING,
} from "@gobblet/protocol";
import type { RatingChange, RatingOutcome } from "@gobblet/protocol";

/**
 * Standard Elo, exactly as docs/product-spec.md section 10 states it, with no
 * provisional K factor and no separate rating per time control. The module is pure
 * so the arithmetic can be checked against reference vectors without a database
 * (docs/adr/0019-elo-in-the-completion-transaction.md).
 */

const SCORES: Readonly<Record<RatingOutcome, number>> = Object.freeze({
  win: 1,
  loss: 0,
  draw: 0.5,
});

export function scoreOf(outcome: RatingOutcome): number {
  return SCORES[outcome];
}

export function expectedScore(rating: number, opponentRating: number): number {
  return 1 / (1 + 10 ** ((opponentRating - rating) / 400));
}

/**
 * The rating after one result. Rounded to the nearest integer and clamped at the
 * floor, so a losing run stops at zero rather than going negative (appendix P4).
 */
export function nextRating(
  rating: number,
  opponentRating: number,
  outcome: RatingOutcome,
  kFactor: number = ELO_K_FACTOR,
): number {
  const unrounded = rating + kFactor * (scoreOf(outcome) - expectedScore(rating, opponentRating));
  return Math.max(MINIMUM_RATING, Math.round(unrounded));
}

export function ratingChange(
  rating: number,
  opponentRating: number,
  outcome: RatingOutcome,
): RatingChange {
  const after = nextRating(rating, opponentRating, outcome);
  return {
    before: rating,
    after,
    delta: after - rating,
    opponentBefore: opponentRating,
    outcome,
    formulaVersion: RATING_FORMULA_VERSION,
  };
}

/** The outcome each side records, from the result stored on the match. */
export function outcomesOf(result: "light" | "dark" | "draw"): Readonly<{
  light: RatingOutcome;
  dark: RatingOutcome;
}> {
  if (result === "draw") {
    return { light: "draw", dark: "draw" };
  }
  return result === "light" ? { light: "win", dark: "loss" } : { light: "loss", dark: "win" };
}

export type RatingAggregate = Readonly<{
  rating: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  currentStreak: number;
  bestStreak: number;
}>;

/** The aggregate an account starts from, used until its first ranked result. */
export function startingAggregate(): RatingAggregate {
  return {
    rating: STARTING_RATING,
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    currentStreak: 0,
    bestStreak: 0,
  };
}

/**
 * Folds one result into an aggregate. A streak is positive while winning and
 * negative while losing, a draw ends it, and the best streak only ever counts
 * wins (docs/product-spec.md section 15.4).
 */
export function applyResult(
  aggregate: RatingAggregate,
  outcome: RatingOutcome,
  rating: number,
): RatingAggregate {
  const currentStreak = nextStreak(aggregate.currentStreak, outcome);
  return {
    rating,
    gamesPlayed: aggregate.gamesPlayed + 1,
    wins: aggregate.wins + (outcome === "win" ? 1 : 0),
    losses: aggregate.losses + (outcome === "loss" ? 1 : 0),
    draws: aggregate.draws + (outcome === "draw" ? 1 : 0),
    currentStreak,
    bestStreak: Math.max(aggregate.bestStreak, currentStreak),
  };
}

function nextStreak(currentStreak: number, outcome: RatingOutcome): number {
  if (outcome === "draw") {
    return 0;
  }
  if (outcome === "win") {
    return currentStreak > 0 ? currentStreak + 1 : 1;
  }
  return currentStreak < 0 ? currentStreak - 1 : -1;
}
