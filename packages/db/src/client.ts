import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import * as schema from "./schema";

export type Database = ReturnType<typeof drizzle<typeof schema>>;

export type DatabaseHandle = Readonly<{
  db: Database;
  pool: Pool;
  close: () => Promise<void>;
}>;

export type DatabaseOptions = Readonly<{
  connectionString: string;
  poolMax?: number;
  applicationName?: string;
}>;

export function createDatabase({
  connectionString,
  poolMax = 10,
  applicationName = "gobblet-server",
}: DatabaseOptions): DatabaseHandle {
  const pool = new Pool({ connectionString, max: poolMax, application_name: applicationName });
  const db = drizzle(pool, { schema });

  return Object.freeze({
    db,
    pool,
    close: async () => {
      await pool.end();
    },
  });
}

export async function checkDatabaseConnection(db: Database): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}
