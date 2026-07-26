import { Banner, Card, Spinner } from "@gobblet/design-system";
import { useParams } from "react-router";
import { describeApiError } from "../api/errors";
import { useAdminMatch } from "../api/queries";
import styles from "./Admin.module.css";

function describePayload(payload: unknown): string {
  return payload === null ? "" : JSON.stringify(payload);
}

/**
 * One match as the server recorded it: every event with its payload and state hash,
 * and the connection history beside it, because a socket attaching is not a match
 * event and consumes no version (appendix P7.5).
 */
export function AdminMatchScreen(): React.JSX.Element {
  const { matchId = null } = useParams<{ matchId: string }>();

  if (matchId === null) {
    return (
      <Card title="Match">
        <Banner tone="error">That address names no match.</Banner>
      </Card>
    );
  }

  return <MatchDetail matchId={matchId} />;
}

function MatchDetail({ matchId }: Readonly<{ matchId: string }>): React.JSX.Element {
  const detail = useAdminMatch(matchId, true);

  if (detail.isPending) {
    return (
      <Card title="Match">
        <Spinner label="Reading the match" />
      </Card>
    );
  }

  if (detail.isError) {
    return (
      <Card title="Match">
        <Banner tone="error">{describeApiError(detail.error)}</Banner>
      </Card>
    );
  }

  const { match, clocks, events, connections, version } = detail.data;

  return (
    <div className={styles.layout} data-testid="admin-match-detail">
      <Card title={`${match.players.light.displayName} against ${match.players.dark.displayName}`}>
        <dl className={styles.readings}>
          <dt>Mode</dt>
          <dd>{match.mode}</dd>
          <dt>Status</dt>
          <dd>{match.status}</dd>
          <dt>Version</dt>
          <dd data-testid="admin-match-version">{version}</dd>
          <dt>Moves</dt>
          <dd>{match.moveCount}</dd>
          <dt>Result</dt>
          <dd data-testid="admin-match-result">
            {match.result === null
              ? "unfinished"
              : `${match.result.outcome} by ${match.result.reason}`}
          </dd>
          <dt>Clocks</dt>
          <dd>{`${String(Math.round(clocks.lightRemainingMs / 1000))}s / ${String(Math.round(clocks.darkRemainingMs / 1000))}s`}</dd>
        </dl>
      </Card>

      <Card title="Events" description="The internal log, payloads and state hashes included.">
        <table className={styles.table} data-testid="admin-match-events">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Type</th>
              <th scope="col">Actor</th>
              <th scope="col">Payload</th>
              <th scope="col">State hash</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.sequence} data-testid={`admin-match-event-${String(event.sequence)}`}>
                <td className={styles.numeric}>{event.sequence}</td>
                <td>{event.type}</td>
                <td>{event.actorType ?? "server"}</td>
                <td>
                  <pre className={styles.payload}>{describePayload(event.payload)}</pre>
                </td>
                <td className={styles.numeric}>{event.stateHash.slice(0, 12)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Connections" description="Sockets that attached to this match and left it.">
        {connections.length === 0 ? (
          <p data-testid="admin-match-connections-empty">No socket has attached.</p>
        ) : (
          <table className={styles.table} data-testid="admin-match-connections">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">What</th>
                <th scope="col">Actor</th>
                <th scope="col">Reason</th>
              </tr>
            </thead>
            <tbody>
              {connections.map((connection) => (
                <tr key={`${connection.socketId}-${connection.kind}-${connection.createdAt}`}>
                  <td>{connection.createdAt.slice(11, 19)}</td>
                  <td>{connection.kind}</td>
                  <td>{connection.actorType}</td>
                  <td>{connection.reason ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
