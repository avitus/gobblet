import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkDatabaseConnection, createDatabase, runMigrations } from "../src/index";
import type { DatabaseHandle } from "../src/index";
import { TEST_DATABASE_URL, setupTestDatabase } from "./helpers/test-database";

let handle: DatabaseHandle;

beforeAll(async () => {
  handle = await setupTestDatabase();
});

afterAll(async () => {
  await handle.close();
});

describe("migrations", () => {
  it("creates every table the delivered phases own", async () => {
    const result = await handle.db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
    );

    const tables = result.rows.map((row) => row.table_name);
    expect(tables).toEqual(
      expect.arrayContaining([
        "email_verification_tokens",
        "guest_sessions",
        "match_events",
        "matches",
        "profiles",
        "rating_changes",
        "ratings",
        "user_sessions",
        "users",
      ]),
    );
  });

  it("is idempotent when applied again", async () => {
    await expect(runMigrations(handle.db)).resolves.toBeUndefined();
  });

  it("reports an unreachable database instead of throwing", async () => {
    const unreachable = createDatabase({
      connectionString: TEST_DATABASE_URL.replace(":5432", ":5433"),
      poolMax: 1,
    });

    expect(await checkDatabaseConnection(unreachable.db)).toBe(false);
    await unreachable.close();
  });

  it("explains a missing database when migrations cannot run", async () => {
    const unreachable = createDatabase({
      connectionString: TEST_DATABASE_URL.replace(":5432", ":5433"),
      poolMax: 1,
    });

    await expect(runMigrations(unreachable.db)).rejects.toThrow();
    await unreachable.close();
  });
});
