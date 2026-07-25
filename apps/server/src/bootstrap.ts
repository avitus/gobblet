import type { ServerConfig } from "@gobblet/config";
import { checkDatabaseConnection, createDatabase } from "@gobblet/db";
import type { DatabaseHandle } from "@gobblet/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app";
import { GuestService } from "./guests/service";
import { MatchRuntime } from "./match/runtime";

export type BootstrapOptions = Readonly<{
  config: ServerConfig;
}>;

export type BootstrappedServer = Readonly<{
  app: FastifyInstance;
  database: DatabaseHandle;
  runtime: MatchRuntime;
  guests: GuestService;
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

  return {
    app,
    database,
    runtime,
    guests,
    settledOnBoot: settled.length,
    close: async (): Promise<void> => {
      await app.close();
      await database.close();
    },
  };
}
