import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createGunzip } from "node:zlib";
import { createReadStream } from "node:fs";
import { text } from "node:stream/consumers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BACKUP_METRIC_FILE,
  BackupError,
  CRITICAL_TABLES,
  checkToolVersions,
  createBackup,
  exportCriticalTables,
  readRowCounts,
  restoreBackup,
} from "../src/backup";
import {
  findMatchById,
  insertAuditRecord,
  insertMatch,
  insertMatchEvent,
  insertRatingChanges,
  insertUser,
  listMatchEvents,
  upsertRating,
} from "../src/index";
import type { DatabaseHandle, MatchRow, UserRow } from "../src/index";
import { createDatabase } from "../src/index";
import { matchFixture, userFixture } from "./helpers/fixtures";
import { TEST_DATABASE_URL, setupTestDatabase, truncateAll } from "./helpers/test-database";

/**
 * The round trip of docs/adr/0032-backups-are-scripts-proved-by-a-restore.md: a
 * seeded database, an archive, a restore into a different database, and the same
 * match read back through the same repositories. This is what "restores into
 * staging" means where there is no staging: same procedure, same tools, another
 * database name.
 */

const RESTORE_DATABASE = "gobblet_restore_drill";

let handle: DatabaseHandle;
let workspace: string;
let user: UserRow;
let match: MatchRow;

function restoreUrl(databaseName: string): string {
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function seed(): Promise<void> {
  user = await insertUser(handle.db, userFixture({ username: "restored_player" }));
  const endedAt = new Date("2026-07-26T12:00:00.000Z");
  match = await insertMatch(
    handle.db,
    matchFixture({
      mode: "ranked",
      lightPlayerType: "user",
      lightPlayerId: user.id,
      lightDisplayName: user.displayName,
      status: "completed",
      result: "light",
      endReason: "line",
      endedAt,
      stateVersion: 2,
      moveCount: 2,
    }),
  );

  for (const sequence of [1, 2]) {
    await insertMatchEvent(handle.db, {
      matchId: match.id,
      sequence,
      commandId: randomUUID(),
      type: "move",
      actorType: "user",
      actorId: user.id,
      payload: { move: { kind: "reserve", reserveStack: 0, to: "r0c0" }, sequence },
      stateHash: `hash-${String(sequence)}`,
    });
  }

  await upsertRating(handle.db, user.id, {
    rating: 1215,
    gamesPlayed: 1,
    wins: 1,
    losses: 0,
    draws: 0,
    currentStreak: 1,
    bestStreak: 1,
  });
  await insertRatingChanges(handle.db, [
    {
      matchId: match.id,
      userId: user.id,
      side: "light",
      ratingBefore: 1200,
      ratingAfter: 1215,
      delta: 15,
      opponentRatingBefore: 1200,
      outcome: "win",
      formulaVersion: 1,
    },
  ]);
  await insertAuditRecord(handle.db, {
    action: "user-suspended",
    adminUserId: null,
    targetType: "user",
    targetId: user.id,
    before: { status: "active" },
    after: { status: "suspended" },
    reason: "seeded so the archive carries an audit row",
  });
}

beforeAll(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), "gobblet-backup-"));
  handle = await setupTestDatabase();
  await truncateAll(handle);
  await seed();
}, 60_000);

afterAll(async () => {
  // Every suite here leaves the shared database as it found it.
  await truncateAll(handle);
  await handle.close();
  await rm(workspace, { recursive: true, force: true });
});

describe("the backup and restore round trip", () => {
  it("requires client tools of the server's major version", async () => {
    const versions = await checkToolVersions(TEST_DATABASE_URL);

    expect(versions.tool).toMatch(/pg_dump/);
    expect(versions.server).toMatch(/^\d+/);
  });

  it("writes an archive whose manifest describes what was taken", async () => {
    const result = await createBackup({
      connectionString: TEST_DATABASE_URL,
      directory: workspace,
      now: () => new Date("2026-07-26T13:00:00.000Z"),
    });

    expect(result.manifest.rowCounts).toMatchObject({
      users: 1,
      matches: 1,
      match_events: 2,
      ratings: 1,
      rating_changes: 1,
      audit_log: 1,
    });
    expect(Object.keys(result.manifest.rowCounts)).toEqual([...CRITICAL_TABLES]);
    expect(result.manifest.migrationsApplied).toBeGreaterThan(0);
    expect(result.manifest.archive.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.manifest.archive.bytes).toBeGreaterThan(0);

    const written = JSON.parse(await readFile(result.manifestPath, "utf8")) as {
      database: string;
      createdAt: string;
    };
    expect(written.database).toBe(new URL(TEST_DATABASE_URL).pathname.slice(1));
    expect(written.createdAt).toBe("2026-07-26T13:00:00.000Z");

    // The alert on a backup that stopped happening reads this, not the manifest.
    const metric = await readFile(path.join(workspace, BACKUP_METRIC_FILE), "utf8");
    expect(metric).toContain("gobblet_backup_last_success_timestamp_seconds 1785070800");
  }, 60_000);

  it("restores into another database and hands back the same match", async () => {
    const backup = await createBackup({
      connectionString: TEST_DATABASE_URL,
      directory: workspace,
      now: () => new Date("2026-07-26T13:05:00.000Z"),
    });

    const restored = await restoreBackup({
      archivePath: backup.archivePath,
      manifestPath: backup.manifestPath,
      targetConnectionString: restoreUrl(RESTORE_DATABASE),
      targetDatabase: RESTORE_DATABASE,
    });

    expect(restored.database).toBe(RESTORE_DATABASE);
    expect(restored.rowCounts).toEqual(backup.manifest.rowCounts);

    const target = createDatabase({
      connectionString: restoreUrl(RESTORE_DATABASE),
      poolMax: 1,
      applicationName: "gobblet-restore-drill",
    });
    try {
      const readBack = await findMatchById(target.db, match.id);
      expect(readBack).toMatchObject({
        id: match.id,
        mode: "ranked",
        status: "completed",
        result: "light",
        endReason: "line",
        stateVersion: 2,
        lightPlayerId: user.id,
      });
      expect(readBack?.endedAt?.toISOString()).toBe(match.endedAt?.toISOString());

      const events = await listMatchEvents(target.db, match.id);
      expect(events.map((event) => event.stateHash)).toEqual(["hash-1", "hash-2"]);
      expect(events[0]?.payload).toEqual({
        move: { kind: "reserve", reserveStack: 0, to: "r0c0" },
        sequence: 1,
      });
    } finally {
      await target.close();
    }
  }, 120_000);

  it("refuses to restore over the database the archive came from", async () => {
    const backup = await createBackup({
      connectionString: TEST_DATABASE_URL,
      directory: workspace,
      now: () => new Date("2026-07-26T13:10:00.000Z"),
    });

    await expect(
      restoreBackup({
        archivePath: backup.archivePath,
        manifestPath: backup.manifestPath,
        targetConnectionString: TEST_DATABASE_URL,
        targetDatabase: backup.manifest.database,
      }),
    ).rejects.toThrow(/Refusing to restore over/);
  }, 60_000);

  it("restores again over a database a previous drill left behind", async () => {
    const backup = await createBackup({
      connectionString: TEST_DATABASE_URL,
      directory: workspace,
      now: () => new Date("2026-07-26T13:12:00.000Z"),
    });

    for (const attempt of [1, 2]) {
      const restored = await restoreBackup({
        archivePath: backup.archivePath,
        manifestPath: backup.manifestPath,
        targetConnectionString: restoreUrl(RESTORE_DATABASE),
        targetDatabase: RESTORE_DATABASE,
      });

      expect(restored.rowCounts, `attempt ${String(attempt)}`).toEqual(backup.manifest.rowCounts);
    }
  }, 180_000);

  it("refuses to work with client tools of another major version", async () => {
    const bin = path.join(workspace, "fake-bin");
    await mkdir(bin, { recursive: true });
    await writeFile(path.join(bin, "pg_dump"), "#!/bin/sh\necho 'pg_dump (PostgreSQL) 14.11'\n", {
      mode: 0o755,
    });
    const realPath = process.env["PATH"] ?? "";

    try {
      process.env["PATH"] = bin;
      await expect(checkToolVersions(TEST_DATABASE_URL)).rejects.toThrow(/same major version/);

      // And with no client tools at all, the message says which tool is missing.
      process.env["PATH"] = path.join(workspace, "empty-bin");
      await expect(checkToolVersions(TEST_DATABASE_URL)).rejects.toThrow(
        /pg_dump is not on the path/,
      );
    } finally {
      process.env["PATH"] = realPath;
    }
  }, 60_000);

  it("refuses a target whose name could not be a database", async () => {
    const backup = await createBackup({
      connectionString: TEST_DATABASE_URL,
      directory: workspace,
      now: () => new Date("2026-07-26T13:16:00.000Z"),
    });
    const injected = "drill; drop table users";

    await expect(
      restoreBackup({
        archivePath: backup.archivePath,
        manifestPath: backup.manifestPath,
        targetConnectionString: restoreUrl(encodeURIComponent(injected)),
        targetDatabase: injected,
      }),
    ).rejects.toThrow(/unsafe name/);
  }, 60_000);

  it("refuses a connection string that names no database at all", async () => {
    const nameless = new URL(TEST_DATABASE_URL);
    nameless.pathname = "/";

    await expect(
      createBackup({ connectionString: nameless.toString(), directory: workspace }),
    ).rejects.toThrow(/names no database/);
  });

  it("refuses a target the caller did not name", async () => {
    const backup = await createBackup({
      connectionString: TEST_DATABASE_URL,
      directory: workspace,
      now: () => new Date("2026-07-26T13:15:00.000Z"),
    });

    await expect(
      restoreBackup({
        archivePath: backup.archivePath,
        manifestPath: backup.manifestPath,
        targetConnectionString: restoreUrl(RESTORE_DATABASE),
        targetDatabase: "some_other_database",
      }),
    ).rejects.toThrow(/the connection names/);
  }, 60_000);

  it("refuses an archive that does not match its manifest", async () => {
    const backup = await createBackup({
      connectionString: TEST_DATABASE_URL,
      directory: workspace,
      now: () => new Date("2026-07-26T13:20:00.000Z"),
    });
    const tampered = path.join(workspace, "tampered.manifest.json");
    await writeFile(
      tampered,
      JSON.stringify({
        ...backup.manifest,
        archive: { ...backup.manifest.archive, sha256: "0".repeat(64) },
      }),
      "utf8",
    );

    await expect(
      restoreBackup({
        archivePath: backup.archivePath,
        manifestPath: tampered,
        targetConnectionString: restoreUrl(RESTORE_DATABASE),
        targetDatabase: RESTORE_DATABASE,
      }),
    ).rejects.toBeInstanceOf(BackupError);
  }, 60_000);

  it("notices when a restore comes back short of the manifest", async () => {
    const backup = await createBackup({
      connectionString: TEST_DATABASE_URL,
      directory: workspace,
      now: () => new Date("2026-07-26T13:25:00.000Z"),
    });
    const inflated = path.join(workspace, "inflated.manifest.json");
    await writeFile(
      inflated,
      JSON.stringify({
        ...backup.manifest,
        rowCounts: { ...backup.manifest.rowCounts, matches: 99 },
      }),
      "utf8",
    );

    await expect(
      restoreBackup({
        archivePath: backup.archivePath,
        manifestPath: inflated,
        targetConnectionString: restoreUrl(RESTORE_DATABASE),
        targetDatabase: RESTORE_DATABASE,
      }),
    ).rejects.toThrow(/matches has 1, expected 99/);
  }, 120_000);

  it("exports the critical tables as compressed CSV that reads without PostgreSQL", async () => {
    const result = await exportCriticalTables({
      connectionString: TEST_DATABASE_URL,
      directory: workspace,
      now: () => new Date("2026-07-26T13:30:00.000Z"),
    });

    expect(result.manifest.files.map((file) => file.table)).toEqual([...CRITICAL_TABLES]);
    expect(result.manifest.encryptedUpload).toMatch(/deferred/);

    const matches = result.manifest.files.find((file) => file.table === "matches");
    const csv = await text(
      createReadStream(path.join(result.directory, matches?.file ?? "")).pipe(createGunzip()),
    );
    expect(csv.split("\n")[0]).toContain("mode");
    expect(csv).toContain(match.id);
  }, 60_000);

  it("counts only the tables an incident would lose", async () => {
    const counts = await readRowCounts(TEST_DATABASE_URL);

    expect(Object.keys(counts)).toEqual([...CRITICAL_TABLES]);
    expect(counts).not.toHaveProperty("user_sessions");
    expect(counts).not.toHaveProperty("match_connection_events");
  });
});
