import { fileURLToPath } from "node:url";
import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Database } from "./client";

export const MIGRATIONS_FOLDER = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "migrations",
);

/**
 * Applies the checked-in SQL migrations. Deployments run this as an explicit
 * step before an instance is marked ready (docs/adr/0007-postgresql-drizzle.md).
 */
export async function runMigrations(
  db: Database,
  migrationsFolder: string = MIGRATIONS_FOLDER,
): Promise<void> {
  await migrate(db, { migrationsFolder });
}
