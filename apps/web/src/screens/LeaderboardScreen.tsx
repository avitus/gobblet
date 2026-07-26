import { Badge, Banner, Button, Card, Spinner, cx } from "@gobblet/design-system";
import { LEADERBOARD_PERIODS } from "@gobblet/protocol";
import type { LeaderboardEntry, LeaderboardPeriod } from "@gobblet/protocol";
import { useState } from "react";
import { Link } from "react-router";
import { describeApiError } from "../api/errors";
import { useLeaderboard } from "../api/queries";
import styles from "./LeaderboardScreen.module.css";

const PERIOD_LABELS: Readonly<Record<LeaderboardPeriod, string>> = Object.freeze({
  "all-time": "All time",
  daily: "Today",
  weekly: "This week",
  monthly: "This month",
});

function describePeriod(start: string | null, end: string | null): string {
  return start === null || end === null
    ? "Every rated account."
    : `${start.slice(0, 10)} to ${end.slice(0, 10)}, in UTC.`;
}

/**
 * The ranked boards of section 11.3. A rank is a fact of the response, computed at
 * read time and never stored (docs/adr/0028-leaderboards-are-read-time-queries.md),
 * and the reader's own row is shown even when it falls outside the page.
 */
export function LeaderboardScreen(): React.JSX.Element {
  const [period, setPeriod] = useState<LeaderboardPeriod>("all-time");
  const board = useLeaderboard(period);
  const pages = board.data?.pages ?? [];
  const entries = pages.flatMap((page) => page.entries);
  const you = pages[0]?.you ?? null;
  const onPage = you !== null && entries.some((entry) => entry.username === you.username);

  return (
    <Card
      title="Leaderboard"
      description={
        pages[0] === undefined
          ? "Ranked results only."
          : describePeriod(pages[0].periodStart, pages[0].periodEnd)
      }
      actions={
        <div className={styles.periods} role="tablist" aria-label="Leaderboard period">
          {LEADERBOARD_PERIODS.map((option) => (
            <Button
              key={option}
              size="sm"
              variant={option === period ? "primary" : "ghost"}
              role="tab"
              aria-selected={option === period}
              data-testid={`period-${option}`}
              onClick={() => {
                setPeriod(option);
              }}
            >
              {PERIOD_LABELS[option]}
            </Button>
          ))}
        </div>
      }
    >
      {board.isPending ? (
        <Spinner label="Loading the leaderboard" />
      ) : board.isError ? (
        <Banner tone="error">{describeApiError(board.error)}</Banner>
      ) : (
        <>
          {you !== null && !onPage && (
            <table className={styles.table} data-testid="your-rank">
              <tbody>
                <Row entry={you} you />
              </tbody>
            </table>
          )}
          {entries.length === 0 ? (
            <p data-testid="leaderboard-empty">
              Nobody has finished a ranked match in this period yet.
            </p>
          ) : (
            <table className={styles.table} data-testid="leaderboard-table">
              <thead>
                <tr>
                  <th scope="col">Rank</th>
                  <th scope="col">Player</th>
                  <th scope="col">Rating</th>
                  <th scope="col">Won</th>
                  <th scope="col">Played</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <Row
                    key={entry.username}
                    entry={entry}
                    you={you !== null && entry.username === you.username}
                  />
                ))}
              </tbody>
            </table>
          )}
          {board.hasNextPage && (
            <Button
              variant="secondary"
              size="sm"
              busy={board.isFetchingNextPage}
              data-testid="load-more"
              onClick={() => {
                void board.fetchNextPage();
              }}
            >
              Show more
            </Button>
          )}
        </>
      )}
    </Card>
  );
}

function Row({
  entry,
  you,
}: Readonly<{ entry: LeaderboardEntry; you: boolean }>): React.JSX.Element {
  return (
    <tr
      className={cx(you && styles.yours)}
      data-testid={`leaderboard-row-${entry.username}`}
      data-you={you ? "true" : "false"}
    >
      <td className={styles.numeric}>{entry.rank}</td>
      <td>
        <Link to={`/profile/${entry.username}`}>{entry.username}</Link>
        {entry.countryCode !== null && <span className={styles.country}>{entry.countryCode}</span>}
        {you && <Badge tone="accent">you</Badge>}
      </td>
      <td className={styles.numeric}>{entry.rating}</td>
      <td className={styles.numeric}>{entry.wins}</td>
      <td className={styles.numeric}>{entry.games}</td>
    </tr>
  );
}
