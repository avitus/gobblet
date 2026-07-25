import { eq, inArray, sql } from "drizzle-orm";
import { ratingChanges, ratings } from "../schema";
import type { NewRatingChangeRow, RatingChangeRow, RatingRow } from "../schema";
import type { DatabaseExecutor } from "../executor";

export type RatingAggregatePatch = Readonly<{
  rating: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  currentStreak: number;
  bestStreak: number;
}>;

export async function findRating(
  executor: DatabaseExecutor,
  userId: string,
): Promise<RatingRow | undefined> {
  const [row] = await executor.select().from(ratings).where(eq(ratings.userId, userId)).limit(1);
  return row;
}

/**
 * Reads both players' ratings inside the completion transaction and locks them,
 * so two matches finishing at once cannot both write from the same starting value
 * (docs/adr/0019-elo-in-the-completion-transaction.md).
 */
export async function lockRatingsForUpdate(
  executor: DatabaseExecutor,
  userIds: readonly string[],
): Promise<RatingRow[]> {
  if (userIds.length === 0) {
    return [];
  }
  return executor
    .select()
    .from(ratings)
    .where(inArray(ratings.userId, [...userIds]))
    .orderBy(ratings.userId)
    .for("update");
}

/**
 * Writes the aggregate, creating it on the account's first ranked result. The
 * update is unconditional rather than incremental: the caller has just computed
 * every field from the locked row, so a read-modify-write cannot interleave.
 */
export async function upsertRating(
  executor: DatabaseExecutor,
  userId: string,
  patch: RatingAggregatePatch,
): Promise<RatingRow> {
  const [row] = await executor
    .insert(ratings)
    .values({ userId, ...patch })
    .onConflictDoUpdate({
      target: ratings.userId,
      set: { ...patch, updatedAt: sql`now()` },
    })
    .returning();
  if (!row) {
    throw new Error(`upsertRating wrote no row for ${userId}`);
  }
  return row;
}

/**
 * Appends the audit rows for a completed ranked match. A repeated completion is
 * ignored rather than duplicated, because `(match_id, user_id)` is unique and a
 * rating may only move once per match.
 */
export async function insertRatingChanges(
  executor: DatabaseExecutor,
  rows: readonly NewRatingChangeRow[],
): Promise<RatingChangeRow[]> {
  if (rows.length === 0) {
    return [];
  }
  return executor
    .insert(ratingChanges)
    .values([...rows])
    .onConflictDoNothing({ target: [ratingChanges.matchId, ratingChanges.userId] })
    .returning();
}

export async function listRatingChangesForMatch(
  executor: DatabaseExecutor,
  matchId: string,
): Promise<RatingChangeRow[]> {
  return executor
    .select()
    .from(ratingChanges)
    .where(eq(ratingChanges.matchId, matchId))
    .orderBy(ratingChanges.side);
}

export async function listRatingChangesForUser(
  executor: DatabaseExecutor,
  userId: string,
  limit = 20,
): Promise<RatingChangeRow[]> {
  return executor
    .select()
    .from(ratingChanges)
    .where(eq(ratingChanges.userId, userId))
    .orderBy(sql`${ratingChanges.createdAt} desc`)
    .limit(limit);
}
