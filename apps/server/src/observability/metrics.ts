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
export type GaugeSources = Readonly<{
  activeMatches: () => number;
  connectedSockets: () => number;
  queueDepths: () => readonly QueueDepthReading[];
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

  private sources: GaugeSources | null = null;

  constructor(deployment: Readonly<{ appVersion: string; gitSha: string; appEnv: string }>) {
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
