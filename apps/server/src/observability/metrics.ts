import { Counter, Gauge, Histogram, Registry } from "prom-client";
import type { MatchEndReason, MatchMode } from "@gobblet/protocol";

/**
 * The metrics of spec section 17.3 as a Prometheus exposition
 * (docs/adr/0031-metrics-are-a-prometheus-exposition.md). Every label is a value
 * from a bounded vocabulary: a user id, a match id or a raw path would make the
 * number of series unbounded, so none of them appears here.
 */

const LATENCY_BUCKETS_SECONDS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];
const WAIT_BUCKETS_SECONDS = [0.5, 1, 2, 5, 10, 20, 30, 60, 120, 300];

export type CommandKind = "move" | "resign" | "rematch" | "queue";

export type QueueDepthReading = Readonly<{
  mode: MatchMode;
  timeControlSeconds: number;
  depth: number;
}>;

/**
 * The figures that are facts about this process rather than counts of things that
 * happened. They are read at scrape time, so a reader never sees a stale queue.
 */
export type PoolReading = Readonly<{ total: number; idle: number; waiting: number }>;

export type GaugeSources = Readonly<{
  activeMatches: () => number;
  connectedSockets: () => number;
  queueDepths: () => readonly QueueDepthReading[];
  /** Connections held, spare and queued: the shape of pool exhaustion (section 17.4). */
  pool: () => PoolReading;
  /** Whether this instance would answer `GET /health/ready` affirmatively. */
  ready: () => Promise<boolean>;
}>;

export class MetricsRegistry {
  readonly registry = new Registry();

  private readonly httpRequests: Counter<"method" | "route" | "status">;

  private readonly httpDuration: Histogram<"method" | "route" | "status">;

  private readonly socketConnections: Counter<string>;

  private readonly socketReconnects: Counter<string>;

  private readonly commandRejections: Counter<"command" | "reason">;

  private readonly moveLatency: Histogram<string>;

  private readonly databaseLatency: Histogram<"operation">;

  private readonly matchmakingWait: Histogram<"mode">;

  private readonly clockTimeouts: Counter<string>;

  private readonly completedMatches: Counter<"mode" | "reason">;

  private readonly errors: Counter<"code" | "route">;

  private readonly clientSessions: Counter<"platform" | "version">;

  private readonly matchTransactionFailures: Counter<"operation">;

  private readonly clockAnomalies: Counter<"kind">;

  private readonly signingFailures: Counter<"target" | "step">;

  private readonly updateChecks: Counter<"channel" | "target" | "offered">;

  private readonly updateOutcomes: Counter<"outcome">;

  private sources: GaugeSources | null = null;

  constructor(
    deployment: Readonly<{ appVersion: string; gitSha: string; appEnv: string }>,
    startedAtSeconds: number = Date.now() / 1000,
  ) {
    this.httpRequests = new Counter({
      name: "gobblet_http_requests_total",
      help: "HTTP requests by route pattern and status.",
      labelNames: ["method", "route", "status"],
      registers: [this.registry],
    });
    this.httpDuration = new Histogram({
      name: "gobblet_http_request_duration_seconds",
      help: "HTTP request latency by route pattern.",
      labelNames: ["method", "route", "status"],
      buckets: LATENCY_BUCKETS_SECONDS,
      registers: [this.registry],
    });
    this.socketConnections = new Counter({
      name: "gobblet_socket_connections_total",
      help: "Socket connections accepted.",
      registers: [this.registry],
    });
    this.socketReconnects = new Counter({
      name: "gobblet_socket_reconnects_total",
      help: "Sockets that attached to a match their actor was already playing.",
      registers: [this.registry],
    });
    this.commandRejections = new Counter({
      name: "gobblet_command_rejections_total",
      help: "Rejected commands by kind and reason code.",
      labelNames: ["command", "reason"],
      registers: [this.registry],
    });
    this.moveLatency = new Histogram({
      name: "gobblet_move_validation_duration_seconds",
      help: "Time to validate and commit a move.",
      buckets: LATENCY_BUCKETS_SECONDS,
      registers: [this.registry],
    });
    this.databaseLatency = new Histogram({
      name: "gobblet_database_transaction_duration_seconds",
      help: "Database transaction latency by named operation.",
      labelNames: ["operation"],
      buckets: LATENCY_BUCKETS_SECONDS,
      registers: [this.registry],
    });
    this.matchmakingWait = new Histogram({
      name: "gobblet_matchmaking_wait_seconds",
      help: "How long a pairing waited, by mode.",
      labelNames: ["mode"],
      buckets: WAIT_BUCKETS_SECONDS,
      registers: [this.registry],
    });
    this.clockTimeouts = new Counter({
      name: "gobblet_clock_timeouts_total",
      help: "Matches ended because a clock ran out.",
      registers: [this.registry],
    });
    this.completedMatches = new Counter({
      name: "gobblet_matches_completed_total",
      help: "Finished matches by mode and end reason.",
      labelNames: ["mode", "reason"],
      registers: [this.registry],
    });
    this.errors = new Counter({
      name: "gobblet_errors_total",
      help: "Errors by code and route pattern.",
      labelNames: ["code", "route"],
      registers: [this.registry],
    });
    this.clientSessions = new Counter({
      name: "gobblet_client_sessions_total",
      help: "Socket handshakes by platform and client version, which is how desktop adoption is read.",
      labelNames: ["platform", "version"],
      registers: [this.registry],
    });

    this.matchTransactionFailures = new Counter({
      name: "gobblet_match_transaction_failures_total",
      help: "Match transactions that failed and rolled back, by operation.",
      labelNames: ["operation"],
      registers: [this.registry],
    });
    this.clockAnomalies = new Counter({
      name: "gobblet_clock_anomalies_total",
      help: "Stored clocks that cannot be true, by kind. A non-zero value is a defect.",
      labelNames: ["kind"],
      registers: [this.registry],
    });

    this.signingFailures = new Counter({
      name: "gobblet_desktop_signing_failures_total",
      help: "Desktop artifacts that failed to sign or notarize, by platform and step.",
      labelNames: ["target", "step"],
      registers: [this.registry],
    });
    this.updateChecks = new Counter({
      name: "gobblet_desktop_update_checks_total",
      help: "Update checks by channel and platform, and whether one was offered.",
      labelNames: ["channel", "target", "offered"],
      registers: [this.registry],
    });
    this.updateOutcomes = new Counter({
      name: "gobblet_desktop_update_outcomes_total",
      help: "Desktop updates a client reported as finished, by outcome.",
      labelNames: ["outcome"],
      registers: [this.registry],
    });

    const deploymentInfo = new Gauge({
      name: "gobblet_deployment_info",
      help: "Always 1, carrying the running version as labels.",
      labelNames: ["app_version", "git_sha", "app_env"],
      registers: [this.registry],
    });
    deploymentInfo.set(
      {
        app_version: deployment.appVersion,
        git_sha: deployment.gitSha,
        app_env: deployment.appEnv,
      },
      1,
    );

    new Gauge({
      name: "gobblet_deployment_started_seconds",
      help: "When this process started, so an alert can tell a regression from a deploy.",
      registers: [this.registry],
    }).set(startedAtSeconds);

    const ready = new Gauge({
      name: "gobblet_ready",
      help: "1 when this instance would accept traffic, 0 when it would not.",
      registers: [this.registry],
      collect: async (): Promise<void> => {
        ready.set((await this.sources?.ready()) === true ? 1 : 0);
      },
    });

    const poolTotal = new Gauge({
      name: "gobblet_database_pool_connections",
      help: "Connections the pool holds.",
      registers: [this.registry],
      collect: (): void => {
        poolTotal.set(this.sources?.pool().total ?? 0);
      },
    });
    const poolIdle = new Gauge({
      name: "gobblet_database_pool_idle",
      help: "Connections the pool could hand out immediately.",
      registers: [this.registry],
      collect: (): void => {
        poolIdle.set(this.sources?.pool().idle ?? 0);
      },
    });
    const poolWaiting = new Gauge({
      name: "gobblet_database_pool_waiting",
      help: "Callers queued for a connection. Sustained above zero is exhaustion.",
      registers: [this.registry],
      collect: (): void => {
        poolWaiting.set(this.sources?.pool().waiting ?? 0);
      },
    });

    const activeMatches = new Gauge({
      name: "gobblet_active_matches",
      help: "Matches this instance is currently serving.",
      registers: [this.registry],
      collect: (): void => {
        activeMatches.set(this.sources?.activeMatches() ?? 0);
      },
    });
    const connectedSockets = new Gauge({
      name: "gobblet_socket_connections",
      help: "Sockets currently connected to this instance.",
      registers: [this.registry],
      collect: (): void => {
        connectedSockets.set(this.sources?.connectedSockets() ?? 0);
      },
    });
    const queueDepth = new Gauge({
      name: "gobblet_queue_depth",
      help: "Players waiting, by mode and time control.",
      labelNames: ["mode", "time_control_seconds"],
      registers: [this.registry],
      collect: (): void => {
        queueDepth.reset();
        for (const reading of this.sources?.queueDepths() ?? []) {
          queueDepth.set(
            { mode: reading.mode, time_control_seconds: String(reading.timeControlSeconds) },
            reading.depth,
          );
        }
      },
    });
  }

  /** Late-bound because the socket gateway is built after the HTTP surface. */
  observeSources(sources: GaugeSources): void {
    this.sources = sources;
  }

  recordHttpRequest(method: string, route: string, status: number, durationSeconds: number): void {
    const labels = { method, route, status: String(status) };
    this.httpRequests.inc(labels);
    this.httpDuration.observe(labels, durationSeconds);
  }

  recordSocketConnection(): void {
    this.socketConnections.inc();
  }

  recordSocketReconnect(): void {
    this.socketReconnects.inc();
  }

  recordCommandRejection(command: CommandKind, reason: string): void {
    this.commandRejections.inc({ command, reason });
  }

  observeMoveLatency(durationSeconds: number): void {
    this.moveLatency.observe(durationSeconds);
  }

  observeDatabaseLatency(operation: string, durationSeconds: number): void {
    this.databaseLatency.observe({ operation }, durationSeconds);
  }

  observeMatchmakingWait(mode: MatchMode, waitSeconds: number): void {
    this.matchmakingWait.observe({ mode }, waitSeconds);
  }

  recordClockTimeout(): void {
    this.clockTimeouts.inc();
  }

  recordCompletedMatch(mode: MatchMode, reason: MatchEndReason): void {
    this.completedMatches.inc({ mode, reason });
  }

  recordError(code: string, route: string): void {
    this.errors.inc({ code, route });
  }

  recordClientSession(platform: string, version: string): void {
    this.clientSessions.inc({ platform, version });
  }

  /** A match transaction that rolled back. Anything above zero deserves a look. */
  recordMatchTransactionFailure(operation: string): void {
    this.matchTransactionFailures.inc({ operation });
  }

  /** A stored clock that cannot be true, which section 17.4 alerts on. */
  recordClockAnomaly(kind: string): void {
    this.clockAnomalies.inc({ kind });
  }

  /**
   * A signing or notarization step that failed, reported by the release workflow
   * before the job stops (docs/adr/0036-signing-is-a-workflow-step-that-fails-loudly.md).
   */
  recordSigningFailure(target: string, step: string): void {
    this.signingFailures.inc({ target, step });
  }

  recordUpdateCheck(channel: string, target: string, offered: boolean): void {
    this.updateChecks.inc({ channel, target, offered: offered ? "yes" : "no" });
  }

  /** What a desktop client reported about an update it tried to install. */
  recordUpdateOutcome(outcome: string): void {
    this.updateOutcomes.inc({ outcome });
  }

  /**
   * How many errors this process has counted. The dashboard reads it from the same
   * registry a scraper does, so the two can never disagree (appendix P7.7).
   */
  async errorTotal(): Promise<number> {
    const counted = await this.errors.get();
    return counted.values.reduce((total, sample) => total + sample.value, 0);
  }

  async expose(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}
