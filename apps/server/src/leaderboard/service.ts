import { readLeaderboardPage } from "@gobblet/db";
import type { Database, LeaderboardCursorRow, LeaderboardRow } from "@gobblet/db";
import { LEADERBOARD_PAGE_SIZE, encodeLeaderboardCursor } from "@gobblet/protocol";
import type {
  LeaderboardCursor,
  LeaderboardEntry,
  LeaderboardPeriod,
  LeaderboardResponse,
} from "@gobblet/protocol";
import { leaderboardWindow } from "./periods";

export type LeaderboardServiceOptions = Readonly<{
  db: Database;
  now?: () => number;
}>;

export type LeaderboardRequest = Readonly<{
  period: LeaderboardPeriod;
  cursor?: LeaderboardCursor | null;
  limit?: number;
  viewerUserId?: string | null;
}>;

/**
 * Reads a board (docs/adr/0028-leaderboards-are-read-time-queries.md). Nothing is
 * cached and no rank is stored: one statement answers the page, the viewer's own
 * row and the ranks of both.
 */
export class LeaderboardService {
  private readonly db: Database;

  private readonly now: () => number;

  constructor(options: LeaderboardServiceOptions) {
    this.db = options.db;
    this.now = options.now ?? ((): number => Date.now());
  }

  async read(request: LeaderboardRequest): Promise<LeaderboardResponse> {
    const generatedAt = this.now();
    const window = leaderboardWindow(request.period, generatedAt);
    const limit = request.limit ?? LEADERBOARD_PAGE_SIZE;

    const page = await readLeaderboardPage(this.db, {
      window,
      limit,
      cursor: request.cursor ? rowCursor(request.cursor) : null,
      viewerUserId: request.viewerUserId ?? null,
    });

    const entries = page.entries.map(toEntry);
    const last = page.entries.at(-1);
    return {
      period: request.period,
      periodStart: window ? window.start.toISOString() : null,
      periodEnd: window ? window.end.toISOString() : null,
      generatedAt: new Date(generatedAt).toISOString(),
      entries,
      // A full page may have more behind it; a short one is the end of the board.
      nextCursor: last && entries.length === limit ? encodeLeaderboardCursor(cursorOf(last)) : null,
      you: page.viewer ? toEntry(page.viewer) : null,
    };
  }
}

function toEntry(row: LeaderboardRow): LeaderboardEntry {
  return {
    rank: row.rank,
    username: row.username,
    avatarUrl: row.avatarUrl,
    countryCode: row.countryCode,
    rating: row.rating,
    wins: row.wins,
    games: row.games,
    ratedAt: row.ratedAt.toISOString(),
  };
}

/** The wire cursor carries epoch millis; the query compares a timestamp. */
function rowCursor(cursor: LeaderboardCursor): LeaderboardCursorRow {
  return { ...cursor, ratedAt: new Date(cursor.ratedAt) };
}

function cursorOf(row: LeaderboardRow): LeaderboardCursor {
  return {
    rating: row.rating,
    wins: row.wins,
    games: row.games,
    ratedAt: row.ratedAt.getTime(),
    userId: row.userId,
  };
}
