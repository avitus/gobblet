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
  it("creates the Phase 2 tables", async () => {
    const result = await handle.db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
    );

    const tables = result.rows.map((row) => row.table_name);
    expect(tables).toContain("guest_sessions");
    expect(tables).toContain("matches");
    expect(tables).toContain("match_events");
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
