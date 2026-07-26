import { loadServerConfig } from "@gobblet/config";
import { BackupError, createBackup } from "../backup";

/**
 * `pnpm db:backup [directory]`. Writes the archive and the manifest that makes a
 * later restore verifiable (docs/adr/0032-backups-are-scripts-proved-by-a-restore.md).
 */

const [directory = "backups"] = process.argv.slice(2);

const config = loadServerConfig();
if (!config.databaseUrl) {
  console.error("DATABASE_URL is required to take a backup.");
  process.exit(1);
}

try {
  const result = await createBackup({
    connectionString: config.databaseUrl,
    directory,
  });
  const rows = Object.entries(result.manifest.rowCounts)
    .map(([table, count]) => `${table}=${String(count)}`)
    .join(" ");
  console.warn(`wrote ${result.archivePath} (${String(result.manifest.archive.bytes)} bytes)`);
  console.warn(`manifest ${result.manifestPath}`);
  console.warn(rows);
} catch (error) {
  console.error(error instanceof BackupError ? error.message : error);
  process.exit(1);
}
