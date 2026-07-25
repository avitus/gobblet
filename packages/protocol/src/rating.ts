import { z } from "zod";
import { MINIMUM_RATING, RATING_OUTCOMES } from "./constants";
import { playerSchema } from "./game-state";

/**
 * Rating payloads (docs/product-spec.md sections 2.6 and 10). A rating is an
 * integer at or above the floor, because the display must never show a negative
 * number (appendix P4).
 */
export const ratingValueSchema = z.int().min(MINIMUM_RATING);

/** The aggregate of section 15.4, as shown on a profile. */
export const rankedRecordSchema = z.strictObject({
  rating: ratingValueSchema,
  wins: z.int().nonnegative(),
  losses: z.int().nonnegative(),
  draws: z.int().nonnegative(),
  played: z.int().nonnegative(),
  currentStreak: z.int(),
  bestStreak: z.int().nonnegative(),
});

/** One player's rating movement for one match, the audit record of section 10. */
export const ratingChangeSchema = z.strictObject({
  before: ratingValueSchema,
  after: ratingValueSchema,
  delta: z.int(),
  opponentBefore: ratingValueSchema,
  outcome: z.enum(RATING_OUTCOMES),
  formulaVersion: z.int().positive(),
});

/** Both sides of a completed ranked match, keyed by colour. */
export const matchRatingChangesSchema = z.record(playerSchema, ratingChangeSchema);

export type RankedRecord = z.infer<typeof rankedRecordSchema>;
export type RatingChange = z.infer<typeof ratingChangeSchema>;
export type MatchRatingChanges = z.infer<typeof matchRatingChangesSchema>;
