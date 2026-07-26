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
  /** The lines that ended it, recorded once so an achievement need not replay it. */
  winningLineIds?: string[] | null;
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

/**
 * The match an actor is still playing, if any. Matchmaking refuses to queue a
 * player who already has one, so nobody can hold two clocks at once.
 */
export async function findUnfinishedMatchForActor(
  executor: DatabaseExecutor,
  actor: Readonly<{ actorType: "user" | "guest"; actorId: string }>,
): Promise<MatchRow | undefined> {
  const [row] = await executor
    .select()
    .from(matches)
    .where(and(inArray(matches.status, ["queued", "active"]), participatedIn(actor)))
    .orderBy(matches.createdAt)
    .limit(1);
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
    .where(participatedIn(actor))
    .orderBy(sql`${matches.createdAt} desc`)
    .limit(limit);
}

/** The finished matches a profile shows, newest first (appendix P6.12). */
export async function listCompletedMatchesForActor(
  executor: DatabaseExecutor,
  actor: Readonly<{ actorType: "user" | "guest"; actorId: string }>,
  limit: number,
): Promise<MatchRow[]> {
  return executor
    .select()
    .from(matches)
    .where(and(eq(matches.status, "completed"), participatedIn(actor)))
    .orderBy(sql`${matches.endedAt} desc`)
    .limit(limit);
}

export type CompletedMatchCounts = Readonly<{ played: number; wins: number }>;

/**
 * Completed matches in both modes, and how many of them the actor won. Section
 * 11.4 counts "matches" without qualifying the mode, and an aborted match counts
 * for nothing (appendix P6.7).
 */
export async function countCompletedMatchesForActor(
  executor: DatabaseExecutor,
  actor: Readonly<{ actorType: "user" | "guest"; actorId: string }>,
): Promise<CompletedMatchCounts> {
  const result = await executor.execute<{ played: number; wins: number }>(sql`
    select
      count(*)::int as played,
      count(*) filter (
        where matches.result::text = case
          when matches.light_player_type = ${actor.actorType}::actor_type
            and matches.light_player_id = ${actor.actorId}::uuid then 'light'
          else 'dark'
        end
      )::int as wins
    from matches
    where matches.status = 'completed'
      and (
        (matches.light_player_type = ${actor.actorType}::actor_type and matches.light_player_id = ${actor.actorId}::uuid)
        or (matches.dark_player_type = ${actor.actorType}::actor_type and matches.dark_player_id = ${actor.actorId}::uuid)
      )
  `);

  const [row] = result.rows;
  return { played: row?.played ?? 0, wins: row?.wins ?? 0 };
}

/**
 * The distinct lines the actor has ever won with, which is what "Four Ways" counts
 * (appendix P6.6). The ids come from the match rows, so no game state is replayed.
 */
export async function listWinningLineIdsForActorWins(
  executor: DatabaseExecutor,
  actor: Readonly<{ actorType: "user" | "guest"; actorId: string }>,
): Promise<string[]> {
  const result = await executor.execute<{ line_id: string }>(sql`
    select distinct unnest(matches.winning_line_ids) as line_id
    from matches
    where matches.status = 'completed'
      and matches.winning_line_ids is not null
      and (
        (matches.result = 'light' and matches.light_player_type = ${actor.actorType}::actor_type and matches.light_player_id = ${actor.actorId}::uuid)
        or (matches.result = 'dark' and matches.dark_player_type = ${actor.actorType}::actor_type and matches.dark_player_id = ${actor.actorId}::uuid)
      )
    order by line_id
  `);

  return result.rows.map((row) => row.line_id);
}

function participatedIn(actor: Readonly<{ actorType: "user" | "guest"; actorId: string }>) {
  return or(
    and(eq(matches.lightPlayerType, actor.actorType), eq(matches.lightPlayerId, actor.actorId)),
    and(eq(matches.darkPlayerType, actor.actorType), eq(matches.darkPlayerId, actor.actorId)),
  );
}
