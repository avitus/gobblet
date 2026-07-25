import { loadServerConfig } from "@gobblet/config";
import { bootstrapServer } from "./bootstrap";

const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM"] as const;

async function main(): Promise<void> {
  const config = loadServerConfig();
  const server = await bootstrapServer({ config });

  for (const signal of SHUTDOWN_SIGNALS) {
    process.once(signal, () => {
      server.app.log.info({ signal }, "shutting down");
      server.close().then(
        () => {
          process.exit(0);
        },
        (error: unknown) => {
          server.app.log.error({ error }, "shutdown failed");
          process.exit(1);
        },
      );
    });
  }

  await server.app.listen({ host: config.host, port: config.port });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
