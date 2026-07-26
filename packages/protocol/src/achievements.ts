import { z } from "zod";
import {
  ACHIEVEMENT_BADGE_TIERS,
  ACHIEVEMENT_CODES,
  ACHIEVEMENT_RULE_VERSION,
  type AchievementCode,
} from "./constants";
import { isoTimestampSchema, uuidSchema } from "./primitives";

/**
 * The achievement catalogue of docs/product-spec.md section 11.4. It lives in the
 * protocol because the server evaluates the codes and every client names the
 * badges, and the migration that seeds the `achievements` table reads it from here
 * (docs/adr/0027-achievements-awarded-in-the-completion-transaction.md).
 */
export const achievementSchema = z.strictObject({
  code: z.enum(ACHIEVEMENT_CODES),
  name: z.string().min(1),
  description: z.string().min(1),
  /** A tier the client renders from design tokens, not an image (appendix P6.8). */
  badge: z.enum(ACHIEVEMENT_BADGE_TIERS),
  ruleVersion: z.int().positive(),
});

export type Achievement = z.infer<typeof achievementSchema>;

export const ACHIEVEMENT_CATALOGUE: readonly Achievement[] = Object.freeze([
  {
    code: "first-victory",
    name: "First Victory",
    description: "Win your first match.",
    badge: "bronze",
    ruleVersion: ACHIEVEMENT_RULE_VERSION,
  },
  {
    code: "getting-started",
    name: "Getting Started",
    description: "Complete ten matches.",
    badge: "bronze",
    ruleVersion: ACHIEVEMENT_RULE_VERSION,
  },
  {
    code: "contender",
    name: "Contender",
    description: "Win ten ranked matches.",
    badge: "silver",
    ruleVersion: ACHIEVEMENT_RULE_VERSION,
  },
  {
    code: "on-a-roll",
    name: "On a Roll",
    description: "Win three ranked matches in a row.",
    badge: "silver",
    ruleVersion: ACHIEVEMENT_RULE_VERSION,
  },
  {
    code: "century-club",
    name: "Century Club",
    description: "Complete one hundred matches.",
    badge: "gold",
    ruleVersion: ACHIEVEMENT_RULE_VERSION,
  },
  {
    code: "time-keeper",
    name: "Time Keeper",
    description: "Win a ranked match on the opponent's clock.",
    badge: "silver",
    ruleVersion: ACHIEVEMENT_RULE_VERSION,
  },
  {
    code: "uncovered",
    name: "Uncovered",
    description: "Win a match in which you revealed an opponent line and blocked it in one move.",
    badge: "gold",
    ruleVersion: ACHIEVEMENT_RULE_VERSION,
  },
  {
    code: "four-ways",
    name: "Four Ways",
    description: "Win with a row, a column and both diagonals.",
    badge: "gold",
    ruleVersion: ACHIEVEMENT_RULE_VERSION,
  },
] as const satisfies readonly Achievement[]);

const BY_CODE: Readonly<Record<AchievementCode, Achievement>> = Object.freeze(
  Object.fromEntries(ACHIEVEMENT_CATALOGUE.map((entry) => [entry.code, entry])) as Record<
    AchievementCode,
    Achievement
  >,
);

/** The catalogue entry for a code. Every code has one, which a test enforces. */
export function achievementByCode(code: AchievementCode): Achievement {
  return BY_CODE[code];
}

/**
 * One catalogue entry with the caller's progress. `earnedAt` is `null` for an
 * achievement not yet earned, so the response describes the whole catalogue rather
 * than only the wins.
 */
export const achievementProgressSchema = achievementSchema.extend({
  earnedAt: isoTimestampSchema.nullable(),
  /** The match that earned it, when the award recorded one. */
  matchId: uuidSchema.nullable(),
});

export const achievementsResponseSchema = z.strictObject({
  achievements: z.array(achievementProgressSchema),
});

/** What a public profile shows: earned achievements only (spec section 11.1). */
export const profileBadgeSchema = z.strictObject({
  code: z.enum(ACHIEVEMENT_CODES),
  name: z.string().min(1),
  badge: z.enum(ACHIEVEMENT_BADGE_TIERS),
  earnedAt: isoTimestampSchema,
});

export type AchievementProgress = z.infer<typeof achievementProgressSchema>;
export type AchievementsResponse = z.infer<typeof achievementsResponseSchema>;
export type ProfileBadge = z.infer<typeof profileBadgeSchema>;
