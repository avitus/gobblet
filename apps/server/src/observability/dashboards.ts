/**
 * The launch dashboards of spec section 24 (Phase 9), defined once
 * (docs/adr/0042-launch-dashboards-are-rendered-from-one-definition.md). Each panel
 * names the series it draws, `ops/dashboards/*.json` is rendered from these
 * definitions by `pnpm ops:dashboards`, and `apps/server/test/dashboards.test.ts`
 * checks every series against a real exposition, so a panel cannot quietly point at
 * a metric the server stopped emitting.
 */

export type PanelKind = "timeseries" | "stat" | "gauge" | "bargauge";

export type PanelSeries = Readonly<{
  /** PromQL, built from the metric named below so the test can find it. */
  expression: string;
  /** The metric the expression reads. Asserted against the exposition. */
  metric: string;
  legend: string;
}>;

export type PanelDefinition = Readonly<{
  title: string;
  kind: PanelKind;
  /** The question this panel answers, which is also its description in Grafana. */
  answers: string;
  unit: string;
  series: readonly PanelSeries[];
}>;

export type DashboardDefinition = Readonly<{
  uid: string;
  title: string;
  /** Who looks at this, and when. */
  audience: string;
  panels: readonly PanelDefinition[];
}>;

const WINDOW = "5m";

function rate(metric: string, matchers = ""): string {
  return `sum(rate(${metric}${matchers === "" ? "" : `{${matchers}}`}[${WINDOW}]))`;
}

function quantile(metric: string, fraction: number): string {
  return `histogram_quantile(${String(fraction)}, sum(rate(${metric}_bucket[${WINDOW}])) by (le))`;
}

export const DASHBOARD_DEFINITIONS: readonly DashboardDefinition[] = Object.freeze([
  {
    uid: "gobblet-service-health",
    title: "Gobblet service health",
    audience: "The first dashboard to open when something is wrong, and during a release.",
    panels: [
      {
        title: "Readiness",
        kind: "stat",
        answers: "Would this instance accept traffic right now?",
        unit: "bool",
        series: [{ expression: "min(gobblet_ready)", metric: "gobblet_ready", legend: "ready" }],
      },
      {
        title: "Requests by status",
        kind: "timeseries",
        answers: "How much traffic is there, and how much of it is failing?",
        unit: "reqps",
        series: [
          {
            expression: rate("gobblet_http_requests_total"),
            metric: "gobblet_http_requests_total",
            legend: "all",
          },
          {
            expression: rate("gobblet_http_requests_total", 'status=~"5.."'),
            metric: "gobblet_http_requests_total",
            legend: "server errors",
          },
        ],
      },
      {
        title: "Request latency",
        kind: "timeseries",
        answers: "Is the API within the latency target of section 21.3?",
        unit: "s",
        series: [
          {
            expression: quantile("gobblet_http_request_duration_seconds", 0.95),
            metric: "gobblet_http_request_duration_seconds",
            legend: "p95",
          },
          {
            expression: quantile("gobblet_http_request_duration_seconds", 0.99),
            metric: "gobblet_http_request_duration_seconds",
            legend: "p99",
          },
        ],
      },
      {
        title: "Errors by code",
        kind: "timeseries",
        answers: "What is failing, as the server itself classified it?",
        unit: "short",
        series: [
          {
            expression: `sum by (code) (rate(gobblet_errors_total[${WINDOW}]))`,
            metric: "gobblet_errors_total",
            legend: "{{code}}",
          },
        ],
      },
      {
        title: "Database pool",
        kind: "timeseries",
        answers: "Is anything waiting for a connection?",
        unit: "short",
        series: [
          {
            expression: "sum(gobblet_database_pool_connections)",
            metric: "gobblet_database_pool_connections",
            legend: "open",
          },
          {
            expression: "sum(gobblet_database_pool_idle)",
            metric: "gobblet_database_pool_idle",
            legend: "idle",
          },
          {
            expression: "sum(gobblet_database_pool_waiting)",
            metric: "gobblet_database_pool_waiting",
            legend: "waiting",
          },
        ],
      },
      {
        title: "Transaction duration",
        kind: "timeseries",
        answers: "Are the writes that hold a match together still fast?",
        unit: "s",
        series: [
          {
            expression: quantile("gobblet_database_transaction_duration_seconds", 0.95),
            metric: "gobblet_database_transaction_duration_seconds",
            legend: "p95",
          },
        ],
      },
      {
        title: "Running version",
        kind: "stat",
        answers: "Which build is serving, and since when?",
        unit: "short",
        series: [
          {
            expression: "max(gobblet_deployment_started_seconds)",
            metric: "gobblet_deployment_started_seconds",
            legend: "started",
          },
          {
            expression: "max(gobblet_deployment_info) by (app_version, git_sha)",
            metric: "gobblet_deployment_info",
            legend: "{{app_version}} {{git_sha}}",
          },
        ],
      },
    ],
  },
  {
    uid: "gobblet-gameplay",
    title: "Gobblet gameplay",
    audience: "What players are experiencing: pairing, playing, and finishing matches.",
    panels: [
      {
        title: "Active matches",
        kind: "timeseries",
        answers: "How many matches are being played right now?",
        unit: "short",
        series: [
          {
            expression: "sum(gobblet_active_matches)",
            metric: "gobblet_active_matches",
            legend: "active",
          },
        ],
      },
      {
        title: "Queue depth",
        kind: "timeseries",
        answers: "Is anyone stuck waiting for an opponent?",
        unit: "short",
        series: [
          {
            expression: "sum by (mode) (gobblet_queue_depth)",
            metric: "gobblet_queue_depth",
            legend: "{{mode}}",
          },
        ],
      },
      {
        title: "Time to pair",
        kind: "timeseries",
        answers: "How long does a player wait before a match starts?",
        unit: "s",
        series: [
          {
            expression: quantile("gobblet_matchmaking_wait_seconds", 0.5),
            metric: "gobblet_matchmaking_wait_seconds",
            legend: "p50",
          },
          {
            expression: quantile("gobblet_matchmaking_wait_seconds", 0.95),
            metric: "gobblet_matchmaking_wait_seconds",
            legend: "p95",
          },
        ],
      },
      {
        title: "Move validation",
        kind: "timeseries",
        answers: "Is the rules engine still answering in microseconds?",
        unit: "s",
        series: [
          {
            expression: quantile("gobblet_move_validation_duration_seconds", 0.99),
            metric: "gobblet_move_validation_duration_seconds",
            legend: "p99",
          },
        ],
      },
      {
        title: "Matches completed",
        kind: "timeseries",
        answers: "How are matches ending?",
        unit: "short",
        series: [
          {
            expression: `sum by (end_reason) (increase(gobblet_matches_completed_total[${WINDOW}]))`,
            metric: "gobblet_matches_completed_total",
            legend: "{{end_reason}}",
          },
        ],
      },
      {
        title: "Command rejections",
        kind: "timeseries",
        answers: "Are clients being refused, and why?",
        unit: "short",
        series: [
          {
            expression: `sum by (reason) (increase(gobblet_command_rejections_total[${WINDOW}]))`,
            metric: "gobblet_command_rejections_total",
            legend: "{{reason}}",
          },
        ],
      },
      {
        title: "Clock health",
        kind: "timeseries",
        answers: "Are clocks running out, and has any clock calculation gone wrong?",
        unit: "short",
        series: [
          {
            expression: `sum(increase(gobblet_clock_timeouts_total[${WINDOW}]))`,
            metric: "gobblet_clock_timeouts_total",
            legend: "timeouts",
          },
          {
            expression: `sum(increase(gobblet_clock_anomalies_total[${WINDOW}]))`,
            metric: "gobblet_clock_anomalies_total",
            legend: "anomalies",
          },
        ],
      },
      {
        title: "Match transaction failures",
        kind: "stat",
        answers: "Has a command been neither applied nor answered?",
        unit: "short",
        series: [
          {
            expression: `sum(increase(gobblet_match_transaction_failures_total[${WINDOW}]))`,
            metric: "gobblet_match_transaction_failures_total",
            legend: "failures",
          },
        ],
      },
    ],
  },
  {
    uid: "gobblet-clients",
    title: "Gobblet clients and releases",
    audience: "What is connected, and how a desktop release is landing.",
    panels: [
      {
        title: "Connected sockets",
        kind: "timeseries",
        answers: "How many clients are connected?",
        unit: "short",
        series: [
          {
            expression: "sum(gobblet_socket_connections)",
            metric: "gobblet_socket_connections",
            legend: "connected",
          },
        ],
      },
      {
        title: "Connections and reconnections",
        kind: "timeseries",
        answers: "Are clients being dropped and coming back?",
        unit: "short",
        series: [
          {
            expression: rate("gobblet_socket_connections_total"),
            metric: "gobblet_socket_connections_total",
            legend: "connects",
          },
          {
            expression: rate("gobblet_socket_reconnects_total"),
            metric: "gobblet_socket_reconnects_total",
            legend: "reconnects",
          },
        ],
      },
      {
        title: "Sessions by platform and version",
        kind: "bargauge",
        answers: "Which builds are in players' hands?",
        unit: "short",
        series: [
          {
            expression: `sum by (platform, client_version) (increase(gobblet_client_sessions_total[${WINDOW}]))`,
            metric: "gobblet_client_sessions_total",
            legend: "{{platform}} {{client_version}}",
          },
        ],
      },
      {
        title: "Desktop update checks",
        kind: "timeseries",
        answers: "Are desktop clients asking for updates, and on which channel?",
        unit: "short",
        series: [
          {
            expression: `sum by (channel, result) (increase(gobblet_desktop_update_checks_total[${WINDOW}]))`,
            metric: "gobblet_desktop_update_checks_total",
            legend: "{{channel}} {{result}}",
          },
        ],
      },
      {
        title: "Desktop update outcomes",
        kind: "timeseries",
        answers: "Is the update installing, or failing on players' machines?",
        unit: "short",
        series: [
          {
            expression: `sum by (outcome) (increase(gobblet_desktop_update_outcomes_total[${WINDOW}]))`,
            metric: "gobblet_desktop_update_outcomes_total",
            legend: "{{outcome}}",
          },
        ],
      },
      {
        title: "Signing failures",
        kind: "stat",
        answers: "Did a release go out unsigned, or fail to sign?",
        unit: "short",
        series: [
          {
            expression: `sum(increase(gobblet_desktop_signing_failures_total[${WINDOW}]))`,
            metric: "gobblet_desktop_signing_failures_total",
            legend: "failures",
          },
        ],
      },
    ],
  },
]);

/** Every metric any panel reads, once. */
export function dashboardMetrics(
  definitions: readonly DashboardDefinition[] = DASHBOARD_DEFINITIONS,
): readonly string[] {
  return [
    ...new Set(
      definitions.flatMap((dashboard) =>
        dashboard.panels.flatMap((panel) => panel.series.map((series) => series.metric)),
      ),
    ),
  ].sort();
}

type GrafanaTarget = Readonly<{ expr: string; legendFormat: string; refId: string }>;

const REF_IDS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const PANELS_PER_ROW = 2;
const PANEL_WIDTH = 12;
const PANEL_HEIGHT = 8;

/**
 * Grafana's dashboard JSON, the subset that carries meaning. It is written by the
 * command, never by hand, so the layout is derived rather than chosen.
 */
export function renderDashboard(definition: DashboardDefinition): string {
  const panels = definition.panels.map((panel, index) => ({
    id: index + 1,
    type: panel.kind,
    title: panel.title,
    description: panel.answers,
    datasource: { type: "prometheus", uid: "${datasource}" },
    fieldConfig: { defaults: { unit: panel.unit }, overrides: [] },
    gridPos: {
      h: PANEL_HEIGHT,
      w: PANEL_WIDTH,
      x: (index % PANELS_PER_ROW) * PANEL_WIDTH,
      y: Math.floor(index / PANELS_PER_ROW) * PANEL_HEIGHT,
    },
    targets: panel.series.map((series, position): GrafanaTarget => ({
      expr: series.expression,
      legendFormat: series.legend,
      refId: REF_IDS[position % REF_IDS.length] as string,
    })),
  }));

  return `${JSON.stringify(
    {
      uid: definition.uid,
      title: definition.title,
      description: definition.audience,
      editable: false,
      schemaVersion: 39,
      refresh: "30s",
      time: { from: "now-6h", to: "now" },
      templating: {
        list: [
          {
            name: "datasource",
            type: "datasource",
            query: "prometheus",
            current: {},
            hide: 0,
          },
        ],
      },
      panels,
    },
    null,
    2,
  )}\n`;
}

export function dashboardFileName(definition: DashboardDefinition): string {
  return `${definition.uid}.json`;
}
