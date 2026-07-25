import { and, eq, inArray, or, sql } from "drizzle-orm";
import { matches } from "../schema";
import type { MatchRow, NewMatchRow } from "../schema";
import type { DatabaseExecutor } from "../executor";

export type MatchStatePatch = Readonly<{
  gameState: unknown;
  stateVersion: number;
  activePlayer: "light" | "dark";
  lightRemainingMs: number;
  darkRemainingMs: number;
  turnStartedAt: Date | null;
  lastClockCommitAt: Date;
  moveCount: number;
  status?: MatchRow["status"];
  result?: MatchRow["result"];
  endReason?: MatchRow["endReason"];
  startedAt?: Date;
  endedAt?: Date | null;
}>;

export async function insertMatch(
  executor: DatabaseExecutor,
  values: NewMatchRow,
): Promise<MatchRow> {
  const [row] = await executor.insert(matches).values(values).returning();
  if (!row) {
    throw new Error("insertMatch returned no row");
  }
  return row;
}

export async function findMatchById(
  executor: DatabaseExecutor,
  matchId: string,
): Promise<MatchRow | undefined> {
  const [row] = await executor.select().from(matches).where(eq(matches.id, matchId)).limit(1);
  return row;
}

/**
 * Serialises concurrent commands for one match. Every accepted command runs
 * inside a transaction that starts here (docs/adr/0011).
 */
export async function lockMatchForUpdate(
  executor: DatabaseExecutor,
  matchId: string,
): Promise<MatchRow | undefined> {
  const [row] = await executor
    .select()
    .from(matches)
    .where(eq(matches.id, matchId))
    .limit(1)
    .for("update");
  return row;
}

export async function updateMatchState(
  executor: DatabaseExecutor,
  matchId: string,
  patch: MatchStatePatch,
): Promise<MatchRow> {
  const [row] = await executor
    .update(matches)
    .set(patch)
    .where(eq(matches.id, matchId))
    .returning();
  if (!row) {
    throw new Error(`updateMatchState found no match ${matchId}`);
  }
  return row;
}

export async function listUnfinishedMatches(executor: DatabaseExecutor): Promise<MatchRow[]> {
  return executor
    .select()
    .from(matches)
    .where(inArray(matches.status, ["queued", "active"]))
    .orderBy(matches.createdAt);
}

/**
 * Moves a guest's match participation to the account that claimed it. The display
 * names are left as they were played, so an opponent's history keeps the label
 * they actually saw at the table.
 */
export async function reassignMatchParticipation(
  executor: DatabaseExecutor,
  from: Readonly<{ actorType: "user" | "guest"; actorId: string }>,
  to: Readonly<{ actorType: "user" | "guest"; actorId: string }>,
): Promise<number> {
  const light = await executor
    .update(matches)
    .set({ lightPlayerType: to.actorType, lightPlayerId: to.actorId })
    .where(
      and(eq(matches.lightPlayerType, from.actorType), eq(matches.lightPlayerId, from.actorId)),
    )
    .returning({ id: matches.id });

  const dark = await executor
    .update(matches)
    .set({ darkPlayerType: to.actorType, darkPlayerId: to.actorId })
    .where(and(eq(matches.darkPlayerType, from.actorType), eq(matches.darkPlayerId, from.actorId)))
    .returning({ id: matches.id });

  return new Set([...light, ...dark].map((row) => row.id)).size;
}

export async function listMatchesForActor(
  executor: DatabaseExecutor,
  actor: Readonly<{ actorType: "user" | "guest"; actorId: string }>,
  limit = 20,
): Promise<MatchRow[]> {
  return executor
    .select()
    .from(matches)
    .where(
      or(
        and(eq(matches.lightPlayerType, actor.actorType), eq(matches.lightPlayerId, actor.actorId)),
        and(eq(matches.darkPlayerType, actor.actorType), eq(matches.darkPlayerId, actor.actorId)),
      ),
    )
    .orderBy(sql`${matches.createdAt} desc`)
    .limit(limit);
}
