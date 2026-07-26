import type { LeaderboardWindow } from "@gobblet/db";
import type { LeaderboardPeriod } from "@gobblet/protocol";

/**
 * The calendar bounds of a board, in UTC. A global board is paginated by a key that
 * includes its period, so its shape must not depend on the reader's time zone
 * (appendix P6.9). `null` is the all-time board, which has no bounds.
 */
export function leaderboardWindow(
  period: LeaderboardPeriod,
  now: number,
): LeaderboardWindow | null {
  const at = new Date(now);
  const year = at.getUTCFullYear();
  const month = at.getUTCMonth();
  const day = at.getUTCDate();

  switch (period) {
    case "daily":
      return window(Date.UTC(year, month, day), Date.UTC(year, month, day + 1));
    case "weekly": {
      // ISO weeks begin on Monday, so Sunday belongs to the week that started six
      // days earlier rather than to the one about to begin.
      const monday = day - ((at.getUTCDay() + 6) % 7);
      return window(Date.UTC(year, month, monday), Date.UTC(year, month, monday + 7));
    }
    case "monthly":
      return window(Date.UTC(year, month, 1), Date.UTC(year, month + 1, 1));
    case "all-time":
      return null;
  }
}

function window(start: number, end: number): LeaderboardWindow {
  return { start: new Date(start), end: new Date(end) };
}
