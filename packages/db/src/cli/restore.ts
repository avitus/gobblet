import { loadServerConfig } from "@gobblet/config";
import { BackupError, restoreBackup } from "../backup";

/**
 * `pnpm db:restore <archive> <target-database>`. The target is named on the command
 * line and checked against the connection, so a restore cannot land on the live
 * database by omission (docs/adr/0032-backups-are-scripts-proved-by-a-restore.md).
 */

const [archivePath, targetDatabase, manifestOverride] = process.argv.slice(2);

if (!archivePath || !targetDatabase) {
  console.error("Usage: pnpm db:restore <archive.dump> <target-database> [manifest.json]");
  process.exit(1);
}

const config = loadServerConfig();
if (!config.databaseUrl) {
  console.error("DATABASE_URL is required to restore, and names the server to restore into.");
  process.exit(1);
}

const target = new URL(config.databaseUrl);
target.pathname = `/${targetDatabase}`;

try {
  const result = await restoreBackup({
    archivePath,
    manifestPath: manifestOverride ?? `${archivePath}.manifest.json`,
    targetConnectionString: target.toString(),
    targetDatabase,
  });
  console.warn(`restored ${result.manifest.database} into ${result.database}`);
  console.warn(
    Object.entries(result.rowCounts)
      .map(([table, count]) => `${table}=${String(count)}`)
      .join(" "),
  );
} catch (error) {
  console.error(error instanceof BackupError ? error.message : error);
  process.exit(1);
}
