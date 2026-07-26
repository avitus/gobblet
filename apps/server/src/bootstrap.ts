import type { ServerConfig } from "@gobblet/config";
import { checkDatabaseConnection, createDatabase } from "@gobblet/db";
import type { DatabaseHandle } from "@gobblet/db";
import type { FastifyInstance } from "fastify";
import { AdminService } from "./admin/service";
import { buildApp } from "./app";
import { GuestService } from "./guests/service";
import { createAnalytics } from "./observability/analytics";
import { RecentErrors } from "./observability/error-log";
import { createErrorReporting } from "./observability/error-reporting";
import { MetricsRegistry } from "./observability/metrics";
import { createPseudonymiser } from "./observability/pseudonym";
import { TelemetryService } from "./observability/telemetry";
import { IdentityService } from "./identity/service";
import { LeaderboardService } from "./leaderboard/service";
import { RematchService } from "./matchmaking/rematch";
import { MatchmakingService } from "./matchmaking/service";
import { MatchRuntime } from "./match/runtime";
import { ReleaseService } from "./releases/service";
import { MatchGateway } from "./socket/gateway";

export type BootstrapOptions = Readonly<{
  config: ServerConfig;
  /** Injected by tests so waiting, expiry and clocks can be driven without sleeping. */
  now?: () => number;
}>;

export type BootstrappedServer = Readonly<{
  app: FastifyInstance;
  database: DatabaseHandle;
  runtime: MatchRuntime;
  guests: GuestService;
  identity: IdentityService;
  leaderboards: LeaderboardService;
  matchmaking: MatchmakingService;
  rematch: RematchService;
  gateway: MatchGateway;
  admin: AdminService;
  releases: ReleaseService;
  telemetry: TelemetryService;
  /** Matches whose clock expired while this process was down (spec section 7.5). */
  settledOnBoot: number;
  close: () => Promise<void>;
}>;

/** Phase 2 persists every match, so a server without a database is misconfigured. */
export function requireDatabaseUrl(config: ServerConfig): string {
  if (config.databaseUrl === null) {
    throw new Error("DATABASE_URL is required: the match runtime cannot run without a database");
  }
  return config.databaseUrl;
}

export async function bootstrapServer(options: BootstrapOptions): Promise<BootstrappedServer> {
  const { config } = options;
  const database = createDatabase({
    connectionString: requireDatabaseUrl(config),
    poolMax: config.databasePoolMax,
    applicationName: "gobblet-server",
  });

  const now = options.now ?? ((): number => Date.now());
  const telemetry = new TelemetryService({
    analytics: createAnalytics({ apiKey: config.posthogApiKey, host: config.posthogHost }),
    errors: createErrorReporting({
      dsn: config.sentryDsn,
      release: config.appVersion,
      environment: config.appEnv,
    }),
    metrics: new MetricsRegistry(
      {
        appVersion: config.appVersion,
        gitSha: config.gitSha,
        appEnv: config.appEnv,
      },
      now() / 1000,
    ),
    recentErrors: new RecentErrors(),
    pseudonymise: createPseudonymiser(config.telemetryPseudonymSecret),
    now,
  });

  const runtime = new MatchRuntime({ db: database.db, now, telemetry });
  const guests = new GuestService({ db: database.db, config, now, telemetry });
  const identity = new IdentityService({ db: database.db, config, now, telemetry });
  const leaderboards = new LeaderboardService({ db: database.db, now });
  const matchmaking = new MatchmakingService({ runtime, identity, now });
  const rematch = new RematchService({ runtime, identity, now });

  const readiness = [{ name: "database", check: () => checkDatabaseConnection(database.db) }];
  const admin = new AdminService({
    db: database.db,
    config,
    queue: matchmaking,
    telemetry,
    readiness: async () =>
      Promise.all(readiness.map(async (probe) => ({ name: probe.name, ok: await probe.check() }))),
    connectedSockets: () => gateway.connectionCount(),
    startedAt: now(),
    now,
  });

  const releases = new ReleaseService({ db: database.db, telemetry, now });

  const app = await buildApp({
    config,
    services: { runtime, guests, identity, leaderboards, admin, releases, db: database.db },
    readiness,
    telemetry,
    now,
  });

  const settled = await runtime.recoverUnfinishedMatches();
  if (settled.length > 0) {
    app.log.info({ settled: settled.length }, "settled matches whose clock expired while offline");
  }

  // Fastify must be listening before Socket.IO can share its HTTP server.
  await app.ready();
  const gateway = new MatchGateway({
    httpServer: app.server,
    config,
    runtime,
    resolvers: { identity, guests },
    matchmaking,
    rematch,
    log: app.log,
    telemetry,
    now,
  });

  telemetry.metrics.observeSources({
    activeMatches: () => gateway.activeMatchCount(),
    connectedSockets: () => gateway.connectionCount(),
    queueDepths: () => matchmaking.depths(),
    pool: () => ({
      total: database.pool.totalCount,
      idle: database.pool.idleCount,
      waiting: database.pool.waitingCount,
    }),
    ready: async () =>
      (await Promise.all(readiness.map((probe) => probe.check()))).every((ok) => ok),
  });

  return {
    app,
    database,
    runtime,
    guests,
    identity,
    leaderboards,
    matchmaking,
    rematch,
    gateway,
    admin,
    releases,
    telemetry,
    settledOnBoot: settled.length,
    close: async (): Promise<void> => {
      // Draining stops accepting queue entries before anything else, so nobody is
      // paired into a match this process is about to stop serving (spec section 7.6).
      gateway.drain();
      await gateway.close();
      await app.close();
      // Whatever telemetry was buffered is sent before the process exits, so a
      // deployment does not lose the events that describe it.
      await telemetry.flush();
      await database.close();
    },
  };
}
