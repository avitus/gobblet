/**
 * The nine conditions of spec section 17.4, each as one rule over the exposition of
 * docs/adr/0031-metrics-are-a-prometheus-exposition.md. A condition is described
 * once, here: `ops/alerts/gobblet.rules.yml` is rendered from these definitions and
 * `apps/server/test/alert-rules.test.ts` evaluates the same definitions against a
 * real exposition, so the file a Prometheus loads and the behaviour a test proves
 * cannot drift apart. Delivering a firing alert to a human needs the hosted
 * monitoring deferred by ADR-0015; the conditions are not deferred (appendix P7.15).
 */

export type LabelMatchers = Readonly<Record<string, string>>;

export type Selector = Readonly<{
  metric: string;
  /** Equality matchers, rendered as `label="value"`. */
  labels?: LabelMatchers;
  /** Regular-expression matchers, rendered as `label=~"pattern"`. */
  patterns?: LabelMatchers;
}>;

/**
 * The four shapes the conditions need. Anything richer would be a PromQL the tests
 * could not honestly evaluate, so a condition that needs more is a sign the metric
 * is wrong rather than the algebra.
 */
export type Term =
  /** The current value, summed over matching series. */
  | Readonly<{ kind: "value"; selector: Selector }>
  /** How much a counter grew over the window, summed over matching series. */
  | Readonly<{ kind: "increase"; selector: Selector; window: string }>
  /** The share of one counter's growth in another's, over the window. */
  | Readonly<{ kind: "share"; part: Selector; whole: Selector; window: string }>
  /** Seconds since a timestamp gauge, which is how staleness is expressed. */
  | Readonly<{ kind: "age"; selector: Selector }>;

export type Comparison = ">" | ">=" | "<" | "<=" | "==";

export type Condition = Readonly<{ term: Term; comparison: Comparison; threshold: number }>;

export type AlertDefinition = Readonly<{
  alert: string;
  /** The line of section 17.4 this rule answers, quoted. */
  condition: string;
  severity: "page" | "ticket";
  /** How long the condition must hold, so a single scrape cannot page anyone. */
  duration: string;
  summary: string;
  /** All of these must hold, rendered with `and`. */
  all: readonly Condition[];
  /** Present when the series does not exist yet, and says when it will. */
  pending?: string;
}>;

function selectorText(selector: Selector): string {
  const matchers = [
    ...Object.entries(selector.labels ?? {}).map(([name, value]) => `${name}="${value}"`),
    ...Object.entries(selector.patterns ?? {}).map(([name, value]) => `${name}=~"${value}"`),
  ];
  return matchers.length === 0 ? selector.metric : `${selector.metric}{${matchers.join(",")}}`;
}

export function termText(term: Term): string {
  switch (term.kind) {
    case "value":
      return `sum(${selectorText(term.selector)})`;
    case "increase":
      return `sum(increase(${selectorText(term.selector)}[${term.window}]))`;
    case "share":
      return `sum(rate(${selectorText(term.part)}[${term.window}])) / sum(rate(${selectorText(term.whole)}[${term.window}]))`;
    case "age":
      return `time() - max(${selectorText(term.selector)})`;
  }
}

export function expressionText(definition: AlertDefinition): string {
  return definition.all
    .map(
      (condition) =>
        `${termText(condition.term)} ${condition.comparison} ${String(condition.threshold)}`,
    )
    .join("\n  and\n");
}

const FIVE_MINUTES = "5m";

export const ALERT_DEFINITIONS: readonly AlertDefinition[] = Object.freeze([
  {
    alert: "GobbletReadinessFailing",
    condition: "Readiness failure.",
    severity: "page",
    duration: "2m",
    summary: "The instance reports that it would not accept traffic.",
    all: [
      {
        term: { kind: "value", selector: { metric: "gobblet_ready" } },
        comparison: "==",
        threshold: 0,
      },
    ],
  },
  {
    alert: "GobbletServerErrorRateElevated",
    condition: "Elevated 5xx rate.",
    severity: "page",
    duration: FIVE_MINUTES,
    summary: "More than five percent of HTTP requests are failing with a server error.",
    all: [
      {
        term: {
          kind: "share",
          part: { metric: "gobblet_http_requests_total", patterns: { status: "5.." } },
          whole: { metric: "gobblet_http_requests_total" },
          window: FIVE_MINUTES,
        },
        comparison: ">",
        threshold: 0.05,
      },
    ],
  },
  {
    alert: "GobbletDatabasePoolExhausted",
    condition: "Database connection exhaustion.",
    severity: "page",
    duration: "3m",
    summary: "Callers are queued for a database connection and none is spare.",
    all: [
      {
        term: { kind: "value", selector: { metric: "gobblet_database_pool_waiting" } },
        comparison: ">",
        threshold: 0,
      },
      {
        term: { kind: "value", selector: { metric: "gobblet_database_pool_idle" } },
        comparison: "==",
        threshold: 0,
      },
    ],
  },
  {
    alert: "GobbletMatchTransactionsFailing",
    condition: "Match transaction failures.",
    severity: "page",
    duration: "1m",
    summary: "A match transaction rolled back, so a command was neither applied nor answered.",
    all: [
      {
        term: {
          kind: "increase",
          selector: { metric: "gobblet_match_transaction_failures_total" },
          window: FIVE_MINUTES,
        },
        comparison: ">",
        threshold: 0,
      },
    ],
  },
  {
    alert: "GobbletStaleVersionRejectionsSpiking",
    condition: "Large increase in stale-version rejections.",
    severity: "ticket",
    duration: FIVE_MINUTES,
    summary: "Clients are sending commands against a version the server has moved past.",
    all: [
      {
        term: {
          kind: "increase",
          selector: {
            metric: "gobblet_command_rejections_total",
            labels: { reason: "stale-version" },
          },
          window: FIVE_MINUTES,
        },
        comparison: ">",
        threshold: 50,
      },
    ],
  },
  {
    alert: "GobbletClockAnomaly",
    condition: "Clock calculation errors.",
    severity: "page",
    duration: "0m",
    summary: "A stored clock cannot be true: time ran backwards or a side owes time.",
    all: [
      {
        term: {
          kind: "increase",
          selector: { metric: "gobblet_clock_anomalies_total" },
          window: "15m",
        },
        comparison: ">",
        threshold: 0,
      },
    ],
  },
  {
    alert: "GobbletBackupStale",
    condition: "Failed backups.",
    severity: "page",
    duration: "30m",
    summary: "No backup has succeeded for more than a day, so the recovery point is slipping.",
    all: [
      {
        term: {
          kind: "age",
          selector: { metric: "gobblet_backup_last_success_timestamp_seconds" },
        },
        comparison: ">",
        threshold: 93_600,
      },
    ],
  },
  {
    alert: "GobbletDesktopSigningFailure",
    condition: "Desktop update-signing failure.",
    severity: "page",
    duration: "0m",
    summary: "A desktop artifact failed to sign, so an update must not be published.",
    pending: "The series is written by the desktop release job of Phase 8 (appendix P7.10).",
    all: [
      {
        term: {
          kind: "increase",
          selector: { metric: "gobblet_desktop_signing_failures_total" },
          window: "1h",
        },
        comparison: ">",
        threshold: 0,
      },
    ],
  },
  {
    alert: "GobbletErrorRegressionAfterDeploy",
    condition: "Error-rate regression after deployment.",
    severity: "page",
    duration: FIVE_MINUTES,
    summary: "Errors climbed shortly after a deployment, which is a rollback decision.",
    all: [
      {
        term: {
          kind: "increase",
          selector: { metric: "gobblet_errors_total" },
          window: "10m",
        },
        comparison: ">",
        threshold: 10,
      },
      {
        term: {
          kind: "age",
          selector: { metric: "gobblet_deployment_started_seconds" },
        },
        comparison: "<",
        threshold: 3_600,
      },
    ],
  },
]);

/** The rules file, rendered from the definitions. `ops/alerts/gobblet.rules.yml`. */
export function renderAlertRules(
  definitions: readonly AlertDefinition[] = ALERT_DEFINITIONS,
): string {
  const lines: string[] = [
    "# Generated by apps/server/src/cli/write-alert-rules.ts. Do not edit by hand.",
    "# One rule per condition in docs/product-spec.md section 17.4; the definitions",
    "# live in apps/server/src/observability/alerts.ts and are evaluated by",
    "# apps/server/test/alert-rules.test.ts against a real exposition.",
    "groups:",
    "  - name: gobblet",
    "    rules:",
  ];

  for (const definition of definitions) {
    lines.push(`      - alert: ${definition.alert}`);
    lines.push("        expr: |-");
    for (const line of expressionText(definition).split("\n")) {
      lines.push(`          ${line}`);
    }
    lines.push(`        for: ${definition.duration}`);
    lines.push("        labels:");
    lines.push("          severity: " + definition.severity);
    lines.push("        annotations:");
    lines.push(`          summary: ${JSON.stringify(definition.summary)}`);
    lines.push(`          condition: ${JSON.stringify(definition.condition)}`);
    if (definition.pending !== undefined) {
      lines.push(`          pending: ${JSON.stringify(definition.pending)}`);
    }
  }

  return `${lines.join("\n")}\n`;
}
