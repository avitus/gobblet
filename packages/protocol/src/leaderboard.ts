import { z } from "zod";
import { LEADERBOARD_PAGE_SIZE, LEADERBOARD_PERIODS } from "./constants";
import { epochMillisSchema, isoTimestampSchema, uuidSchema } from "./primitives";
import { ratingValueSchema } from "./rating";

/**
 * Leaderboard payloads (docs/product-spec.md section 11.3). A board is computed at
 * read time, so a rank is a field of a response and never of a stored row
 * (docs/adr/0028-leaderboards-are-read-time-queries.md).
 */
export const leaderboardPeriodSchema = z.enum(LEADERBOARD_PERIODS);

export const leaderboardEntrySchema = z.strictObject({
  rank: z.int().positive(),
  username: z.string().min(1),
  avatarUrl: z.string().min(1).nullable(),
  countryCode: z.string().length(2).nullable(),
  rating: ratingValueSchema,
  /** Ranked results inside the period, and over the account's life on the all-time board. */
  wins: z.int().nonnegative(),
  games: z.int().nonnegative(),
  /** When the rating last changed, which is the final tie-breaker (appendix P6.10). */
  ratedAt: isoTimestampSchema,
});

/**
 * The composite sort key of the last entry on a page. Paging by the key rather than
 * by an offset means a rating that moves between requests cannot make a page skip
 * or repeat an account.
 */
export const leaderboardCursorSchema = z.strictObject({
  rating: ratingValueSchema,
  wins: z.int().nonnegative(),
  games: z.int().nonnegative(),
  ratedAt: epochMillisSchema,
  userId: uuidSchema,
});

export type LeaderboardCursor = z.infer<typeof leaderboardCursorSchema>;

const CURSOR_SEPARATOR = ".";

/** Opaque to a client, which only ever echoes it back. */
export function encodeLeaderboardCursor(cursor: LeaderboardCursor): string {
  return [cursor.rating, cursor.wins, cursor.games, cursor.ratedAt, cursor.userId].join(
    CURSOR_SEPARATOR,
  );
}

/** A malformed or tampered cursor is `null`, which callers answer as a bad request. */
export function decodeLeaderboardCursor(raw: string): LeaderboardCursor | null {
  const parts = raw.split(CURSOR_SEPARATOR);
  if (parts.length !== 5) return null;
  const [rating, wins, games, ratedAt, userId] = parts;
  const parsed = leaderboardCursorSchema.safeParse({
    rating: Number(rating),
    wins: Number(wins),
    games: Number(games),
    ratedAt: Number(ratedAt),
    userId,
  });
  return parsed.success ? parsed.data : null;
}

export const leaderboardQuerySchema = z.strictObject({
  period: leaderboardPeriodSchema,
  cursor: z.string().min(1).optional(),
  limit: z.int().positive().max(LEADERBOARD_PAGE_SIZE).optional(),
});

export const leaderboardResponseSchema = z.strictObject({
  period: leaderboardPeriodSchema,
  /** The UTC bounds of the period (appendix P6.9); both `null` for the all-time board. */
  periodStart: isoTimestampSchema.nullable(),
  periodEnd: isoTimestampSchema.nullable(),
  /** The instant of the single snapshot the board was read in. */
  generatedAt: isoTimestampSchema,
  entries: z.array(leaderboardEntrySchema),
  nextCursor: z.string().min(1).nullable(),
  /**
   * The caller's own row, shown even when it falls outside the page. `null` when the
   * caller is not a rated account, so nothing is invented for a guest.
   */
  you: leaderboardEntrySchema.nullable(),
});

export type LeaderboardEntry = z.infer<typeof leaderboardEntrySchema>;
export type LeaderboardQuery = z.infer<typeof leaderboardQuerySchema>;
export type LeaderboardResponse = z.infer<typeof leaderboardResponseSchema>;
