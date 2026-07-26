import { Badge, Banner, Card, Spinner } from "@gobblet/design-system";
import { Link } from "react-router";
import { describeApiError } from "../api/errors";
import { useMatchHistory } from "../api/queries";
import { describePlayerResult, describeRatingDelta } from "../match/summary";
import { useSessionStore } from "../session/store";
import styles from "./HistoryScreen.module.css";

function describeDate(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * The player's own match list of section 11.2, newest first. A guest sees the same
 * list for the life of the session, which is what claiming the guest preserves.
 */
export function HistoryScreen(): React.JSX.Element {
  const session = useSessionStore((state) => state.session);
  const history = useMatchHistory(session !== null);

  if (session === null) {
    return (
      <Card title="Match history">
        <p>
          Start a session to see your matches. <Link to="/">Play</Link>.
        </p>
      </Card>
    );
  }

  if (history.isPending) {
    return (
      <Card title="Match history">
        <Spinner label="Loading your matches" />
      </Card>
    );
  }

  if (history.isError) {
    return (
      <Card title="Match history">
        <Banner tone="error">{describeApiError(history.error)}</Banner>
      </Card>
    );
  }

  return (
    <Card title="Match history" description="Newest first.">
      {history.data.matches.length === 0 ? (
        <p data-testid="history-empty">No matches yet.</p>
      ) : (
        <table className={styles.table} data-testid="history-table">
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Mode</th>
              <th scope="col">Clock</th>
              <th scope="col">Seat</th>
              <th scope="col">Opponent</th>
              <th scope="col">Moves</th>
              <th scope="col">Rating</th>
              <th scope="col">Result</th>
            </tr>
          </thead>
          <tbody>
            {history.data.matches.map((match) => (
              <tr key={match.matchId} data-testid={`history-row-${match.matchId}`}>
                <td>{describeDate(match.createdAt)}</td>
                <td>
                  {match.mode === "ranked" ? (
                    <Badge tone="accent">ranked</Badge>
                  ) : (
                    <Badge>casual</Badge>
                  )}
                </td>
                <td>{`${String(match.timeControlSeconds / 60)} min`}</td>
                <td>{match.side}</td>
                <td>{match.players[match.side === "light" ? "dark" : "light"].displayName}</td>
                <td>{match.moveCount}</td>
                <td data-testid={`history-rating-${match.matchId}`}>
                  {describeRatingDelta(match.ratingDelta)}
                </td>
                <td>
                  {match.status === "active" ? (
                    <Link to={`/match/${match.matchId}`}>resume</Link>
                  ) : (
                    describePlayerResult(match)
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
