import { loadServerConfig } from "@gobblet/config";
import type { DatabaseHandle } from "@gobblet/db";
import {
  createGuestResponseSchema,
  httpErrorBodySchema,
  telemetryAcceptedResponseSchema,
} from "@gobblet/protocol";
import type { AnalyticsEvent } from "@gobblet/protocol";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { GuestService } from "../src/guests/service";
import { IdentityService } from "../src/identity/service";
import { LeaderboardService } from "../src/leaderboard/service";
import { MatchRuntime } from "../src/match/runtime";
import { RecentErrors } from "../src/observability/error-log";
import { MetricsRegistry } from "../src/observability/metrics";
import { createPseudonymiser } from "../src/observability/pseudonym";
import { TelemetryService } from "../src/observability/telemetry";
import type { AnalyticsIdentity, AnalyticsPort } from "../src/observability/analytics";
import type { ErrorContext, ErrorReportingPort } from "../src/observability/error-reporting";
import { adminServiceFixture } from "./helpers/admin-service";
import { TestClock } from "./helpers/match-fixtures";
import { setupTestDatabase, truncateAll } from "./helpers/test-database";

/**
 * The client telemetry intake of appendix P7.11: a browser reports what only it
 * knows, the server is the only thing that talks to a provider, and nothing a client
 * sends can name an account
 * (docs/adr/0030-telemetry-behind-ports-relayed-through-the-server.md).
 */

const config = loadServerConfig({
  APP_ENV: "local",
  LOG_LEVEL: "fatal",
  TELEMETRY_ATTEMPT_LIMIT: "3",
  TELEMETRY_PSEUDONYM_SECRET: "a-telemetry-secret-value",
});

type Captured = Readonly<{ identity: AnalyticsIdentity; event: AnalyticsEvent }>;
type Reported = Readonly<{
  error: Readonly<{ name: string; message: string; stack?: string }>;
  context: ErrorContext;
}>;

let handle: DatabaseHandle;
let clock: TestClock;
let app: FastifyInstance;
let telemetry: TelemetryService;
let captured: Captured[];
let reported: Reported[];

class RecordingAnalytics implements AnalyticsPort {
  capture(identity: AnalyticsIdentity, event: AnalyticsEvent): void {
    captured.push({ identity, event });
  }

  async flush(): Promise<void> {
    // Nothing is buffered, because the recorder keeps everything in memory.
  }
}

class RecordingErrors implements ErrorReportingPort {
  report(
    error: Readonly<{ name: string; message: string; stack?: string }>,
    context: ErrorContext,
  ): void {
    reported.push({ error, context });
  }

  async flush(): Promise<void> {
    // Nothing is buffered here either.
  }
}

beforeAll(async () => {
  handle = await setupTestDatabase();
});

afterAll(async () => {
  await handle.close();
});

beforeEach(async () => {
  await truncateAll(handle);
  clock = new TestClock();
  captured = [];
  reported = [];
  telemetry = new TelemetryService({
    analytics: new RecordingAnalytics(),
    errors: new RecordingErrors(),
    metrics: new MetricsRegistry({ appVersion: "7.0.0", gitSha: "phase7", appEnv: "local" }),
    recentErrors: new RecentErrors(),
    pseudonymise: createPseudonymiser(config.telemetryPseudonymSecret),
    now: clock.now,
  });
  const runtime = new MatchRuntime({ db: handle.db, now: clock.now, telemetry });
  const identity = new IdentityService({ db: handle.db, config, now: clock.now, telemetry });
  app = await buildApp({
    config,
    services: {
      runtime,
      guests: new GuestService({ db: handle.db, config, now: clock.now, telemetry }),
      identity,
      leaderboards: new LeaderboardService({ db: handle.db, now: clock.now }),
      admin: adminServiceFixture({ db: handle.db, config, runtime, identity, now: clock.now }),
      db: handle.db,
    },
    telemetry,
    now: clock.now,
  });
});

afterEach(async () => {
  await app.close();
});

async function guestToken(): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/v1/guests", payload: {} });
  return createGuestResponseSchema.parse(response.json()).sessionToken;
}

function events(...batch: readonly unknown[]): Record<string, unknown> {
  return { events: batch };
}

describe("POST /v1/telemetry/events", () => {
  it("accepts a launch from a caller who has no identity yet", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/telemetry/events",
      payload: events({ name: "app-launched", platform: "web", clientVersion: "0.4.0" }),
    });

    expect(response.statusCode).toBe(200);
    expect(telemetryAcceptedResponseSchema.parse(response.json())).toEqual({ accepted: 1 });
    expect(captured).toEqual([
      {
        identity: null,
        event: { name: "app-launched", platform: "web", clientVersion: "0.4.0" },
      },
    ]);
  });

  it("attributes a batch to the caller's pseudonym, never to the actor's id", async () => {
    const token = await guestToken();
    captured = [];

    const response = await app.inject({
      method: "POST",
      url: "/v1/telemetry/events",
      headers: { authorization: `Bearer ${token}` },
      payload: events(
        { name: "render-tier-selected", tier: "reduced", source: "detected" },
        { name: "setting-changed", setting: "sound-muted", enabled: true },
      ),
    });

    expect(telemetryAcceptedResponseSchema.parse(response.json())).toEqual({ accepted: 2 });
    expect(captured).toHaveLength(2);
    expect(captured[0]?.identity).toMatch(/^[0-9a-f]{16}$/);
    expect(captured[0]?.identity).toBe(captured[1]?.identity);
  });

  it("refuses an event only the server may report", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/telemetry/events",
      payload: events({ name: "match-started", mode: "casual", timeControlSeconds: 300 }),
    });

    expect(response.statusCode).toBe(400);
    expect(httpErrorBodySchema.parse(response.json()).error.code).toBe("validation_failed");
    expect(captured).toEqual([]);
  });

  it("refuses free-form properties on an event it does know", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/telemetry/events",
      payload: events({
        name: "app-launched",
        platform: "web",
        clientVersion: "0.4.0",
        email: "ada@example.com",
      }),
    });

    expect(response.statusCode).toBe(400);
    expect(captured).toEqual([]);
  });

  it("refuses an empty batch and a batch that is too long", async () => {
    const empty = await app.inject({
      method: "POST",
      url: "/v1/telemetry/events",
      payload: events(),
    });
    const flood = await app.inject({
      method: "POST",
      url: "/v1/telemetry/events",
      payload: {
        events: Array.from({ length: 21 }, () => ({
          name: "app-launched",
          platform: "web",
          clientVersion: "0.4.0",
        })),
      },
    });

    expect(empty.statusCode).toBe(400);
    expect(flood.statusCode).toBe(400);
    expect(captured).toEqual([]);
  });

  it("refuses a body it cannot read at all, on either route", async () => {
    const events = await app.inject({ method: "POST", url: "/v1/telemetry/events" });
    const errors = await app.inject({ method: "POST", url: "/v1/telemetry/errors" });

    expect(events.statusCode).toBe(400);
    expect(errors.statusCode).toBe(400);
  });

  it("throttles a flood from one address", async () => {
    const payload = events({ name: "app-launched", platform: "web", clientVersion: "0.4.0" });
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/telemetry/events",
        payload,
      });
      statuses.push(response.statusCode);
      if (response.statusCode === 429) {
        expect(response.headers["retry-after"]).toBeDefined();
        expect(httpErrorBodySchema.parse(response.json()).error.code).toBe("rate_limited");
      }
    }

    expect(statuses).toEqual([200, 200, 200, 429]);
    expect(captured).toHaveLength(3);
  });
});

describe("POST /v1/telemetry/errors", () => {
  it("relays a browser error with its route and counts it", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/telemetry/errors",
      payload: {
        name: "TypeError",
        message: "cannot read the board",
        stack: "at play (main.js:1:1)",
        route: "/play",
      },
    });

    expect(telemetryAcceptedResponseSchema.parse(response.json())).toEqual({ accepted: 1 });
    expect(reported[0]?.context).toMatchObject({ origin: "browser", route: "/play", actor: null });
    expect(telemetry.recentFailures()[0]).toMatchObject({ code: "client_error", route: "/play" });
  });

  it("carries the pseudonym of a signed-in reporter", async () => {
    const token = await guestToken();
    await app.inject({
      method: "POST",
      url: "/v1/telemetry/errors",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Error", message: "the socket closed", route: "/play" },
    });

    expect(reported[0]?.context.actor).toMatch(/^[0-9a-f]{16}$/);
  });

  it("refuses a report longer than the bounds allow", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/telemetry/errors",
      payload: {
        name: "Error",
        message: "x".repeat(1_001),
        route: "/play",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(reported).toEqual([]);
  });

  it("refuses a report with no route", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/telemetry/errors",
      payload: { name: "Error", message: "something happened" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("throttles a flood of reports from one address", async () => {
    const payload = { name: "Error", message: "again and again", route: "/play" };
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await app.inject({ method: "POST", url: "/v1/telemetry/errors", payload });
      statuses.push(response.statusCode);
    }

    expect(statuses).toEqual([200, 200, 200, 429]);
    expect(reported).toHaveLength(3);
  });
});

describe("what the server itself reports", () => {
  it("records the failure of any refused request for the dashboard", async () => {
    await app.inject({ method: "GET", url: "/v1/does-not-exist" });

    expect(telemetry.recentFailures()).toEqual([
      { code: "not_found", route: "unmatched", count: 1, lastSeenAt: new Date(clock.now()) },
    ]);
  });

  it("counts every request in the exposition under its route pattern", async () => {
    await app.inject({ method: "GET", url: "/health/live" });

    expect(await telemetry.metrics.expose()).toContain(
      'gobblet_http_requests_total{method="GET",route="/health/live",status="200"} 1',
    );
  });

  it("reports a guest and a sign-up as the analytics events of section 17.1", async () => {
    await guestToken();
    await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {
        email: "ada@example.com",
        username: "ada",
        password: "correct horse battery staple 7",
      },
    });

    expect(captured.map((entry) => entry.event.name)).toEqual([
      "guest-created",
      "sign-up-completed",
    ]);
    expect(captured[1]?.event).toEqual({ name: "sign-up-completed", fromGuest: false });
  });

  it("reports a claimed guest as a sign-up that came from one", async () => {
    const token = await guestToken();
    captured = [];

    await app.inject({
      method: "POST",
      url: "/v1/guests/claim",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        email: "grace@example.com",
        username: "grace",
        password: "correct horse battery staple 7",
      },
    });

    expect(captured.map((entry) => entry.event)).toEqual([
      { name: "sign-up-completed", fromGuest: true },
    ]);
  });

  it("reports a sign-in with the method that was used", async () => {
    await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {
        email: "ada@example.com",
        username: "ada",
        password: "correct horse battery staple 7",
      },
    });
    captured = [];

    await app.inject({
      method: "POST",
      url: "/v1/auth/sign-in",
      payload: { email: "ada@example.com", password: "correct horse battery staple 7" },
    });

    expect(captured.map((entry) => entry.event)).toEqual([
      { name: "signed-in", method: "password" },
    ]);
  });
});
