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
