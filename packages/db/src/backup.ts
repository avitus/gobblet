import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { createGzip } from "node:zlib";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Client } from "pg";

/**
 * The export, the restore and the verification of
 * docs/adr/0032-backups-are-scripts-proved-by-a-restore.md. A backup carries a
 * manifest, and a restore compares what it read back with that manifest, so a
 * truncated or corrupt archive is discovered when it is written rather than during
 * an incident. Nothing here knows about a provider: the managed daily backups, the
 * retention and the encrypted upload are the deferred half, named in
 * docs/operations.md section 10.
 */

const run = promisify(execFile);

/**
 * What an incident would lose. Ephemeral rows (sessions, verification tokens,
 * connection history) are deliberately absent: they are cheap to recreate and a
 * restore that carried them would hand back tokens that should have expired.
 */
export const CRITICAL_TABLES = Object.freeze([
  "users",
  "profiles",
  "matches",
  "match_events",
  "ratings",
  "rating_changes",
  "rating_adjustments",
  "achievements",
  "user_achievements",
  "audit_log",
] as const);

export type CriticalTable = (typeof CRITICAL_TABLES)[number];

export type RowCounts = Readonly<Record<string, number>>;

export type BackupManifest = Readonly<{
  /** The database the archive was taken from, so a restore cannot mistake it. */
  database: string;
  createdAt: string;
  /** How many migrations had been applied, which is the schema this archive fits. */
  migrationsApplied: number;
  latestMigrationAt: string | null;
  archive: Readonly<{ file: string; bytes: number; sha256: string }>;
  rowCounts: RowCounts;
  toolVersion: string;
  serverVersion: string;
}>;

export type ExportManifest = Readonly<{
  database: string;
  createdAt: string;
  files: readonly Readonly<{ table: string; file: string; rows: number; sha256: string }>[];
  /** Stated rather than implied: the encrypted upload is not done here. */
  encryptedUpload: "deferred to the hosted object storage of ADR-0015";
}>;

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupError";
  }
}

function databaseNameOf(connectionString: string): string {
  const name = decodeURIComponent(new URL(connectionString).pathname.slice(1));
  if (name === "") {
    throw new BackupError(`The connection string names no database: ${connectionString}`);
  }
  return name;
}

async function withClient<T>(
  connectionString: string,
  action: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await action(client);
  } finally {
    await client.end();
  }
}

async function digestOf(file: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
}

function majorOf(version: string): string {
  return (/(\d+)/.exec(version)?.[1] ?? "").toString();
}

/**
 * `pg_dump` refuses an archive from a newer server, and a mismatch discovered
 * halfway through a restore is the worst moment to discover it.
 */
export async function checkToolVersions(connectionString: string): Promise<{
  tool: string;
  server: string;
}> {
  const tool = await run("pg_dump", ["--version"]).catch(() => {
    throw new BackupError("pg_dump is not on the path. Install the PostgreSQL client tools.");
  });
  const server = await withClient(connectionString, async (client) => {
    const result = await client.query<{ server_version: string }>("show server_version");
    return result.rows[0]?.server_version ?? "";
  });

  const toolVersion = tool.stdout.trim();
  if (majorOf(toolVersion) !== majorOf(server)) {
    throw new BackupError(
      `pg_dump is ${toolVersion} but the server is ${server}. Use client tools of the same major version.`,
    );
  }
  return { tool: toolVersion, server };
}

export async function readRowCounts(connectionString: string): Promise<RowCounts> {
  return withClient(connectionString, async (client) => {
    const counts: Record<string, number> = {};
    for (const table of CRITICAL_TABLES) {
      const result = await client.query<{ count: string }>(`select count(*) from "${table}"`);
      counts[table] = Number(result.rows[0]?.count ?? "0");
    }
    return counts;
  });
}

async function readMigrationState(
  connectionString: string,
): Promise<{ applied: number; latestAt: string | null }> {
  return withClient(connectionString, async (client) => {
    const result = await client.query<{ count: string; latest: string | null }>(
      `select count(*)::text as count, max(created_at)::text as latest from drizzle.__drizzle_migrations`,
    );
    const row = result.rows[0];
    return { applied: Number(row?.count ?? "0"), latestAt: row?.latest ?? null };
  });
}

/** Read by a Prometheus textfile collector; see docs/operations.md section 10. */
export const BACKUP_METRIC_FILE = "gobblet_backup.prom";

export type BackupOptions = Readonly<{
  connectionString: string;
  /** Where the archive and its manifest are written. Created when absent. */
  directory: string;
  now?: () => Date;
}>;

export type BackupResult = Readonly<{
  archivePath: string;
  manifestPath: string;
  manifest: BackupManifest;
}>;

export async function createBackup(options: BackupOptions): Promise<BackupResult> {
  const now = options.now?.() ?? new Date();
  const database = databaseNameOf(options.connectionString);
  const versions = await checkToolVersions(options.connectionString);
  await mkdir(options.directory, { recursive: true });

  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const archivePath = path.join(options.directory, `${database}-${stamp}.dump`);
  const manifestPath = `${archivePath}.manifest.json`;

  await run("pg_dump", [
    "--format=custom",
    "--compress=9",
    "--no-owner",
    "--no-privileges",
    `--file=${archivePath}`,
    options.connectionString,
  ]);

  const [counts, migrations, digest, size] = await Promise.all([
    readRowCounts(options.connectionString),
    readMigrationState(options.connectionString),
    digestOf(archivePath),
    stat(archivePath),
  ]);

  const manifest: BackupManifest = {
    database,
    createdAt: now.toISOString(),
    migrationsApplied: migrations.applied,
    latestMigrationAt: migrations.latestAt,
    archive: { file: path.basename(archivePath), bytes: size.size, sha256: digest },
    rowCounts: counts,
    toolVersion: versions.tool,
    serverVersion: versions.server,
  };

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  // The alert of section 17.4 is about a backup that stopped happening, so the
  // script leaves a series behind for a textfile collector to publish.
  await writeFile(
    path.join(options.directory, BACKUP_METRIC_FILE),
    [
      "# HELP gobblet_backup_last_success_timestamp_seconds When the last backup completed.",
      "# TYPE gobblet_backup_last_success_timestamp_seconds gauge",
      `gobblet_backup_last_success_timestamp_seconds ${String(Math.floor(now.getTime() / 1000))}`,
      "",
    ].join("\n"),
    "utf8",
  );
  return { archivePath, manifestPath, manifest };
}

export async function readManifest(manifestPath: string): Promise<BackupManifest> {
  const raw = await readFile(manifestPath, "utf8");
  return JSON.parse(raw) as BackupManifest;
}

export type RestoreOptions = Readonly<{
  archivePath: string;
  manifestPath: string;
  /** The database to restore into, which must be named on the command line. */
  targetConnectionString: string;
  /** The name the caller believes it is restoring into, checked before anything runs. */
  targetDatabase: string;
  /** Refuses to restore over the database the archive came from unless set. */
  allowSameDatabase?: boolean;
}>;

export type RestoreResult = Readonly<{
  database: string;
  rowCounts: RowCounts;
  manifest: BackupManifest;
}>;

/**
 * Restores an archive and proves it: the digest must match the manifest, the
 * target must be the database the caller named, and every critical table must come
 * back with the rows the manifest recorded. Anything else throws.
 */
export async function restoreBackup(options: RestoreOptions): Promise<RestoreResult> {
  const manifest = await readManifest(options.manifestPath);
  const target = databaseNameOf(options.targetConnectionString);

  if (target !== options.targetDatabase) {
    throw new BackupError(
      `Refusing to restore: the connection names ${target} but the target given was ${options.targetDatabase}.`,
    );
  }
  if (target === manifest.database && options.allowSameDatabase !== true) {
    throw new BackupError(
      `Refusing to restore over ${target}, the database this archive came from. Restore into a new database.`,
    );
  }

  const digest = await digestOf(options.archivePath);
  if (digest !== manifest.archive.sha256) {
    throw new BackupError(
      `The archive does not match its manifest: expected ${manifest.archive.sha256}, read ${digest}.`,
    );
  }

  await createDatabaseIfAbsent(options.targetConnectionString);
  await run("pg_restore", [
    "--no-owner",
    "--no-privileges",
    "--clean",
    "--if-exists",
    `--dbname=${options.targetConnectionString}`,
    options.archivePath,
  ]);

  const rowCounts = await readRowCounts(options.targetConnectionString);
  const differences = CRITICAL_TABLES.filter(
    (table) => (rowCounts[table] ?? 0) !== (manifest.rowCounts[table] ?? 0),
  );
  if (differences.length > 0) {
    throw new BackupError(
      `The restore does not match the manifest: ${differences
        .map(
          (table) =>
            `${table} has ${String(rowCounts[table] ?? 0)}, expected ${String(manifest.rowCounts[table] ?? 0)}`,
        )
        .join("; ")}.`,
    );
  }

  return { database: target, rowCounts, manifest };
}

const SAFE_DATABASE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

async function createDatabaseIfAbsent(connectionString: string): Promise<void> {
  const name = databaseNameOf(connectionString);
  if (!SAFE_DATABASE_NAME.test(name)) {
    throw new BackupError(`Refusing to create a database with an unsafe name: ${name}`);
  }
  const maintenance = new URL(connectionString);
  maintenance.pathname = "/postgres";
  await withClient(maintenance.toString(), async (client) => {
    try {
      await client.query(`create database "${name}"`);
    } catch (error) {
      // 42P04 is duplicate_database, which is the normal case for a repeated drill.
      if ((error as { code?: string }).code !== "42P04") {
        throw error;
      }
    }
  });
}

export type ExportOptions = Readonly<{
  connectionString: string;
  directory: string;
  now?: () => Date;
}>;

export type ExportResult = Readonly<{
  directory: string;
  manifestPath: string;
  manifest: ExportManifest;
}>;

/**
 * The monthly export of section 23, as compressed CSV so it can be read without
 * PostgreSQL. Encrypting it and putting it in object storage is the hosted step the
 * runbook names; this writes the file a human or a job would then upload.
 */
export async function exportCriticalTables(options: ExportOptions): Promise<ExportResult> {
  const now = options.now?.() ?? new Date();
  const database = databaseNameOf(options.connectionString);
  const stamp = now.toISOString().slice(0, 10);
  const directory = path.join(options.directory, `${database}-${stamp}`);
  await mkdir(directory, { recursive: true });

  const files: { table: string; file: string; rows: number; sha256: string }[] = [];
  const counts = await readRowCounts(options.connectionString);

  for (const table of CRITICAL_TABLES) {
    const file = path.join(directory, `${table}.csv.gz`);
    const csv = await run("psql", [
      options.connectionString,
      "--no-psqlrc",
      "--command",
      `\\copy (select * from "${table}" ) to stdout with (format csv, header true)`,
    ]);
    await pipeline(Readable.from([csv.stdout]), createGzip(), createWriteStream(file));
    files.push({
      table,
      file: path.basename(file),
      rows: counts[table] ?? 0,
      sha256: await digestOf(file),
    });
  }

  const manifest: ExportManifest = {
    database,
    createdAt: now.toISOString(),
    files,
    encryptedUpload: "deferred to the hosted object storage of ADR-0015",
  };
  const manifestPath = path.join(directory, "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { directory, manifestPath, manifest };
}
