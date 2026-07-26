import { createDatabase, runMigrations } from "@gobblet/db";
import { ensureTestDatabase, truncateAllTables } from "@gobblet/db/testing";
import { DATABASE_URL } from "./environment";

/**
 * Creates, migrates and empties the browser suite's database before the server
 * starts. It runs as part of the server command rather than as a Playwright global
 * setup step, so the ordering is a shell fact and not a runner detail.
 */
async function main(): Promise<void> {
  await ensureTestDatabase(DATABASE_URL);

  const handle = createDatabase({
    connectionString: DATABASE_URL,
    poolMax: 2,
    applicationName: "gobblet-e2e-setup",
  });

  try {
    await runMigrations(handle.db);
    await truncateAllTables(handle.db);
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  console.error(
    `Cannot prepare ${DATABASE_URL}. Start PostgreSQL or set TEST_DATABASE_URL. Cause: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exitCode = 1;
});
