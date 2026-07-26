import {
  awardAchievements,
  countCompletedMatchesForActor,
  findRating,
  hasRevealedAndBlockedMove,
  listWinningLineIdsForActorWins,
} from "@gobblet/db";
import type { DatabaseExecutor, MatchRow } from "@gobblet/db";
import type { Player } from "@gobblet/game-core";
import { isAchievementCode } from "@gobblet/protocol";
import type { AchievementCode } from "@gobblet/protocol";
import { lineCategories } from "./lines";
import { earnedAchievements } from "./rules";
import type { AchievementFacts } from "./rules";

/** What each seat earned by this completion, for logging and for tests. */
export type CompletionAwards = Readonly<Record<Player, readonly AchievementCode[]>>;

const NOTHING: readonly AchievementCode[] = Object.freeze([]);

/**
 * Awards achievements for a completed match, inside the transaction that completed
 * it. Only accounts earn: a guest has no row to write
 * (docs/adr/0027-achievements-awarded-in-the-completion-transaction.md).
 */
export async function awardAchievementsForCompletion(
  tx: DatabaseExecutor,
  row: MatchRow,
): Promise<CompletionAwards> {
  if (row.status !== "completed" || row.result === null) {
    return { light: NOTHING, dark: NOTHING };
  }
  return {
    light: await awardForSeat(tx, row, "light"),
    dark: await awardForSeat(tx, row, "dark"),
  };
}

async function awardForSeat(
  tx: DatabaseExecutor,
  row: MatchRow,
  side: Player,
): Promise<readonly AchievementCode[]> {
  const actorType = side === "light" ? row.lightPlayerType : row.darkPlayerType;
  if (actorType !== "user") {
    return NOTHING;
  }
  const userId = side === "light" ? row.lightPlayerId : row.darkPlayerId;
  const facts = await gatherFacts(tx, row, side, userId);
  const written = await awardAchievements(tx, userId, earnedAchievements(facts), row.id);
  return written.filter(isAchievementCode);
}

/**
 * The two queries every seat needs, plus the two only a winner can be changed by:
 * a loss cannot add a line category or a blocked reveal, so nothing asks for them.
 */
async function gatherFacts(
  tx: DatabaseExecutor,
  row: MatchRow,
  side: Player,
  userId: string,
): Promise<AchievementFacts> {
  const actor = { actorType: "user" as const, actorId: userId };
  const wonMatch = row.result === side;
  const counts = await countCompletedMatchesForActor(tx, actor);
  const rating = await findRating(tx, userId);

  return {
    mode: row.mode,
    endReason: row.endReason,
    wonMatch,
    completedMatches: counts.played,
    totalWins: counts.wins,
    rankedWins: rating?.wins ?? 0,
    rankedStreak: rating?.currentStreak ?? 0,
    revealedAndBlocked: wonMatch ? await hasRevealedAndBlockedMove(tx, row.id, userId) : false,
    wonLineCategories: wonMatch
      ? lineCategories(await listWinningLineIdsForActorWins(tx, actor))
      : [],
  };
}
