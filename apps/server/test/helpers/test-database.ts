import { createDatabase, runMigrations } from "@gobblet/db";
import type { DatabaseHandle } from "@gobblet/db";
import { ensureTestDatabase, testDatabaseUrl, truncateAllTables } from "@gobblet/db/testing";

/** A database of its own, because turbo runs the db and server suites in parallel. */
export const TEST_DATABASE_URL = testDatabaseUrl("server");

/**
 * The match runtime is only meaningful against a real PostgreSQL, because row
 * locking and the unique command index are what make it correct
 * (spec section 20.5).
 */
export async function setupTestDatabase(): Promise<DatabaseHandle> {
  try {
    await ensureTestDatabase(TEST_DATABASE_URL);
  } catch (error) {
    throw new Error(unreachableMessage(error));
  }

  const handle = createDatabase({
    connectionString: TEST_DATABASE_URL,
    poolMax: 4,
    applicationName: "gobblet-server-tests",
  });

  try {
    await runMigrations(handle.db);
  } catch (error) {
    await handle.close();
    throw new Error(unreachableMessage(error));
  }

  return handle;
}

function unreachableMessage(error: unknown): string {
  return `Cannot reach the test database at ${TEST_DATABASE_URL}. Start PostgreSQL or set TEST_DATABASE_URL. Cause: ${
    error instanceof Error ? error.message : String(error)
  }`;
}

export async function truncateAll(handle: DatabaseHandle): Promise<void> {
  await truncateAllTables(handle.db);
}
