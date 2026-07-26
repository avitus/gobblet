import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { AnalyticsEvent } from "@gobblet/protocol";
import {
  ANONYMOUS_DISTINCT_ID,
  NullAnalytics,
  PostHogAnalytics,
  createAnalytics,
} from "../src/observability/analytics";
import type { PostHogClient } from "../src/observability/analytics";
import { RecentErrors } from "../src/observability/error-log";
import {
  NullErrorReporting,
  SentryErrorReporting,
  createErrorReporting,
} from "../src/observability/error-reporting";
import type { SentryClient } from "../src/observability/error-reporting";
import { registerRequestObservability } from "../src/observability/http";
import { MetricsRegistry } from "../src/observability/metrics";
import { createPseudonymiser } from "../src/observability/pseudonym";
import { TelemetryService, createSilentTelemetry } from "../src/observability/telemetry";

/**
 * The telemetry stack of spec section 17 as units: the pseudonym, the exposition, the
 * bounded error ring and the two provider ports. No provider is contacted here; a
 * port receives a stand-in client, which is what the ports exist for
 * (docs/adr/0030-telemetry-behind-ports-relayed-through-the-server.md).
 */

const DEPLOYMENT = { appVersion: "1.2.3", gitSha: "abcdef", appEnv: "local" };

function captured(): {
  readonly client: PostHogClient;
  readonly events: { distinctId: string; event: string; properties?: Record<string, unknown> }[];
  readonly shutdowns: number[];
} {
  const events: { distinctId: string; event: string; properties?: Record<string, unknown> }[] = [];
  const shutdowns: number[] = [];
  return {
    events,
    shutdowns,
    client: {
      capture: (payload) => {
        events.push(payload);
      },
      shutdown: () => {
        shutdowns.push(1);
        return Promise.resolve();
      },
    },
  };
}

function sentryStub(): {
  readonly client: SentryClient;
  readonly events: Parameters<SentryClient["captureEvent"]>[0][];
  readonly flushes: (number | undefined)[];
} {
  const events: Parameters<SentryClient["captureEvent"]>[0][] = [];
  const flushes: (number | undefined)[] = [];
  return {
    events,
    flushes,
    client: {
      captureEvent: (event) => {
        events.push(event);
      },
      flush: (timeout) => {
        flushes.push(timeout);
        return Promise.resolve(true);
      },
    },
  };
}

describe("createPseudonymiser", () => {
  it("gives the same actor the same short pseudonym", () => {
    const pseudonymise = createPseudonymiser("a-telemetry-secret-value");
    expect(pseudonymise).not.toBeNull();

    const first = pseudonymise?.("user", "e6f1");
    expect(first).toMatch(/^[0-9a-f]{16}$/);
    expect(pseudonymise?.("user", "e6f1")).toBe(first);
  });

  it("separates actor types, so a guest and an account never collide", () => {
    const pseudonymise = createPseudonymiser("a-telemetry-secret-value");
    expect(pseudonymise?.("guest", "e6f1")).not.toBe(pseudonymise?.("user", "e6f1"));
  });

  it("changes every pseudonym when the key changes", () => {
    const first = createPseudonymiser("first-telemetry-secret");
    const second = createPseudonymiser("second-telemetry-secret");
    expect(first?.("user", "e6f1")).not.toBe(second?.("user", "e6f1"));
  });

  it("is absent without a key, because an unkeyed hash is not a pseudonym", () => {
    expect(createPseudonymiser(null)).toBeNull();
  });
});

describe("RecentErrors", () => {
  it("counts a repeated failure as one entry and keeps the latest time", () => {
    const errors = new RecentErrors();
    errors.record("validation_failed", "/v1/guests", 1_000);
    errors.record("validation_failed", "/v1/guests", 2_000);

    expect(errors.list()).toEqual([
      {
        code: "validation_failed",
        route: "/v1/guests",
        count: 2,
        lastSeenAt: new Date(2_000),
      },
    ]);
  });

  it("lists the most recent first", () => {
    const errors = new RecentErrors();
    errors.record("not_found", "/v1/matches/:matchId", 1_000);
    errors.record("rate_limited", "/v1/auth/sign-in", 2_000);

    expect(errors.list().map((entry) => entry.code)).toEqual(["rate_limited", "not_found"]);
  });

  it("moves a repeated failure back to the front", () => {
    const errors = new RecentErrors();
    errors.record("not_found", "/a", 1_000);
    errors.record("conflict", "/b", 2_000);
    errors.record("not_found", "/a", 3_000);

    expect(errors.list().map((entry) => entry.code)).toEqual(["not_found", "conflict"]);
  });

  it("forgets the oldest entry past its capacity", () => {
    const errors = new RecentErrors(2);
    errors.record("first", "/a", 1_000);
    errors.record("second", "/b", 2_000);
    errors.record("third", "/c", 3_000);

    expect(errors.list().map((entry) => entry.code)).toEqual(["third", "second"]);
  });

  it("returns no more than the limit asked for", () => {
    const errors = new RecentErrors();
    errors.record("first", "/a", 1_000);
    errors.record("second", "/b", 2_000);

    expect(errors.list(1).map((entry) => entry.code)).toEqual(["second"]);
  });
});

describe("MetricsRegistry", () => {
  it("exposes the deployment as labels on a constant gauge", async () => {
    const metrics = new MetricsRegistry(DEPLOYMENT);
    const exposition = await metrics.expose();

    expect(exposition).toContain(
      'gobblet_deployment_info{app_version="1.2.3",git_sha="abcdef",app_env="local"} 1',
    );
    expect(metrics.contentType).toContain("text/plain");
  });

  it("counts requests by method, route pattern and status", async () => {
    const metrics = new MetricsRegistry(DEPLOYMENT);
    metrics.recordHttpRequest("GET", "/v1/matches/:matchId", 200, 0.012);
    metrics.recordHttpRequest("GET", "/v1/matches/:matchId", 200, 0.02);

    const exposition = await metrics.expose();
    expect(exposition).toContain(
      'gobblet_http_requests_total{method="GET",route="/v1/matches/:matchId",status="200"} 2',
    );
    expect(exposition).toContain("gobblet_http_request_duration_seconds_bucket");
  });

  it("counts sockets, reconnections, timeouts and refusals", async () => {
    const metrics = new MetricsRegistry(DEPLOYMENT);
    metrics.recordSocketConnection();
    metrics.recordSocketReconnect();
    metrics.recordClockTimeout();
    metrics.recordCommandRejection("move", "illegal-move");
    metrics.recordClientSession("desktop", "0.4.0");

    const exposition = await metrics.expose();
    expect(exposition).toContain("gobblet_socket_connections_total 1");
    expect(exposition).toContain("gobblet_socket_reconnects_total 1");
    expect(exposition).toContain("gobblet_clock_timeouts_total 1");
    expect(exposition).toContain(
      'gobblet_command_rejections_total{command="move",reason="illegal-move"} 1',
    );
    expect(exposition).toContain(
      'gobblet_client_sessions_total{platform="desktop",version="0.4.0"} 1',
    );
  });

  it("records the latencies and the completed matches of section 17.3", async () => {
    const metrics = new MetricsRegistry(DEPLOYMENT);
    metrics.observeMoveLatency(0.008);
    metrics.observeDatabaseLatency("commit-move", 0.011);
    metrics.observeMatchmakingWait("ranked", 4);
    metrics.recordCompletedMatch("ranked", "line");

    const exposition = await metrics.expose();
    expect(exposition).toContain("gobblet_move_validation_duration_seconds_count 1");
    expect(exposition).toContain(
      'gobblet_database_transaction_duration_seconds_count{operation="commit-move"} 1',
    );
    expect(exposition).toContain('gobblet_matchmaking_wait_seconds_count{mode="ranked"} 1');
    expect(exposition).toContain('gobblet_matches_completed_total{mode="ranked",reason="line"} 1');
  });

  it("reads the gauges at scrape time from the sources it was given", async () => {
    const metrics = new MetricsRegistry(DEPLOYMENT);
    let matches = 1;
    metrics.observeSources({
      activeMatches: () => matches,
      connectedSockets: () => 3,
      queueDepths: () => [{ mode: "casual", timeControlSeconds: 300, depth: 2 }],
    });

    expect(await metrics.expose()).toContain("gobblet_active_matches 1");
    matches = 7;
    const second = await metrics.expose();
    expect(second).toContain("gobblet_active_matches 7");
    expect(second).toContain("gobblet_socket_connections 3");
    expect(second).toContain('gobblet_queue_depth{mode="casual",time_control_seconds="300"} 2');
  });

  it("reports empty gauges before any source is bound", async () => {
    const exposition = await new MetricsRegistry(DEPLOYMENT).expose();
    expect(exposition).toContain("gobblet_active_matches 0");
    expect(exposition).toContain("gobblet_socket_connections 0");
  });

  it("totals the error counter the dashboard reports", async () => {
    const metrics = new MetricsRegistry(DEPLOYMENT);
    expect(await metrics.errorTotal()).toBe(0);

    metrics.recordError("validation_failed", "/v1/guests");
    metrics.recordError("not_found", "/v1/matches/:matchId");
    metrics.recordError("not_found", "/v1/matches/:matchId");

    expect(await metrics.errorTotal()).toBe(3);
  });
});

describe("the analytics port", () => {
  it("sends nothing without a key", async () => {
    const analytics = createAnalytics({ apiKey: null, host: "https://eu.i.posthog.com" });
    expect(analytics).toBeInstanceOf(NullAnalytics);

    analytics.capture("pseudonym", { name: "guest-created" });
    await expect(analytics.flush()).resolves.toBeUndefined();
  });

  it("builds the provider transport once a key is configured", () => {
    const analytics = createAnalytics({ apiKey: "phc_test", host: "https://eu.i.posthog.com" });
    expect(analytics).toBeInstanceOf(PostHogAnalytics);
  });

  it("captures the event name with the rest of the event as properties", () => {
    const stub = captured();
    const event: AnalyticsEvent = {
      name: "match-found",
      mode: "ranked",
      timeControlSeconds: 300,
      waitMs: 1_500,
    };

    new PostHogAnalytics(stub.client).capture("6f1e9a2c4b8d0e37", event);

    expect(stub.events).toEqual([
      {
        distinctId: "6f1e9a2c4b8d0e37",
        event: "match-found",
        properties: { mode: "ranked", timeControlSeconds: 300, waitMs: 1_500 },
      },
    ]);
  });

  it("attributes an event with no identity to one anonymous id", () => {
    const stub = captured();
    new PostHogAnalytics(stub.client).capture(null, { name: "guest-created" });

    expect(stub.events[0]?.distinctId).toBe(ANONYMOUS_DISTINCT_ID);
  });

  it("shuts the client down when flushed", async () => {
    const stub = captured();
    await new PostHogAnalytics(stub.client).flush();

    expect(stub.shutdowns).toHaveLength(1);
  });
});

describe("the error reporting port", () => {
  it("reports nothing without a DSN", async () => {
    const errors = createErrorReporting({ dsn: null, release: "1.2.3", environment: "local" });
    expect(errors).toBeInstanceOf(NullErrorReporting);

    errors.report(
      { name: "Error", message: "ignored" },
      {
        actor: null,
        route: "/v1/guests",
        origin: "server",
      },
    );
    await expect(errors.flush()).resolves.toBeUndefined();
  });

  it("builds the provider transport once a DSN is configured", () => {
    const errors = createErrorReporting({
      dsn: "https://not-a-real-key@sentry.example.com/1",
      release: "1.2.3",
      environment: "local",
    });
    expect(errors).toBeInstanceOf(SentryErrorReporting);
  });

  it("sends the pseudonym as the user and the route as a tag", () => {
    const stub = sentryStub();
    new SentryErrorReporting(stub.client).report(
      { name: "TypeError", message: "cannot read board", stack: "at play" },
      {
        actor: "6f1e9a2c4b8d0e37",
        route: "/v1/matches/:matchId",
        origin: "browser",
        matchId: "cd0f2b4a-4b1a-4c6e-8bd8-9b1e3e0d6f24",
      },
    );

    expect(stub.events).toEqual([
      {
        level: "error",
        exception: { values: [{ type: "TypeError", value: "cannot read board" }] },
        tags: { route: "/v1/matches/:matchId", origin: "browser" },
        user: { id: "6f1e9a2c4b8d0e37" },
        extra: { stack: "at play", matchId: "cd0f2b4a-4b1a-4c6e-8bd8-9b1e3e0d6f24" },
      },
    ]);
  });

  it("omits the user and the extras it has nothing for", () => {
    const stub = sentryStub();
    new SentryErrorReporting(stub.client).report(
      { name: "Error", message: "the database is unreachable" },
      { actor: null, route: "/health/ready", origin: "server" },
    );

    expect(stub.events[0]).toEqual({
      level: "error",
      exception: { values: [{ type: "Error", value: "the database is unreachable" }] },
      tags: { route: "/health/ready", origin: "server" },
    });
  });

  it("flushes with a bounded timeout, so a shutdown cannot hang on it", async () => {
    const stub = sentryStub();
    await new SentryErrorReporting(stub.client).flush();

    expect(stub.flushes).toEqual([2_000]);
  });
});

describe("TelemetryService", () => {
  function build(): {
    readonly telemetry: TelemetryService;
    readonly analytics: ReturnType<typeof captured>;
    readonly errors: ReturnType<typeof sentryStub>;
    readonly metrics: MetricsRegistry;
  } {
    const analytics = captured();
    const errors = sentryStub();
    const metrics = new MetricsRegistry(DEPLOYMENT);
    return {
      analytics,
      errors,
      metrics,
      telemetry: new TelemetryService({
        analytics: new PostHogAnalytics(analytics.client),
        errors: new SentryErrorReporting(errors.client),
        metrics,
        recentErrors: new RecentErrors(),
        pseudonymise: createPseudonymiser("a-telemetry-secret-value"),
        now: () => 4_000,
      }),
    };
  }

  it("captures an event under the actor's pseudonym, never the actor's id", () => {
    const { telemetry, analytics } = build();
    telemetry.capture(
      { actorType: "user", actorId: "e6f1" },
      { name: "signed-in", method: "password" },
    );

    const [event] = analytics.events;
    expect(event?.distinctId).toMatch(/^[0-9a-f]{16}$/);
    expect(event?.distinctId).not.toContain("e6f1");
  });

  it("has no pseudonym for an anonymous caller", () => {
    const { telemetry } = build();
    expect(telemetry.pseudonym(null)).toBeNull();
  });

  it("has no pseudonym at all without a key", () => {
    const telemetry = createSilentTelemetry();
    expect(telemetry.pseudonym({ actorType: "user", actorId: "e6f1" })).toBeNull();
  });

  it("counts a failure for the exposition and remembers it for the dashboard", async () => {
    const { telemetry, metrics } = build();
    telemetry.recordFailure("not_found", "/v1/matches/:matchId");

    expect(await metrics.errorTotal()).toBe(1);
    expect(telemetry.recentFailures()).toEqual([
      {
        code: "not_found",
        route: "/v1/matches/:matchId",
        count: 1,
        lastSeenAt: new Date(4_000),
      },
    ]);
  });

  it("reports a server error with the route and the pseudonym", () => {
    const { telemetry, errors } = build();
    telemetry.reportServerError(
      { name: "Error", message: "the transaction failed" },
      { route: "/v1/admin/users", actor: { actorType: "user", actorId: "e6f1" } },
    );

    expect(errors.events[0]?.tags).toEqual({ route: "/v1/admin/users", origin: "server" });
    expect(errors.events[0]?.user?.id).toMatch(/^[0-9a-f]{16}$/);
  });

  it("relays a browser error and counts it as a client error", () => {
    const { telemetry, errors } = build();
    telemetry.reportClientError(null, {
      name: "TypeError",
      message: "cannot read board",
      stack: "at play",
      route: "/play",
    });

    expect(errors.events[0]?.tags).toEqual({ route: "/play", origin: "browser" });
    expect(telemetry.recentFailures()[0]?.code).toBe("client_error");
  });

  it("relays a browser error that carries no stack", () => {
    const { telemetry, errors } = build();
    telemetry.reportClientError(null, {
      name: "TypeError",
      message: "cannot read board",
      route: "/play",
    });

    expect(errors.events[0]?.extra).toBeUndefined();
  });

  it("flushes both providers", async () => {
    const { telemetry, analytics, errors } = build();
    await telemetry.flush();

    expect(analytics.shutdowns).toHaveLength(1);
    expect(errors.flushes).toEqual([2_000]);
  });

  it("sends nothing anywhere when it is the silent one", async () => {
    const telemetry = createSilentTelemetry();
    telemetry.capture(null, { name: "guest-created" });
    telemetry.reportServerError(
      { name: "Error", message: "ignored" },
      {
        route: "/v1/guests",
        actor: null,
      },
    );

    expect(telemetry.recentFailures()).toEqual([]);
    await expect(telemetry.flush()).resolves.toBeUndefined();
  });
});

describe("what every request contributes", () => {
  let served: FastifyInstance | undefined;

  afterEach(async () => {
    await served?.close();
    served = undefined;
  });

  /** A server with the hooks and two routes: one that answers, one that fails. */
  async function serve(): Promise<
    Readonly<{ app: FastifyInstance; telemetry: TelemetryService; lines: unknown[] }>
  > {
    const telemetry = new TelemetryService({
      analytics: new NullAnalytics(),
      errors: new NullErrorReporting(),
      metrics: new MetricsRegistry(DEPLOYMENT),
      recentErrors: new RecentErrors(),
      pseudonymise: null,
      now: () => 5_000,
    });
    const lines: unknown[] = [];
    const app = Fastify({
      disableRequestLogging: true,
      logger: {
        level: "info",
        stream: {
          write: (line: string) => {
            lines.push(JSON.parse(line));
          },
        },
      },
    });
    served = app;
    let clock = 1_000;
    registerRequestObservability(app, telemetry, () => {
      clock += 250;
      return clock;
    });
    app.get("/v1/fine", () => ({ ok: true }));
    app.get("/v1/broken", () => {
      throw new Error("the board could not be read");
    });
    app.get("/v1/stackless", () => {
      const error = new Error("no stack was kept");
      delete error.stack;
      throw error;
    });
    await app.ready();
    return { app, telemetry, lines };
  }

  it("times a request under the pattern of its route, not its path", async () => {
    const { app, telemetry } = await serve();
    const response = await app.inject({ method: "GET", url: "/v1/fine" });

    expect(response.statusCode).toBe(200);
    expect(await telemetry.metrics.expose()).toContain(
      'gobblet_http_request_duration_seconds_count{method="GET",route="/v1/fine",status="200"} 1',
    );
  });

  it("names a path that matched no route as unmatched", async () => {
    const { app, telemetry } = await serve();
    await app.inject({ method: "GET", url: "/v1/no-such-thing" });

    expect(await telemetry.metrics.expose()).toContain('route="unmatched",status="404"');
  });

  it("reports an unhandled failure once, and counts it as an error", async () => {
    const { app, telemetry, lines } = await serve();
    const response = await app.inject({ method: "GET", url: "/v1/broken" });

    expect(response.statusCode).toBe(500);
    expect(telemetry.recentFailures()).toEqual([
      { code: "internal_error", route: "/v1/broken", count: 1, lastSeenAt: new Date(5_000) },
    ]);
    expect(lines).toEqual([
      expect.objectContaining({ route: "/v1/broken", status: 500, result: "error" }),
    ]);
    expect(await telemetry.metrics.errorTotal()).toBe(1);
  });

  it("reports a failure that carries no stack", async () => {
    const { app, telemetry } = await serve();
    const response = await app.inject({ method: "GET", url: "/v1/stackless" });

    expect(response.statusCode).toBe(500);
    expect(telemetry.recentFailures()[0]?.route).toBe("/v1/stackless");
  });
});
