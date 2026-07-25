import type { ServerConfig } from "@gobblet/config";
import { checkDatabaseConnection, createDatabase } from "@gobblet/db";
import type { DatabaseHandle } from "@gobblet/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app";
import { GuestService } from "./guests/service";
import { IdentityService } from "./identity/service";
import { MatchmakingService } from "./matchmaking/service";
import { MatchRuntime } from "./match/runtime";
import { MatchGateway } from "./socket/gateway";

export type BootstrapOptions = Readonly<{
  config: ServerConfig;
}>;

export type BootstrappedServer = Readonly<{
  app: FastifyInstance;
  database: DatabaseHandle;
  runtime: MatchRuntime;
  guests: GuestService;
  identity: IdentityService;
  matchmaking: MatchmakingService;
  gateway: MatchGateway;
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

  const runtime = new MatchRuntime({ db: database.db });
  const guests = new GuestService({ db: database.db, config });
  const identity = new IdentityService({ db: database.db, config });
  const matchmaking = new MatchmakingService({ runtime, identity });

  const app = await buildApp({
    config,
    services: { runtime, guests, identity },
    readiness: [{ name: "database", check: () => checkDatabaseConnection(database.db) }],
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
    log: app.log,
  });

  return {
    app,
    database,
    runtime,
    guests,
    identity,
    matchmaking,
    gateway,
    settledOnBoot: settled.length,
    close: async (): Promise<void> => {
      // Draining stops accepting queue entries before anything else, so nobody is
      // paired into a match this process is about to stop serving (spec section 7.6).
      matchmaking.stopAcceptingEntries();
      await gateway.close();
      await app.close();
      await database.close();
    },
  };
}
