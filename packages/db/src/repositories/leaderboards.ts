import { sql } from "drizzle-orm";
import type { DatabaseExecutor } from "../executor";

/**
 * The leaderboards of section 11.3. A board is one statement, so it is read in one
 * MVCC snapshot and cannot show a state that never existed while other matches are
 * completing (docs/adr/0028-leaderboards-are-read-time-queries.md).
 */
export type LeaderboardWindow = Readonly<{ start: Date; end: Date }>;

export type LeaderboardCursorRow = Readonly<{
  rating: number;
  wins: number;
  games: number;
  ratedAt: Date;
  userId: string;
}>;

export type LeaderboardQueryOptions = Readonly<{
  /** `null` reads the all-time board, where the counts are the account's lifetime ones. */
  window: LeaderboardWindow | null;
  limit: number;
  cursor?: LeaderboardCursorRow | null;
  viewerUserId?: string | null;
}>;

export type LeaderboardRow = Readonly<{
  rank: number;
  userId: string;
  username: string;
  avatarUrl: string | null;
  countryCode: string | null;
  rating: number;
  wins: number;
  games: number;
  ratedAt: Date;
}>;

export type LeaderboardPage = Readonly<{
  entries: readonly LeaderboardRow[];
  /** The viewer's row, wherever it falls in the board, or `null` when unranked. */
  viewer: LeaderboardRow | null;
}>;

type RawLeaderboardRow = Readonly<{
  kind: "page" | "viewer";
  rank: number;
  user_id: string;
  username: string;
  avatar_url: string | null;
  country_code: string | null;
  rating: number;
  wins: number;
  games: number;
  /** A raw statement bypasses the column mappers, so a timestamp arrives as text. */
  rated_at: string;
}>;

function toRow(raw: RawLeaderboardRow): LeaderboardRow {
  return {
    rank: raw.rank,
    userId: raw.user_id,
    username: raw.username,
    avatarUrl: raw.avatar_url,
    countryCode: raw.country_code,
    rating: raw.rating,
    wins: raw.wins,
    games: raw.games,
    ratedAt: new Date(raw.rated_at),
  };
}

export async function readLeaderboardPage(
  executor: DatabaseExecutor,
  options: LeaderboardQueryOptions,
): Promise<LeaderboardPage> {
  const { window, limit, cursor = null, viewerUserId = null } = options;

  /**
   * A period counts what the rating audit recorded inside it, which is also how
   * membership is decided; the all-time board uses the aggregate the account
   * already carries.
   */
  const stats = window
    ? sql`
        select
          rating_changes.user_id,
          count(*) filter (where rating_changes.outcome = 'win')::int as wins,
          count(*)::int as games
        from rating_changes
        where rating_changes.created_at >= ${window.start}
          and rating_changes.created_at < ${window.end}
        group by rating_changes.user_id
      `
    : sql`select ratings.user_id, ratings.wins::int as wins, ratings.games_played::int as games from ratings`;

  /**
   * The sort key is negated for the keyset comparison so that every component
   * ascends, which is the only way a row-value comparison can express
   * "rating descending, then wins descending, then games ascending".
   */
  const afterCursor = cursor
    ? sql`
        where (-board.rating, -board.wins, board.games, board.rated_at, board.user_id) >
          (${-cursor.rating}, ${-cursor.wins}, ${cursor.games}, ${cursor.ratedAt}::timestamptz, ${cursor.userId}::uuid)
      `
    : sql``;

  const viewerFilter = viewerUserId
    ? sql`where board.user_id = ${viewerUserId}::uuid`
    : sql`where false`;

  const result = await executor.execute<RawLeaderboardRow>(sql`
    with stats as (${stats}),
    board as (
      select
        ratings.user_id,
        users.username,
        profiles.avatar_url,
        profiles.country_code,
        ratings.rating,
        stats.wins,
        stats.games,
        -- Truncated to the resolution a cursor can carry, so a page boundary
        -- cannot land inside one timestamp and repeat the row that made it.
        date_trunc('milliseconds', ratings.updated_at) as rated_at,
        rank() over (
          order by
            ratings.rating desc,
            stats.wins desc,
            stats.games asc,
            date_trunc('milliseconds', ratings.updated_at) asc,
            ratings.user_id asc
        )::int as rank
      from ratings
      join stats on stats.user_id = ratings.user_id
      join users on users.id = ratings.user_id and users.status = 'active'
      left join profiles on profiles.user_id = ratings.user_id
    ),
    page as (
      select board.* from board
      ${afterCursor}
      order by board.rank
      limit ${limit}
    ),
    viewer as (
      select board.* from board
      ${viewerFilter}
    )
    select 'page' as kind, page.* from page
    union all
    select 'viewer' as kind, viewer.* from viewer
    order by kind desc, rank
  `);

  const rows = result.rows;
  return {
    entries: rows.filter((row) => row.kind === "page").map(toRow),
    viewer: rows.filter((row) => row.kind === "viewer").map(toRow)[0] ?? null,
  };
}
