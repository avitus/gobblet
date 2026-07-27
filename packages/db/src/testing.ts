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
    sql`truncate table match_events, matches, guest_sessions, email_verification_tokens, user_sessions, profiles, release_artifacts, releases, users cascade`,
  );
}

/**
 * Removes one catalogue row. The catalogue is seeded by a migration, so a suite that
 * exercises creating an entry has to make a gap for it first.
 */
export async function deleteAchievementByCode(
  executor: DatabaseExecutor,
  code: string,
): Promise<void> {
  await executor.execute(sql`delete from achievements where code = ${code}`);
}

/**
 * Clears the start of a match, which is how a row that predates the column, or one
 * written by something other than the runtime, reaches the code that has to cope
 * with a match that never started.
 */
export async function clearMatchStart(executor: DatabaseExecutor, matchId: string): Promise<void> {
  await executor.execute(sql`update matches set started_at = null where id = ${matchId}`);
}

/**
 * Runs work while holding a PostgreSQL advisory lock, so two suites that share one
 * database can take turns over a resource neither of them can namespace. The
 * release catalogue is the case: it is one list per channel for the whole server,
 * and a test that asserts it is empty cannot run beside one that publishes.
 *
 * The lock gets a connection of its own rather than one from a pool. A pooled
 * connection is handed to whoever asks next, and an advisory lock can be re-entered
 * by its own session, so the second caller would sail past the lock the first still
 * holds. Holding it outside a transaction is what lets the work commit as it goes.
 */
export async function withAdvisoryLock<T>(
  connectionString: string,
  key: number,
  work: () => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString, application_name: "gobblet-advisory-lock" });
  await client.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [key]);
    try {
      return await work();
    } finally {
      await client.query("select pg_advisory_unlock($1)", [key]);
    }
  } finally {
    await client.end();
  }
}

/** Empties the release catalogue, which no migration seeds and every channel shares. */
export async function clearReleases(executor: DatabaseExecutor): Promise<void> {
  await executor.execute(sql`delete from release_artifacts`);
  await executor.execute(sql`delete from releases`);
}
