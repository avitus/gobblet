import type { ServerConfig } from "@gobblet/config";
import { checkDatabaseConnection, createDatabase } from "@gobblet/db";
import type { DatabaseHandle } from "@gobblet/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app";
import { GuestService } from "./guests/service";
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
  const guests = new GuestService({ db: database.db });

  const app = await buildApp({
    config,
    services: { runtime, guests },
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
    guests,
    log: app.log,
  });

  return {
    app,
    database,
    runtime,
    guests,
    gateway,
    settledOnBoot: settled.length,
    close: async (): Promise<void> => {
      await gateway.close();
      await app.close();
      await database.close();
    },
  };
}
