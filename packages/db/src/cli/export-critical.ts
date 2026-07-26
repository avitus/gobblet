import { loadServerConfig } from "@gobblet/config";
import { BackupError, exportCriticalTables } from "../backup";

/**
 * `pnpm db:export-critical [directory]`. The monthly export of specification
 * section 23; encrypting it and uploading it is the hosted step named in
 * docs/operations.md section 10.
 */

const [directory = "exports"] = process.argv.slice(2);

const config = loadServerConfig();
if (!config.databaseUrl) {
  console.error("DATABASE_URL is required to export the critical tables.");
  process.exit(1);
}

try {
  const result = await exportCriticalTables({
    connectionString: config.databaseUrl,
    directory,
  });
  console.warn(`wrote ${String(result.manifest.files.length)} tables to ${result.directory}`);
  for (const file of result.manifest.files) {
    console.warn(`${file.file} ${String(file.rows)} rows`);
  }
  console.warn("encrypt and upload this directory: that step is not automated yet");
} catch (error) {
  console.error(error instanceof BackupError ? error.message : error);
  process.exit(1);
}
