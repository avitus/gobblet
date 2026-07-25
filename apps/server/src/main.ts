import { loadServerConfig } from "@gobblet/config";
import { buildApp } from "./app";

const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM"] as const;

async function main(): Promise<void> {
  const config = loadServerConfig();
  const app = await buildApp({ config });

  for (const signal of SHUTDOWN_SIGNALS) {
    process.once(signal, () => {
      app.log.info({ signal }, "shutting down");
      app.close().then(
        () => {
          process.exit(0);
        },
        (error: unknown) => {
          app.log.error({ error }, "shutdown failed");
          process.exit(1);
        },
      );
    });
  }

  await app.listen({ host: config.host, port: config.port });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
