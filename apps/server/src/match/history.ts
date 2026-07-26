import {
  findRatingDeltasForMatches,
  listCompletedMatchesForActor,
  listMatchesForActor,
} from "@gobblet/db";
import type { DatabaseExecutor, MatchRow } from "@gobblet/db";
import type { Player } from "@gobblet/game-core";
import type { PlayerMatchSummary } from "@gobblet/protocol";
import { toPlayerSummary } from "./snapshot";
import type { Actor } from "./snapshot";

/**
 * Match history read from one seat (spec section 11.2). One place builds it, so the
 * own-history endpoint and a public profile cannot disagree about what a summary
 * says, and neither can reach the move event log.
 */
export async function listPlayerHistory(
  executor: DatabaseExecutor,
  actor: Actor,
  limit: number,
): Promise<PlayerMatchSummary[]> {
  return playerSummaries(executor, await listMatchesForActor(executor, actor, limit), actor);
}

export async function listCompletedPlayerHistory(
  executor: DatabaseExecutor,
  actor: Actor,
  limit: number,
): Promise<PlayerMatchSummary[]> {
  return playerSummaries(
    executor,
    await listCompletedMatchesForActor(executor, actor, limit),
    actor,
  );
}

/** A guest has no rating audit, so its summaries carry no rating change at all. */
async function playerSummaries(
  executor: DatabaseExecutor,
  rows: readonly MatchRow[],
  actor: Actor,
): Promise<PlayerMatchSummary[]> {
  const deltas =
    actor.actorType === "user"
      ? await findRatingDeltasForMatches(
          executor,
          actor.actorId,
          rows.map((row) => row.id),
        )
      : new Map<string, number>();

  return rows.map((row) => toPlayerSummary(row, seatOf(row, actor), deltas.get(row.id) ?? null));
}

/** The query already restricted the rows to this actor, so one of the seats is theirs. */
function seatOf(row: MatchRow, actor: Actor): Player {
  return row.lightPlayerType === actor.actorType && row.lightPlayerId === actor.actorId
    ? "light"
    : "dark";
}
