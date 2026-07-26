import type { AchievementCode, MatchEndReason, MatchMode } from "@gobblet/protocol";
import { WINNING_LINE_CATEGORIES } from "./lines";
import type { WinningLineCategory } from "./lines";

/**
 * Everything the eight rules of docs/product-spec.md section 11.4 need, gathered
 * inside the completion transaction. Keeping the rules a pure function of this
 * record is what makes them testable without a database and identical wherever
 * they run (docs/adr/0027-achievements-awarded-in-the-completion-transaction.md).
 */
export type AchievementFacts = Readonly<{
  mode: MatchMode;
  /** `null` only for a match that ended without a recorded reason. */
  endReason: MatchEndReason | null;
  /** Whether this account won the match that just completed. */
  wonMatch: boolean;
  /** Completed matches in both modes, including this one (appendix P6.7). */
  completedMatches: number;
  /** Wins in both modes, including this one. */
  totalWins: number;
  rankedWins: number;
  /** Positive while winning, so three consecutive ranked wins read as 3. */
  rankedStreak: number;
  /** Whether a move of this account in this match revealed a line and blocked it. */
  revealedAndBlocked: boolean;
  /** Categories the account has ever won with, this match included. */
  wonLineCategories: readonly WinningLineCategory[];
}>;

/**
 * The codes the account qualifies for. It answers everything it qualifies for
 * rather than only what is new, because the award is idempotent and the database
 * decides what was already held.
 */
export function earnedAchievements(facts: AchievementFacts): AchievementCode[] {
  const earned: AchievementCode[] = [];

  if (facts.totalWins >= 1) {
    earned.push("first-victory");
  }
  if (facts.completedMatches >= 10) {
    earned.push("getting-started");
  }
  if (facts.rankedWins >= 10) {
    earned.push("contender");
  }
  if (facts.rankedStreak >= 3) {
    earned.push("on-a-roll");
  }
  if (facts.completedMatches >= 100) {
    earned.push("century-club");
  }
  if (facts.mode === "ranked" && facts.wonMatch && facts.endReason === "timeout") {
    earned.push("time-keeper");
  }
  if (facts.wonMatch && facts.revealedAndBlocked) {
    earned.push("uncovered");
  }
  if (WINNING_LINE_CATEGORIES.every((category) => facts.wonLineCategories.includes(category))) {
    earned.push("four-ways");
  }

  return earned;
}
