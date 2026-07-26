import { asc, eq } from "drizzle-orm";
import { matchConnectionEvents } from "../schema";
import type { MatchConnectionEventRow, NewMatchConnectionEventRow } from "../schema";
import type { DatabaseExecutor } from "../executor";

/**
 * The reconnection history of section 16. It is separate from `match_events` because
 * an event consumes the sequence number that is the match version, and a socket
 * attaching changes no game state (appendix P7.5).
 */
export async function insertMatchConnectionEvent(
  executor: DatabaseExecutor,
  values: NewMatchConnectionEventRow,
): Promise<MatchConnectionEventRow> {
  const [row] = await executor.insert(matchConnectionEvents).values(values).returning();
  if (!row) {
    throw new Error("insertMatchConnectionEvent returned no row");
  }
  return row;
}

/** Oldest first, so the history reads in the order it happened. */
export async function listMatchConnectionEvents(
  executor: DatabaseExecutor,
  matchId: string,
): Promise<MatchConnectionEventRow[]> {
  return executor
    .select()
    .from(matchConnectionEvents)
    .where(eq(matchConnectionEvents.matchId, matchId))
    .orderBy(asc(matchConnectionEvents.id));
}
