import { Badge, Banner, Card, Spinner } from "@gobblet/design-system";
import type { AdminMetricsSummary } from "@gobblet/protocol";
import { describeApiError } from "../api/errors";
import { useAdminMetrics } from "../api/queries";
import styles from "./Admin.module.css";

function percent(rate: number | null): string {
  return rate === null ? "not yet" : `${String(Math.round(rate * 100))}%`;
}

function seconds(ms: number | null): string {
  return ms === null ? "not yet" : `${(ms / 1000).toFixed(1)}s`;
}

function uptime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return hours === 0 ? `${String(minutes)}m` : `${String(hours)}h ${String(minutes)}m`;
}

/**
 * What the deployment is doing right now and over the last day: readiness, active
 * users, how matches ended, how long pairing took and what has been failing
 * (spec section 16, appendices P7.6 to P7.9).
 */
export function AdminOverviewScreen(): React.JSX.Element {
  const metrics = useAdminMetrics(true);

  if (metrics.isPending) {
    return (
      <Card title="Overview">
        <Spinner label="Reading the deployment" />
      </Card>
    );
  }

  if (metrics.isError) {
    return (
      <Card title="Overview">
        <Banner tone="error">{describeApiError(metrics.error)}</Banner>
      </Card>
    );
  }

  const summary: AdminMetricsSummary = metrics.data;

  return (
    <div className={styles.cards} data-testid="admin-overview">
      <Card title="Deployment" description={`Version ${summary.deployment.appVersion}`}>
        <dl className={styles.readings}>
          <dt>Environment</dt>
          <dd>{summary.deployment.appEnv}</dd>
          <dt>Commit</dt>
          <dd>{summary.deployment.gitSha}</dd>
          <dt>Uptime</dt>
          <dd>{uptime(summary.deployment.uptimeSeconds)}</dd>
          <dt>Readiness</dt>
          <dd data-testid="overview-ready">
            <Badge tone={summary.health.ready ? "ok" : "error"}>
              {summary.health.ready ? "ready" : "not ready"}
            </Badge>
          </dd>
          {summary.health.checks.map((check) => (
            <div key={check.name} style={{ display: "contents" }}>
              <dt>{check.name}</dt>
              <dd>{check.ok ? "ok" : "failing"}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card title="Players" description={`Last ${String(summary.windowHours)} hours.`}>
        <dl className={styles.readings}>
          <dt>Active users</dt>
          <dd data-testid="overview-dau">{summary.activity.dailyActiveUsers}</dd>
          <dt>Accounts</dt>
          <dd>{summary.activity.dailyActiveAccounts}</dd>
          <dt>Guests</dt>
          <dd>{summary.activity.dailyActiveGuests}</dd>
          <dt>Sockets now</dt>
          <dd>{summary.sockets.connected}</dd>
        </dl>
      </Card>

      <Card title="Matches" description={`Last ${String(summary.windowHours)} hours.`}>
        <dl className={styles.readings}>
          <dt>Being played</dt>
          <dd>{summary.matches.active}</dd>
          <dt>Completed</dt>
          <dd>{summary.matches.completed}</dd>
          <dt>Aborted</dt>
          <dd>{summary.matches.aborted}</dd>
          <dt>Completion</dt>
          <dd data-testid="overview-completion">{percent(summary.matches.completionRate)}</dd>
          <dt>Abandonment</dt>
          <dd>{percent(summary.matches.abandonmentRate)}</dd>
          {summary.matches.byEndReason.map((entry) => (
            <div key={entry.reason} style={{ display: "contents" }}>
              <dt>{entry.reason}</dt>
              <dd>{entry.count}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card title="Matchmaking" description="Queues are read from this instance.">
        <dl className={styles.readings}>
          <dt>Average wait</dt>
          <dd>{seconds(summary.matchmaking.averageWaitMs)}</dd>
          <dt>Pairings</dt>
          <dd>{summary.matchmaking.pairings}</dd>
          {summary.matchmaking.queueDepth.map((depth) => (
            <div
              key={`${depth.mode}-${String(depth.timeControlSeconds)}`}
              style={{ display: "contents" }}
            >
              <dt>{`${depth.mode} ${String(depth.timeControlSeconds / 60)}m`}</dt>
              <dd>{depth.waiting}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card title="Errors" description="Codes and routes, never messages or stacks.">
        <p>
          <strong data-testid="overview-errors">{summary.errors.total}</strong> since this process
          started.
        </p>
        {summary.errors.recent.length === 0 ? (
          <p data-testid="overview-errors-empty">Nothing has failed yet.</p>
        ) : (
          <table className={styles.table} data-testid="overview-recent-errors">
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Route</th>
                <th scope="col">Count</th>
                <th scope="col">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {summary.errors.recent.map((error) => (
                <tr key={`${error.code}-${error.route}`}>
                  <td>{error.code}</td>
                  <td>{error.route}</td>
                  <td className={styles.numeric}>{error.count}</td>
                  <td>{error.lastSeenAt.slice(11, 19)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Clients" description="Desktop adoption arrives with the desktop client.">
        {summary.clientVersions.length === 0 ? (
          <p data-testid="overview-clients-empty">No client sessions recorded yet.</p>
        ) : (
          <dl className={styles.readings}>
            {summary.clientVersions.map((client) => (
              <div key={`${client.platform}-${client.version}`} style={{ display: "contents" }}>
                <dt>{`${client.platform} ${client.version}`}</dt>
                <dd>{client.sessions}</dd>
              </div>
            ))}
          </dl>
        )}
      </Card>
    </div>
  );
}
