import { loadServerConfig } from "@gobblet/config";
import { createDatabase, runMigrations } from "@gobblet/db";
import { ensureTestDatabase, testDatabaseUrl } from "@gobblet/db/testing";
import { bootstrapServer } from "../bootstrap";
import type { BootstrappedServer } from "../bootstrap";

/**
 * Where `pnpm load` points. A host is named on the command line; without one the
 * harness starts a server of its own against a database of its own, because the
 * release gate has to be runnable by anyone with a checkout and PostgreSQL, not only
 * by whoever has a deployment (docs/adr/0037-the-load-harness-is-ours.md).
 */

export type LoadTarget = Readonly<{
  baseUrl: string;
  /** What the report should say the run was against. */
  description: string;
  stop: () => Promise<void>;
}>;

export type LoadTargetOptions = Readonly<{
  /** A host, when one was named. */
  baseUrl?: string | undefined;
  appVersion: string;
  gitSha: string;
}>;

/**
 * The port a listening server took. Exported because the case it refuses, a Unix
 * socket or a server that never bound, cannot be produced by listening on
 * 127.0.0.1 port 0, and a run that cannot say where it points must stop.
 */
export function tcpPort(address: string | { port: number } | null): number {
  if (address === null || typeof address === "string") {
    throw new Error("the load server did not take a TCP port");
  }
  return address.port;
}

export async function openLoadTarget(options: LoadTargetOptions): Promise<LoadTarget> {
  if (options.baseUrl !== undefined && options.baseUrl !== "") {
    return {
      baseUrl: options.baseUrl,
      description: options.baseUrl,
      stop: () => Promise.resolve(),
    };
  }

  const databaseUrl = testDatabaseUrl("load");
  await ensureTestDatabase(databaseUrl);
  const handle = createDatabase({
    connectionString: databaseUrl,
    poolMax: 4,
    applicationName: "gobblet-load-migrations",
  });
  try {
    await runMigrations(handle.db);
  } finally {
    await handle.close();
  }

  const server: BootstrappedServer = await bootstrapServer({
    config: loadServerConfig({
      APP_ENV: "local",
      APP_VERSION: options.appVersion,
      GIT_SHA: options.gitSha,
      LOG_LEVEL: "fatal",
      DATABASE_URL: databaseUrl,
      DATABASE_POOL_MAX: "20",
    }),
  });
  await server.app.listen({ host: "127.0.0.1", port: 0 });
  // Not caught to close the server first: nothing can be run against a server whose
  // address is unusable, and the process that owns it is about to end anyway.
  const port = tcpPort(server.app.server.address());

  return {
    baseUrl: `http://127.0.0.1:${String(port)}`,
    description: `a server this run started, on ${databaseUrl}`,
    stop: () => server.close(),
  };
}
