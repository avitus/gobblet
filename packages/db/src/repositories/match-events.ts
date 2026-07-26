import { and, eq, sql } from "drizzle-orm";
import { matchEvents } from "../schema";
import type { MatchEventRow, NewMatchEventRow } from "../schema";
import type { DatabaseExecutor } from "../executor";

export async function insertMatchEvent(
  executor: DatabaseExecutor,
  values: NewMatchEventRow,
): Promise<MatchEventRow> {
  const [row] = await executor.insert(matchEvents).values(values).returning();
  if (!row) {
    throw new Error("insertMatchEvent returned no row");
  }
  return row;
}

export async function findEventByCommandId(
  executor: DatabaseExecutor,
  matchId: string,
  commandId: string,
): Promise<MatchEventRow | undefined> {
  const [row] = await executor
    .select()
    .from(matchEvents)
    .where(and(eq(matchEvents.matchId, matchId), eq(matchEvents.commandId, commandId)))
    .limit(1);
  return row;
}

/** Backs the `lastMove` field of a snapshot, which the game state does not carry. */
export async function findLatestMoveEvent(
  executor: DatabaseExecutor,
  matchId: string,
): Promise<MatchEventRow | undefined> {
  const [row] = await executor
    .select()
    .from(matchEvents)
    .where(and(eq(matchEvents.matchId, matchId), eq(matchEvents.type, "move")))
    .orderBy(sql`${matchEvents.sequence} desc`)
    .limit(1);
  return row;
}

export async function listMatchEvents(
  executor: DatabaseExecutor,
  matchId: string,
): Promise<MatchEventRow[]> {
  return executor
    .select()
    .from(matchEvents)
    .where(eq(matchEvents.matchId, matchId))
    .orderBy(matchEvents.sequence);
}

/**
 * Whether the actor played a move in this match that revealed an opponent line and
 * blocked it at once, which is the fact the "Uncovered" achievement needs
 * (appendix P6.5). The flag was written when the engine computed it, so nothing is
 * recomputed here.
 */
export async function hasRevealedAndBlockedMove(
  executor: DatabaseExecutor,
  matchId: string,
  actorId: string,
): Promise<boolean> {
  const [row] = await executor
    .select({ matchId: matchEvents.matchId })
    .from(matchEvents)
    .where(
      and(
        eq(matchEvents.matchId, matchId),
        eq(matchEvents.actorId, actorId),
        eq(matchEvents.revealedAndBlocked, true),
      ),
    )
    .limit(1);
  return row !== undefined;
}

export async function countMatchEvents(
  executor: DatabaseExecutor,
  matchId: string,
): Promise<number> {
  const [row] = await executor
    .select({ count: sql<number>`count(*)::int` })
    .from(matchEvents)
    .where(eq(matchEvents.matchId, matchId));
  return row?.count ?? 0;
}
