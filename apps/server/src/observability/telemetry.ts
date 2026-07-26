import type { AnalyticsEvent, TelemetryErrorRequest } from "@gobblet/protocol";
import { NullAnalytics } from "./analytics";
import type { AnalyticsPort } from "./analytics";
import { NullErrorReporting } from "./error-reporting";
import type { ErrorReportingPort } from "./error-reporting";
import { RecentErrors } from "./error-log";
import { MetricsRegistry } from "./metrics";
import type { Pseudonymiser } from "./pseudonym";

/**
 * One place that decides what leaves this process: the analytics event, the error
 * report, the metric and the pseudonym on all three
 * (docs/adr/0030-telemetry-behind-ports-relayed-through-the-server.md). Everything
 * else calls this, so there is a single audit point for section 17's prohibitions.
 */

export type TelemetryActor = Readonly<{ actorType: string; actorId: string }> | null;

export type TelemetryOptions = Readonly<{
  analytics: AnalyticsPort;
  errors: ErrorReportingPort;
  metrics: MetricsRegistry;
  recentErrors: RecentErrors;
  pseudonymise: Pseudonymiser | null;
  now?: () => number;
}>;

export class TelemetryService {
  private readonly analytics: AnalyticsPort;

  private readonly errors: ErrorReportingPort;

  readonly metrics: MetricsRegistry;

  private readonly recentErrors: RecentErrors;

  private readonly pseudonymise: Pseudonymiser | null;

  private readonly clock: () => number;

  constructor(options: TelemetryOptions) {
    this.analytics = options.analytics;
    this.errors = options.errors;
    this.metrics = options.metrics;
    this.recentErrors = options.recentErrors;
    this.pseudonymise = options.pseudonymise;
    this.clock = options.now ?? ((): number => Date.now());
  }

  /** The pseudonym for an actor, or `null` when there is no key or no actor. */
  pseudonym(actor: TelemetryActor): string | null {
    if (actor === null || this.pseudonymise === null) {
      return null;
    }
    return this.pseudonymise(actor.actorType, actor.actorId);
  }

  capture(actor: TelemetryActor, event: AnalyticsEvent): void {
    if (event.name === "desktop-update-completed") {
      this.metrics.recordUpdateOutcome(event.outcome);
    }
    this.analytics.capture(this.pseudonym(actor), event);
  }

  /**
   * A failed request, counted for the exposition and remembered for the dashboard.
   * The code and the route pattern are bounded vocabularies; nothing about the
   * caller is recorded beyond the pseudonym the reporter already receives.
   */
  recordFailure(code: string, route: string): void {
    this.metrics.recordError(code, route);
    this.recentErrors.record(code, route, this.clock());
  }

  /** An error raised by this process. */
  reportServerError(
    error: Readonly<{ name: string; message: string; stack?: string }>,
    context: Readonly<{ route: string; actor: TelemetryActor; matchId?: string | undefined }>,
  ): void {
    this.errors.report(error, {
      actor: this.pseudonym(context.actor),
      route: context.route,
      origin: "server",
      matchId: context.matchId,
    });
  }

  /** A browser error, relayed so that no provider software ships to a client. */
  reportClientError(actor: TelemetryActor, request: TelemetryErrorRequest): void {
    this.errors.report(
      {
        name: request.name,
        message: request.message,
        ...(request.stack === undefined ? {} : { stack: request.stack }),
      },
      {
        actor: this.pseudonym(actor),
        route: request.route,
        origin: "browser",
        matchId: request.matchId,
      },
    );
    this.recordFailure("client_error", request.route);
  }

  /**
   * A step of a desktop release reporting how it ended. A failed signing step is an
   * error in the operational sense even though no request failed, so it is recorded
   * as one and reaches the dashboard's recent errors beside the metric
   * (docs/adr/0036-signing-is-a-workflow-step-that-fails-loudly.md).
   */
  recordReleaseBuildEvent(
    event: Readonly<{ step: string; target: string; outcome: string }>,
  ): void {
    if (event.outcome !== "failed") {
      return;
    }
    this.recordFailure(`release_${event.step}_failed`, `release:${event.target}`);
  }

  recentFailures(limit?: number): ReturnType<RecentErrors["list"]> {
    return this.recentErrors.list(limit);
  }

  async flush(): Promise<void> {
    await this.analytics.flush();
    await this.errors.flush();
  }
}

/**
 * A telemetry service that sends nothing anywhere. It is what a service built
 * without one uses, so a unit test needs no observability wiring and no code has to
 * ask whether telemetry is present.
 */
export function createSilentTelemetry(): TelemetryService {
  return new TelemetryService({
    analytics: new NullAnalytics(),
    errors: new NullErrorReporting(),
    metrics: new MetricsRegistry({ appVersion: "0.0.0", gitSha: "none", appEnv: "local" }),
    recentErrors: new RecentErrors(),
    pseudonymise: null,
  });
}
