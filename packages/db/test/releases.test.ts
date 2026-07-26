import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  findLatestRelease,
  findReleaseById,
  findReleaseByVersion,
  insertRelease,
  insertReleaseArtifacts,
  insertUser,
  listReleases,
  promoteRelease,
  setReleasePaused,
} from "../src/index";
import type { DatabaseHandle, NewReleaseArtifactRow, ReleaseRow } from "../src/index";
import { userFixture } from "./helpers/fixtures";
import { expectQueryToFail, setupTestDatabase, truncateAll } from "./helpers/test-database";

let handle: DatabaseHandle;

beforeAll(async () => {
  handle = await setupTestDatabase();
});

afterEach(async () => {
  await truncateAll(handle);
});

afterAll(async () => {
  await handle.close();
});

const MOMENT = new Date("2026-07-26T09:00:00.000Z");

function artifact(
  releaseId: string,
  target: NewReleaseArtifactRow["target"],
): NewReleaseArtifactRow {
  return {
    releaseId,
    target,
    url: `https://example.com/${target}/bundle.tar.gz`,
    downloadUrl: `https://example.com/${target}/installer`,
    signature: "c2lnbmF0dXJl",
    sizeBytes: 12_000_000,
    sha256: "b".repeat(64),
  };
}

async function publish(
  version: string,
  channel: ReleaseRow["channel"],
  publishedAt: Date,
  targets: NewReleaseArtifactRow["target"][] = ["darwin-aarch64", "windows-x86_64"],
): Promise<ReleaseRow> {
  const release = await insertRelease(handle.db, {
    version,
    channel,
    notes: `Notes for ${version}`,
    publishedAt,
    updatedAt: publishedAt,
  });
  await insertReleaseArtifacts(
    handle.db,
    targets.map((target) => artifact(release.id, target)),
  );
  return release;
}

describe("desktop releases", () => {
  it("stores a release with one artifact per platform and reads it back whole", async () => {
    const published = await publish("1.2.0", "stable", MOMENT);

    const found = await findReleaseById(handle.db, published.id);

    expect(found?.release.version).toBe("1.2.0");
    expect(found?.release.paused).toBe(false);
    expect(found?.artifacts.map((row) => row.target)).toEqual(["darwin-aarch64", "windows-x86_64"]);
    expect(found?.artifacts[0]?.sha256).toBe("b".repeat(64));
  });

  it("returns nothing for a release that does not exist", async () => {
    expect(await findReleaseById(handle.db, "0f1c1a1e-2b3c-4d5e-8f90-1a2b3c4d5e6f")).toBeNull();
    expect(await findReleaseByVersion(handle.db, "stable", "9.9.9")).toBeNull();
    expect(await findLatestRelease(handle.db, "beta")).toBeNull();
    expect(await listReleases(handle.db, 10)).toEqual([]);
  });

  it("writes nothing when a publication carries no artifacts", async () => {
    expect(await insertReleaseArtifacts(handle.db, [])).toEqual([]);
  });

  it("offers the newest release of a channel and keeps the channels apart", async () => {
    await publish("1.0.0", "stable", new Date("2026-07-01T09:00:00.000Z"));
    await publish("1.1.0", "stable", new Date("2026-07-10T09:00:00.000Z"));
    await publish("1.2.0", "beta", new Date("2026-07-20T09:00:00.000Z"));

    expect((await findLatestRelease(handle.db, "stable"))?.release.version).toBe("1.1.0");
    expect((await findLatestRelease(handle.db, "beta"))?.release.version).toBe("1.2.0");
  });

  it("stops offering a paused release without deleting anything", async () => {
    const release = await publish("1.3.0", "stable", MOMENT);

    const paused = await setReleasePaused(handle.db, release.id, true, new Date());

    expect(paused?.paused).toBe(true);
    expect(await findLatestRelease(handle.db, "stable")).toBeNull();
    expect((await findReleaseById(handle.db, release.id))?.artifacts).toHaveLength(2);

    await setReleasePaused(handle.db, release.id, false, new Date());
    expect((await findLatestRelease(handle.db, "stable"))?.release.version).toBe("1.3.0");
  });

  it("promotes a beta release to stable without touching its artifacts", async () => {
    const release = await publish("1.4.0", "beta", MOMENT);
    const before = await findReleaseById(handle.db, release.id);

    const promoted = await promoteRelease(handle.db, release.id, new Date("2026-07-27T09:00:00Z"));

    expect(promoted?.channel).toBe("stable");
    expect(promoted?.publishedAt).toEqual(new Date("2026-07-27T09:00:00.000Z"));
    const after = await findReleaseById(handle.db, release.id);
    expect(after?.artifacts).toEqual(before?.artifacts);
    expect(await findLatestRelease(handle.db, "beta")).toBeNull();
    expect((await findLatestRelease(handle.db, "stable"))?.release.version).toBe("1.4.0");
  });

  it("says nothing changed when a pause or a promotion names no release", async () => {
    const absent = "0f1c1a1e-2b3c-4d5e-8f90-1a2b3c4d5e6f";

    expect(await setReleasePaused(handle.db, absent, true, new Date())).toBeNull();
    expect(await promoteRelease(handle.db, absent, new Date())).toBeNull();
  });

  it("refuses a second release of the same version in the same channel", async () => {
    await publish("1.5.0", "stable", MOMENT);

    const failure = await expectQueryToFail(() =>
      publish("1.5.0", "stable", MOMENT, ["darwin-x86_64"]),
    );

    expect(failure).toEqual({ code: "23505", constraint: "releases_channel_version_key" });
  });

  it("refuses two artifacts for the same platform in one release", async () => {
    const release = await publish("1.6.0", "stable", MOMENT, ["darwin-aarch64"]);

    const failure = await expectQueryToFail(() =>
      insertReleaseArtifacts(handle.db, [artifact(release.id, "darwin-aarch64")]),
    );

    expect(failure).toEqual({ code: "23505", constraint: "release_artifacts_release_target_key" });
  });

  it("lists releases newest first, paused ones included, and remembers who published", async () => {
    const admin = await insertUser(handle.db, userFixture({ role: "admin" }));
    const old = await publish("1.7.0", "stable", new Date("2026-07-01T09:00:00.000Z"));
    await setReleasePaused(handle.db, old.id, true, new Date());
    const recent = await insertRelease(handle.db, {
      version: "1.8.0",
      channel: "beta",
      notes: "Newest",
      publishedBy: admin.id,
      publishedAt: new Date("2026-07-25T09:00:00.000Z"),
      updatedAt: new Date("2026-07-25T09:00:00.000Z"),
    });

    const listed = await listReleases(handle.db, 10);

    expect(listed.map((entry) => entry.release.version)).toEqual(["1.8.0", "1.7.0"]);
    expect(listed[0]?.release.publishedBy).toBe(admin.id);
    expect(listed[0]?.artifacts).toEqual([]);
    expect(listed[1]?.release.paused).toBe(true);
    expect(await findReleaseByVersion(handle.db, "beta", "1.8.0")).not.toBeNull();
    expect(recent.channel).toBe("beta");
  });
});
