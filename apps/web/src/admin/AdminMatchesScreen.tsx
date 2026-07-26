import { Banner, Card, Spinner } from "@gobblet/design-system";
import { Link } from "react-router";
import { describeApiError } from "../api/errors";
import { useAdminMatches } from "../api/queries";
import styles from "./Admin.module.css";

/**
 * The matches this instance is serving, read from the runtime at the moment of the
 * request rather than from a store that could lag it (appendix P7.6).
 */
export function AdminMatchesScreen(): React.JSX.Element {
  const matches = useAdminMatches(true);

  if (matches.isPending) {
    return (
      <Card title="Matches">
        <Spinner label="Reading the running matches" />
      </Card>
    );
  }

  if (matches.isError) {
    return (
      <Card title="Matches">
        <Banner tone="error">{describeApiError(matches.error)}</Banner>
      </Card>
    );
  }

  return (
    <Card title="Matches" description="Being played right now.">
      {matches.data.matches.length === 0 ? (
        <p data-testid="admin-matches-empty">Nothing is being played.</p>
      ) : (
        <table className={styles.table} data-testid="admin-matches-table">
          <thead>
            <tr>
              <th scope="col">Match</th>
              <th scope="col">Mode</th>
              <th scope="col">Clock</th>
              <th scope="col">Light</th>
              <th scope="col">Dark</th>
              <th scope="col">Version</th>
              <th scope="col">Started</th>
            </tr>
          </thead>
          <tbody>
            {matches.data.matches.map((match) => (
              <tr key={match.matchId} data-testid={`admin-match-row-${match.matchId}`}>
                <td>
                  <Link to={`/admin/matches/${match.matchId}`}>{match.matchId.slice(0, 8)}</Link>
                </td>
                <td>{match.mode}</td>
                <td>{`${String(match.timeControlSeconds / 60)}m`}</td>
                <td>{match.lightDisplayName}</td>
                <td>{match.darkDisplayName}</td>
                <td className={styles.numeric}>{match.version}</td>
                <td>{match.startedAt === null ? "not started" : match.startedAt.slice(11, 19)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
