import { and, desc, eq, inArray } from "drizzle-orm";
import { releaseArtifacts, releases } from "../schema";
import type {
  NewReleaseArtifactRow,
  NewReleaseRow,
  ReleaseArtifactRow,
  ReleaseRow,
} from "../schema";
import type { DatabaseExecutor } from "../executor";

/**
 * Desktop releases (docs/adr/0034-updates-are-asked-of-our-own-server.md). A
 * release is a row per channel and version with one artifact per platform; pausing
 * is a column, so nothing is deleted to stop a rollout and resuming is the same
 * switch. Promotion moves the channel and leaves the artifacts exactly as they were
 * built and signed.
 */

export type ReleaseWithArtifacts = Readonly<{
  release: ReleaseRow;
  artifacts: ReleaseArtifactRow[];
}>;

export async function insertRelease(
  executor: DatabaseExecutor,
  values: NewReleaseRow,
): Promise<ReleaseRow> {
  const [row] = await executor.insert(releases).values(values).returning();
  if (!row) {
    throw new Error("insertRelease returned no row");
  }
  return row;
}

export async function insertReleaseArtifacts(
  executor: DatabaseExecutor,
  values: readonly NewReleaseArtifactRow[],
): Promise<ReleaseArtifactRow[]> {
  if (values.length === 0) {
    return [];
  }
  return executor
    .insert(releaseArtifacts)
    .values([...values])
    .returning();
}

async function withArtifacts(
  executor: DatabaseExecutor,
  rows: readonly ReleaseRow[],
): Promise<ReleaseWithArtifacts[]> {
  if (rows.length === 0) {
    return [];
  }
  const artifacts = await executor
    .select()
    .from(releaseArtifacts)
    .where(
      inArray(
        releaseArtifacts.releaseId,
        rows.map((row) => row.id),
      ),
    );

  return rows.map((release) => ({
    release,
    artifacts: artifacts
      .filter((artifact) => artifact.releaseId === release.id)
      .sort((left, right) => left.target.localeCompare(right.target)),
  }));
}

export async function findReleaseById(
  executor: DatabaseExecutor,
  releaseId: string,
): Promise<ReleaseWithArtifacts | null> {
  const rows = await executor.select().from(releases).where(eq(releases.id, releaseId)).limit(1);
  const found = await withArtifacts(executor, rows);
  return found[0] ?? null;
}

export async function findReleaseByVersion(
  executor: DatabaseExecutor,
  channel: ReleaseRow["channel"],
  version: string,
): Promise<ReleaseWithArtifacts | null> {
  const rows = await executor
    .select()
    .from(releases)
    .where(and(eq(releases.channel, channel), eq(releases.version, version)))
    .limit(1);
  const found = await withArtifacts(executor, rows);
  return found[0] ?? null;
}

/**
 * The newest offered release of a channel: newest by publication, and never a
 * paused one, because a paused release is exactly one that must not be offered.
 */
export async function findLatestRelease(
  executor: DatabaseExecutor,
  channel: ReleaseRow["channel"],
): Promise<ReleaseWithArtifacts | null> {
  const rows = await executor
    .select()
    .from(releases)
    .where(and(eq(releases.channel, channel), eq(releases.paused, false)))
    .orderBy(desc(releases.publishedAt), desc(releases.id))
    .limit(1);
  const found = await withArtifacts(executor, rows);
  return found[0] ?? null;
}

/** Every release, newest first, for the administrative list. Paused ones included. */
export async function listReleases(
  executor: DatabaseExecutor,
  limit: number,
): Promise<ReleaseWithArtifacts[]> {
  const rows = await executor
    .select()
    .from(releases)
    .orderBy(desc(releases.publishedAt), desc(releases.id))
    .limit(limit);
  return withArtifacts(executor, rows);
}

export async function setReleasePaused(
  executor: DatabaseExecutor,
  releaseId: string,
  paused: boolean,
  now: Date,
): Promise<ReleaseRow | null> {
  const [row] = await executor
    .update(releases)
    .set({ paused, updatedAt: now })
    .where(eq(releases.id, releaseId))
    .returning();
  return row ?? null;
}

/**
 * Promotion is a channel change and a new publication moment, so the promoted
 * release is the newest one on stable. The artifacts are untouched: what the beta
 * channel proved is what stable serves.
 */
export async function promoteRelease(
  executor: DatabaseExecutor,
  releaseId: string,
  now: Date,
): Promise<ReleaseRow | null> {
  const [row] = await executor
    .update(releases)
    .set({ channel: "stable", publishedAt: now, updatedAt: now })
    .where(eq(releases.id, releaseId))
    .returning();
  return row ?? null;
}
