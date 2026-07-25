import { createDatabase, runMigrations } from "../../src/index";
import type { DatabaseHandle } from "../../src/index";
import { ensureTestDatabase, testDatabaseUrl, truncateAllTables } from "../../src/testing";

export const TEST_DATABASE_URL = testDatabaseUrl();

/**
 * Integration tests need a real PostgreSQL instance (spec section 20.5). The
 * failure message names the variable to set so a missing database is never
 * mistaken for a broken repository.
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
    applicationName: "gobblet-db-tests",
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

export type PostgresFailure = Readonly<{ code: string; constraint: string }>;

/** Drizzle wraps driver errors, so the constraint name lives on `error.cause`. */
export async function expectQueryToFail(action: () => Promise<unknown>): Promise<PostgresFailure> {
  try {
    await action();
  } catch (error) {
    const cause: unknown = error instanceof Error ? error.cause : undefined;
    if (cause !== null && typeof cause === "object" && "code" in cause) {
      const details = cause as { code?: string; constraint?: string };
      return { code: details.code ?? "", constraint: details.constraint ?? "" };
    }
    throw error;
  }
  throw new Error("expected the query to fail");
}
