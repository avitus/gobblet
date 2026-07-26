import cors from "@fastify/cors";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import type { ServerConfig } from "@gobblet/config";
import type { Database } from "@gobblet/db";
import { MATCH_MODES } from "@gobblet/protocol";
import type { PublicServerConfig } from "@gobblet/protocol";
import type { AdminService } from "./admin/service";
import type { GuestService } from "./guests/service";
import { sendError } from "./http/errors";
import { AttemptLimiter } from "./identity/rate-limit";
import type { IdentityService } from "./identity/service";
import type { LeaderboardService } from "./leaderboard/service";
import type { MatchRuntime } from "./match/runtime";
import type { ReleaseService } from "./releases/service";
import { registerRequestObservability } from "./observability/http";
import type { TelemetryService } from "./observability/telemetry";
import { registerAdminRoutes } from "./routes/admin";
import { registerAuthRoutes } from "./routes/auth";
import { registerDevMatchRoutes } from "./routes/dev-matches";
import { registerGuestRoutes } from "./routes/guests";
import { registerLeaderboardRoutes } from "./routes/leaderboards";
import { registerMatchRoutes } from "./routes/matches";
import { registerMeRoutes } from "./routes/me";
import { registerMetricsRoute } from "./routes/metrics";
import { registerProfileRoutes } from "./routes/profiles";
import { registerReleaseRoutes } from "./routes/releases";
import { registerTelemetryRoutes } from "./routes/telemetry";
import { registerUsernameRoutes } from "./routes/usernames";
import { TIME_CONTROLS_SECONDS } from "./time-controls";

/**
 * A dependency probe reported by `GET /health/ready`. Phase 2 registers the
 * database probe here; readiness stays independent of liveness so a failing
 * dependency takes an instance out of the load balancer without restarting it.
 */
export type ReadinessProbe = Readonly<{
  name: string;
  check: () => Promise<boolean> | boolean;
}>;

/**
 * The stateful services. They are optional so the health and config endpoints
 * stay testable without a database, and so a process with no database still
 * reports its own liveness.
 */
export type AppServices = Readonly<{
  runtime: MatchRuntime;
  guests: GuestService;
  identity: IdentityService;
  leaderboards: LeaderboardService;
  admin: AdminService;
  releases: ReleaseService;
  db: Database;
}>;

export type BuildAppOptions = Readonly<{
  config: ServerConfig;
  readiness?: readonly ReadinessProbe[];
  services?: AppServices;
  /**
   * Where requests, failures and analytics go. It is required so that no process can
   * run without one, and inert without provider keys
   * (docs/adr/0030-telemetry-behind-ports-relayed-through-the-server.md).
   */
  telemetry: TelemetryService;
  now?: () => number;
}>;

const REQUEST_BODY_LIMIT_BYTES = 64 * 1024;

/**
 * The window the credential throttle
 * [ADR-0017](../../../docs/adr/0017-first-party-email-password-authentication.md)
 * accepts as the mitigation for owning password verification counts attempts in.
 * How many are allowed in it is configuration, because one address is one player
 * in a deployment and every player in a browser suite.
 */
const CREDENTIAL_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

/** A minute is long enough for a page to report a launch and short enough to bound a flood. */
const TELEMETRY_ATTEMPT_WINDOW_MS = 60 * 1000;

export async function buildApp({
  config,
  readiness = [],
  services,
  telemetry,
  now = Date.now,
}: BuildAppOptions): Promise<FastifyInstance> {
  const startedAt = now();

  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: ["req.headers.authorization", "req.headers.cookie"],
      base: { appVersion: config.appVersion, gitSha: config.gitSha, appEnv: config.appEnv },
    },
    bodyLimit: REQUEST_BODY_LIMIT_BYTES,
    trustProxy: true,
  });

  await app.register(cors, { origin: [...config.corsOrigins], credentials: true });

  registerRequestObservability(app, telemetry, now);

  app.setNotFoundHandler((request, reply) => {
    void sendError(request, reply, "not_found", "Unknown endpoint");
  });

  app.get("/health/live", () => ({
    status: "live" as const,
    appVersion: config.appVersion,
    gitSha: config.gitSha,
    uptimeSeconds: Math.max(0, Math.round((now() - startedAt) / 1000)),
  }));

  app.get("/health/ready", async (_request, reply) => {
    const checks = await Promise.all(
      readiness.map(async (probe) => {
        try {
          return { name: probe.name, ok: await probe.check() };
        } catch {
          return { name: probe.name, ok: false };
        }
      }),
    );

    const ready = checks.every((check) => check.ok);
    return reply.status(ready ? 200 : 503).send({
      status: ready ? ("ready" as const) : ("unavailable" as const),
      checks,
    });
  });

  app.get("/v1/config", (): PublicServerConfig => ({
    appEnv: config.appEnv,
    appVersion: config.appVersion,
    minSupportedClientVersion: config.minSupportedClientVersion,
    modes: [...MATCH_MODES],
    timeControlsSeconds: [...TIME_CONTROLS_SECONDS],
  }));

  if (config.metricsEnabled) {
    registerMetricsRoute(app, telemetry.metrics, config.metricsToken);
  }

  if (services) {
    const resolvers = { identity: services.identity, guests: services.guests };
    const limiter = new AttemptLimiter({
      limit: config.credentialAttemptLimit,
      windowMs: CREDENTIAL_ATTEMPT_WINDOW_MS,
      now,
    });
    const telemetryLimiter = new AttemptLimiter({
      limit: config.telemetryAttemptLimit,
      windowMs: TELEMETRY_ATTEMPT_WINDOW_MS,
      now,
    });

    registerAuthRoutes(app, { identity: services.identity, resolvers, limiter });
    registerGuestRoutes(app, {
      guests: services.guests,
      identity: services.identity,
      resolvers,
    });
    registerUsernameRoutes(app, services.identity);
    registerProfileRoutes(app, services.identity);
    registerLeaderboardRoutes(app, services.leaderboards, resolvers);
    registerMeRoutes(app, services.identity, resolvers, services.runtime);
    registerMatchRoutes(app, services.runtime, resolvers);
    registerDevMatchRoutes(app, services.runtime, resolvers, config);
    registerTelemetryRoutes(app, telemetry, resolvers, telemetryLimiter);
    registerAdminRoutes(app, services.admin, { db: services.db, resolvers });
    registerReleaseRoutes(app, services.releases, { db: services.db, resolvers });
  }

  return app;
}
