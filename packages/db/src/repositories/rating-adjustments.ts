import { desc, eq, sql } from "drizzle-orm";
import { ratingAdjustments, ratings } from "../schema";
import type { NewRatingAdjustmentRow, RatingAdjustmentRow, RatingRow } from "../schema";
import type { DatabaseExecutor } from "../executor";

/**
 * Corrective rating changes (section 16). A correction moves the aggregate and
 * records why beside the audit row that authorised it; it never touches
 * `rating_changes`, which is the per-match audit leaderboards aggregate
 * (appendix P7.4).
 */
export async function insertRatingAdjustment(
  executor: DatabaseExecutor,
  values: NewRatingAdjustmentRow,
): Promise<RatingAdjustmentRow> {
  const [row] = await executor.insert(ratingAdjustments).values(values).returning();
  if (!row) {
    throw new Error("insertRatingAdjustment returned no row");
  }
  return row;
}

/**
 * Sets the rating and moves `updated_at`, because the rating really did change and
 * that column is the final leaderboard tie-breaker (appendix P6.10). The games,
 * wins, losses and draws are left alone: a correction rewrites no history.
 */
export async function setRating(
  executor: DatabaseExecutor,
  userId: string,
  rating: number,
): Promise<RatingRow> {
  const [row] = await executor
    .update(ratings)
    .set({ rating, updatedAt: sql`now()` })
    .where(eq(ratings.userId, userId))
    .returning();
  if (!row) {
    throw new Error(`setRating found no rating for ${userId}`);
  }
  return row;
}

export async function listRatingAdjustmentsForUser(
  executor: DatabaseExecutor,
  userId: string,
  limit: number,
): Promise<RatingAdjustmentRow[]> {
  return executor
    .select()
    .from(ratingAdjustments)
    .where(eq(ratingAdjustments.userId, userId))
    .orderBy(desc(ratingAdjustments.id))
    .limit(limit);
}
