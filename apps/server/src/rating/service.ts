import {
  findRating,
  insertRatingChanges,
  listRatingChangesForMatch,
  lockRatingsForUpdate,
  upsertRating,
} from "@gobblet/db";
import type {
  DatabaseExecutor,
  MatchRow,
  NewRatingChangeRow,
  RatingChangeRow,
  RatingRow,
} from "@gobblet/db";
import type { Player } from "@gobblet/game-core";
import type { MatchRatingChanges, RatingChange, RatingOutcome } from "@gobblet/protocol";
import type { SeatRatings } from "../match/snapshot";
import { applyResult, outcomesOf, ratingChange, startingAggregate } from "./elo";
import type { RatingAggregate } from "./elo";

const UNRATED: SeatRatings = Object.freeze({ light: null, dark: null });

type RatedPair = Readonly<{ light: string; dark: string }>;

/**
 * A match moves ratings only when it is ranked and both seats are accounts. A guest
 * has nothing to move, and a casual match has no rating effect at all
 * (docs/product-spec.md sections 9.3 and 10).
 */
function ratedPair(row: MatchRow): RatedPair | null {
  if (row.mode !== "ranked" || row.lightPlayerType !== "user" || row.darkPlayerType !== "user") {
    return null;
  }
  return { light: row.lightPlayerId, dark: row.darkPlayerId };
}

/** The ratings shown beside the players, read fresh so a snapshot never shows a stale one. */
export async function readSeatRatings(
  executor: DatabaseExecutor,
  row: MatchRow,
): Promise<SeatRatings> {
  const pair = ratedPair(row);
  if (!pair) {
    return UNRATED;
  }
  const [light, dark] = await Promise.all([
    findRating(executor, pair.light),
    findRating(executor, pair.dark),
  ]);
  return { light: light?.rating ?? null, dark: dark?.rating ?? null };
}

/**
 * Moves both ratings for a completed ranked match. It runs inside the transaction
 * that completed the match, so a result and the ratings it produced can never be
 * separated (docs/adr/0019-elo-in-the-completion-transaction.md). A repeated
 * completion returns what was already written rather than moving a rating twice.
 */
export async function applyRatingsForCompletion(
  tx: DatabaseExecutor,
  row: MatchRow,
): Promise<MatchRatingChanges | null> {
  const pair = ratedPair(row);
  if (!pair || row.result === null) {
    return null;
  }

  const alreadyApplied = await storedChanges(tx, row.id);
  if (alreadyApplied) {
    return alreadyApplied;
  }

  const locked = await lockRatingsForUpdate(tx, [pair.light, pair.dark]);
  const aggregates = {
    light: aggregateOf(locked, pair.light),
    dark: aggregateOf(locked, pair.dark),
  };
  const outcomes = outcomesOf(row.result);
  const changes: MatchRatingChanges = {
    light: ratingChange(aggregates.light.rating, aggregates.dark.rating, outcomes.light),
    dark: ratingChange(aggregates.dark.rating, aggregates.light.rating, outcomes.dark),
  };

  await insertRatingChanges(tx, [
    changeRow(row.id, pair.light, "light", changes.light),
    changeRow(row.id, pair.dark, "dark", changes.dark),
  ]);
  await writeAggregate(tx, pair.light, aggregates.light, outcomes.light, changes.light);
  await writeAggregate(tx, pair.dark, aggregates.dark, outcomes.dark, changes.dark);

  return changes;
}

async function writeAggregate(
  tx: DatabaseExecutor,
  userId: string,
  aggregate: RatingAggregate,
  outcome: RatingOutcome,
  change: RatingChange,
): Promise<void> {
  await upsertRating(tx, userId, applyResult(aggregate, outcome, change.after));
}

function aggregateOf(rows: readonly RatingRow[], userId: string): RatingAggregate {
  const row = rows.find((candidate) => candidate.userId === userId);
  if (!row) {
    return startingAggregate();
  }
  return {
    rating: row.rating,
    gamesPlayed: row.gamesPlayed,
    wins: row.wins,
    losses: row.losses,
    draws: row.draws,
    currentStreak: row.currentStreak,
    bestStreak: row.bestStreak,
  };
}

function changeRow(
  matchId: string,
  userId: string,
  side: Player,
  change: RatingChange,
): NewRatingChangeRow {
  return {
    matchId,
    userId,
    side,
    ratingBefore: change.before,
    ratingAfter: change.after,
    delta: change.delta,
    opponentRatingBefore: change.opponentBefore,
    outcome: change.outcome,
    formulaVersion: change.formulaVersion,
  };
}

async function storedChanges(
  tx: DatabaseExecutor,
  matchId: string,
): Promise<MatchRatingChanges | null> {
  const rows = await listRatingChangesForMatch(tx, matchId);
  if (rows.length === 0) {
    return null;
  }

  const light = rows.find((row) => row.side === "light");
  const dark = rows.find((row) => row.side === "dark");
  if (!light || !dark) {
    // The pair is written in one statement, so a half-written audit means the
    // ledger was edited outside the application and must not be extended.
    throw new Error(`the rating audit for match ${matchId} is missing a side`);
  }
  return { light: toChange(light), dark: toChange(dark) };
}

function toChange(row: RatingChangeRow): RatingChange {
  return {
    before: row.ratingBefore,
    after: row.ratingAfter,
    delta: row.delta,
    opponentBefore: row.opponentRatingBefore,
    outcome: row.outcome,
    formulaVersion: row.formulaVersion,
  };
}
