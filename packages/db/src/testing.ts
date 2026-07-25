import { sql } from "drizzle-orm";
import { Client } from "pg";
import type { DatabaseExecutor } from "./executor";

/**
 * Test-only helpers. They live behind the `./testing` entry point so raw SQL
 * stays inside the package that owns the schema and consumers never need a
 * direct Drizzle dependency (docs/architecture.md section 6).
 */

export const DEFAULT_TEST_DATABASE_URL = "postgresql://gobblet@localhost:5432/gobblet_test";

const SAFE_DATABASE_NAME = /^[A-Za-z0-9_]+$/;

/**
 * Turbo runs package tasks in parallel, so two suites must never share one
 * database: each caller passes a suffix and gets its own. One
 * `TEST_DATABASE_URL` still configures them all.
 */
export function testDatabaseUrl(suffix?: string): string {
  const base = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
  if (suffix === undefined) {
    return base;
  }
  const url = new URL(base);
  url.pathname = `${url.pathname}_${suffix}`;
  return url.toString();
}

/** Creates the test database when it does not exist yet, so no manual setup step is needed. */
export async function ensureTestDatabase(connectionString: string): Promise<void> {
  const url = new URL(connectionString);
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (!SAFE_DATABASE_NAME.test(databaseName)) {
    throw new Error(`Refusing to create a database with an unsafe name: ${databaseName}`);
  }

  const maintenance = new URL(connectionString);
  maintenance.pathname = "/postgres";
  const client = new Client({ connectionString: maintenance.toString() });
  await client.connect();
  try {
    await client.query(`create database "${databaseName}"`);
  } catch (error) {
    // 42P04 is duplicate_database, which is the normal case on every rerun.
    if ((error as { code?: string }).code !== "42P04") {
      throw error;
    }
  } finally {
    await client.end();
  }
}

export async function truncateAllTables(executor: DatabaseExecutor): Promise<void> {
  await executor.execute(
    sql`truncate table match_events, matches, guest_sessions, email_verification_tokens, user_sessions, profiles, users cascade`,
  );
}
