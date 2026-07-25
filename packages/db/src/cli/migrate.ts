import { loadServerConfig } from "@gobblet/config";
import { createDatabase } from "../client";
import { runMigrations } from "../migrate";

const config = loadServerConfig();
if (!config.databaseUrl) {
  console.error("DATABASE_URL is required to run migrations.");
  process.exit(1);
}

const handle = createDatabase({
  connectionString: config.databaseUrl,
  poolMax: 1,
  applicationName: "gobblet-migrate",
});

try {
  await runMigrations(handle.db);
  console.warn("migrations applied");
} finally {
  await handle.close();
}
