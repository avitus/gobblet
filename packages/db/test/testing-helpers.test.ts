import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  findAchievementByCode,
  findLatestRelease,
  findMatchById,
  insertAchievement,
  insertMatch,
  insertRelease,
  insertReleaseArtifacts,
  updateMatchState,
} from "../src/index";
import type { DatabaseHandle } from "../src/index";
import {
  clearMatchStart,
  clearReleases,
  deleteAchievementByCode,
  ensureTestDatabase,
  testDatabaseUrl,
  withAdvisoryLock,
} from "../src/testing";
import { matchFixture } from "./helpers/fixtures";
import { TEST_DATABASE_URL, setupTestDatabase, truncateAll } from "./helpers/test-database";

/**
 * The helpers behind `@gobblet/db/testing`, which every other package's suites
 * depend on. A break here reads as a broken suite somewhere else, so they are
 * proved where they are written.
 */

const SCRATCH_SUFFIX = "helper_drill";
const IMPATIENT_SUFFIX = "impatient_drill";

function maintenanceUrl(): string {
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = "/postgres";
  return url.toString();
}

function databaseNameOf(connectionString: string): string {
  return new URL(connectionString).pathname.slice(1);
}

async function withMaintenanceClient(statement: string): Promise<void> {
  const client = new Client({ connectionString: maintenanceUrl() });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

async function dropScratchDatabases(): Promise<void> {
  for (const suffix of [SCRATCH_SUFFIX, IMPATIENT_SUFFIX]) {
    await withMaintenanceClient(
      `drop database if exists "${databaseNameOf(testDatabaseUrl(suffix))}"`,
    );
  }
}

let handle: DatabaseHandle;

beforeAll(async () => {
  handle = await setupTestDatabase();
  await truncateAll(handle);
  await dropScratchDatabases();
});

afterAll(async () => {
  await truncateAll(handle);
  await handle.close();
  await dropScratchDatabases();
});

describe("the database a suite is given", () => {
  it("belongs to that suite alone, while one variable still configures them all", () => {
    const base = new URL(TEST_DATABASE_URL);
    const scoped = new URL(testDatabaseUrl(SCRATCH_SUFFIX));

    expect(testDatabaseUrl()).toBe(TEST_DATABASE_URL);
    expect(scoped.pathname).toBe(`${base.pathname}_${SCRATCH_SUFFIX}`);
    expect(scoped.host).toBe(base.host);
  });

  it("is created on first use and accepted without complaint on every later run", async () => {
    const scratch = testDatabaseUrl(SCRATCH_SUFFIX);

    await ensureTestDatabase(scratch);
    await ensureTestDatabase(scratch);

    const client = new Client({ connectionString: scratch });
    await client.connect();
    try {
      const result = await client.query<{ name: string }>("select current_database() as name");
      expect(result.rows[0]?.name).toBe(databaseNameOf(scratch));
    } finally {
      await client.end();
    }
  }, 30_000);

  it("refuses a name that could not be a database, rather than quoting it into a statement", async () => {
    const injected = new URL(TEST_DATABASE_URL);
    injected.pathname = `/${encodeURIComponent("drill; drop table users")}`;

    await expect(ensureTestDatabase(injected.toString())).rejects.toThrow(/unsafe name/);
  });

  it("reports a failure that is not the database already existing, instead of swallowing it", async () => {
    // A millisecond of patience, asked for in the connection options, is the cheapest
    // failure to provoke that leaves every other suite's database alone.
    const impatient = new URL(testDatabaseUrl(IMPATIENT_SUFFIX));
    impatient.search = "?options=-c%20statement_timeout%3D1";

    await expect(ensureTestDatabase(impatient.toString())).rejects.toThrow(/statement timeout/);
  });
});

describe("the rows a suite needs to make itself", () => {
  it("clears the start of a match, so the runtime can be shown a match that never started", async () => {
    const match = await insertMatch(handle.db, matchFixture());
    const startedAt = new Date("2026-07-26T10:00:00.000Z");
    await updateMatchState(handle.db, match.id, {
      gameState: { version: 1, ply: 0 },
      stateVersion: 1,
      activePlayer: "light",
      lightRemainingMs: 300_000,
      darkRemainingMs: 300_000,
      turnStartedAt: startedAt,
      lastClockCommitAt: startedAt,
      moveCount: 0,
      status: "active",
      startedAt,
    });

    await clearMatchStart(handle.db, match.id);

    expect((await findMatchById(handle.db, match.id))?.startedAt).toBeNull();
  });

  it("removes one catalogue entry, so a suite that adds an entry has a gap to add it into", async () => {
    const code = `drill-${randomUUID().slice(0, 8)}`;
    await insertAchievement(handle.db, {
      code,
      name: "Drill",
      description: "Added by this suite and taken away again.",
      badgeAsset: "bronze",
    });

    await deleteAchievementByCode(handle.db, code);

    expect(await findAchievementByCode(handle.db, code)).toBeUndefined();
  });

  it("empties the release catalogue, which every channel shares and no migration seeds", async () => {
    const release = await insertRelease(handle.db, {
      version: "1.4.0",
      channel: "stable",
      notes: "Published so it can be taken away again.",
      publishedAt: new Date("2026-07-27T10:00:00.000Z"),
      updatedAt: new Date("2026-07-27T10:00:00.000Z"),
    });
    await insertReleaseArtifacts(handle.db, [
      {
        releaseId: release.id,
        target: "darwin-aarch64",
        url: "https://example.com/bundle.tar.gz",
        downloadUrl: "https://example.com/installer.dmg",
        signature: "c2lnbmF0dXJl",
        sizeBytes: 12_000_000,
        sha256: "c".repeat(64),
      },
    ]);

    await clearReleases(handle.db);

    expect(await findLatestRelease(handle.db, "stable")).toBeNull();
  });

  it("holds a lock for the length of the work, so two suites take turns rather than collide", async () => {
    const order: string[] = [];
    const key = Number(BigInt.asIntN(32, BigInt(Date.now())));
    const hold = (name: string): Promise<void> =>
      withAdvisoryLock(TEST_DATABASE_URL, key, async () => {
        order.push(`${name} in`);
        await new Promise((settle) => setImmediate(settle));
        order.push(`${name} out`);
      });

    await Promise.all([hold("one"), hold("two")]);

    // Which of the two connects first is the network's business; that neither runs
    // inside the other is the lock's.
    const winner = order[0] === "one in" ? "one" : "two";
    const waiter = winner === "one" ? "two" : "one";
    expect(order).toEqual([`${winner} in`, `${winner} out`, `${waiter} in`, `${waiter} out`]);
  });

  it("lets the work commit while the lock is held, rather than hiding it in a transaction", async () => {
    const key = Number(BigInt.asIntN(32, BigInt(Date.now() + 2)));
    const code = `drill-${randomUUID().slice(0, 8)}`;

    await withAdvisoryLock(TEST_DATABASE_URL, key, async () => {
      await insertAchievement(handle.db, {
        code,
        name: "Drill",
        description: "Written inside the lock and read back through another connection.",
        badgeAsset: "bronze",
      });

      expect(await findAchievementByCode(handle.db, code)).toBeDefined();
    });

    await deleteAchievementByCode(handle.db, code);
  });

  it("releases the lock when the work throws, so a failing suite does not wedge the next one", async () => {
    const key = Number(BigInt.asIntN(32, BigInt(Date.now() + 1)));

    await expect(
      withAdvisoryLock(TEST_DATABASE_URL, key, () => Promise.reject(new Error("the work failed"))),
    ).rejects.toThrow("the work failed");

    await expect(
      withAdvisoryLock(TEST_DATABASE_URL, key, () => Promise.resolve("taken")),
    ).resolves.toBe("taken");
  });
});
