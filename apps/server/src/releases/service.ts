import {
  findLatestRelease,
  findReleaseById,
  findReleaseByVersion,
  insertAuditRecord,
  insertRelease,
  insertReleaseArtifacts,
  listReleases,
  promoteRelease,
  setReleasePaused,
} from "@gobblet/db";
import type { Database, ReleaseWithArtifacts } from "@gobblet/db";
import { ADMIN_PAGE_SIZE, isNewerVersion } from "@gobblet/protocol";
import type {
  LatestReleasesResponse,
  PublishReleaseRequest,
  ReleaseBuildEventRequest,
  ReleaseChannel,
  ReleaseSummary,
  UpdateManifest,
  UpdateTarget,
} from "@gobblet/protocol";
import type { AdminIdentity } from "../admin/service";
import type { TelemetryService } from "../observability/telemetry";

/**
 * Desktop releases and the update manifest
 * (docs/adr/0034-updates-are-asked-of-our-own-server.md). Publishing, pausing and
 * promoting are administrative mutations, so each writes its audit record inside
 * the transaction that makes the change; asking for an update is anonymous and
 * writes nothing but a metric.
 */

export type ReleaseFailure = "unknown-release" | "version-exists" | "already-stable";

export type ReleaseResult<T> =
  Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; reason: ReleaseFailure }>;

export type ReleaseServiceOptions = Readonly<{
  db: Database;
  telemetry: TelemetryService;
  now: () => number;
}>;

function toSummary(entry: ReleaseWithArtifacts): ReleaseSummary {
  return {
    releaseId: entry.release.id,
    version: entry.release.version,
    channel: entry.release.channel,
    notes: entry.release.notes,
    paused: entry.release.paused,
    publishedAt: entry.release.publishedAt.toISOString(),
    artifacts: entry.artifacts.map((artifact) => ({
      target: artifact.target,
      downloadUrl: artifact.downloadUrl,
      sizeBytes: artifact.sizeBytes,
      sha256: artifact.sha256,
    })),
  };
}

export class ReleaseService {
  private readonly db: Database;

  private readonly telemetry: TelemetryService;

  private readonly clock: () => number;

  constructor(options: ReleaseServiceOptions) {
    this.db = options.db;
    this.telemetry = options.telemetry;
    this.clock = options.now;
  }

  /**
   * What a client running `currentVersion` should install, or null when it should
   * install nothing. A paused release is nothing, and so is a release that has no
   * artifact for the platform that asked.
   */
  async manifestFor(
    channel: ReleaseChannel,
    target: UpdateTarget,
    currentVersion: string,
  ): Promise<UpdateManifest | null> {
    const latest = await findLatestRelease(this.db, channel);
    const artifact = latest?.artifacts.find((row) => row.target === target);
    if (!latest || !artifact || !isNewerVersion(latest.release.version, currentVersion)) {
      this.telemetry.metrics.recordUpdateCheck(channel, target, false);
      return null;
    }

    this.telemetry.metrics.recordUpdateCheck(channel, target, true);
    return {
      version: latest.release.version,
      notes: latest.release.notes,
      pub_date: latest.release.publishedAt.toISOString(),
      platforms: { [target]: { signature: artifact.signature, url: artifact.url } },
    };
  }

  /** The newest offered release of each channel, for the download page. */
  async latest(): Promise<LatestReleasesResponse> {
    const [stable, beta] = await Promise.all([
      findLatestRelease(this.db, "stable"),
      findLatestRelease(this.db, "beta"),
    ]);
    return {
      stable: stable === null ? null : toSummary(stable),
      beta: beta === null ? null : toSummary(beta),
    };
  }

  async list(): Promise<readonly ReleaseSummary[]> {
    const rows = await listReleases(this.db, ADMIN_PAGE_SIZE);
    return rows.map(toSummary);
  }

  async publish(
    actor: AdminIdentity,
    request: PublishReleaseRequest,
  ): Promise<ReleaseResult<ReleaseSummary>> {
    const existing = await findReleaseByVersion(this.db, request.channel, request.version);
    if (existing) {
      return { ok: false, reason: "version-exists" };
    }

    const now = new Date(this.clock());
    const published = await this.db.transaction(async (tx) => {
      const release = await insertRelease(tx, {
        version: request.version,
        channel: request.channel,
        notes: request.notes,
        publishedBy: actor.userId,
        publishedAt: now,
        updatedAt: now,
      });
      const artifacts = await insertReleaseArtifacts(
        tx,
        request.artifacts.map((artifact) => ({
          releaseId: release.id,
          target: artifact.target,
          url: artifact.url,
          downloadUrl: artifact.downloadUrl,
          signature: artifact.signature,
          sizeBytes: artifact.sizeBytes,
          sha256: artifact.sha256,
          createdAt: now,
        })),
      );
      await insertAuditRecord(tx, {
        adminUserId: actor.userId,
        action: "release-published",
        targetType: "release",
        targetId: release.id,
        targetLabel: `${request.channel} ${request.version}`,
        before: {},
        after: {
          version: release.version,
          channel: release.channel,
          targets: artifacts.map((artifact) => artifact.target),
        },
        reason: request.reason,
        createdAt: now,
      });
      return { release, artifacts };
    });

    return { ok: true, value: toSummary(published) };
  }

  async setPaused(
    actor: AdminIdentity,
    releaseId: string,
    paused: boolean,
    reason: string,
  ): Promise<ReleaseResult<ReleaseSummary>> {
    const existing = await findReleaseById(this.db, releaseId);
    if (!existing) {
      return { ok: false, reason: "unknown-release" };
    }

    const now = new Date(this.clock());
    await this.db.transaction(async (tx) => {
      await setReleasePaused(tx, releaseId, paused, now);
      await insertAuditRecord(tx, {
        adminUserId: actor.userId,
        action: paused ? "release-paused" : "release-resumed",
        targetType: "release",
        targetId: releaseId,
        targetLabel: `${existing.release.channel} ${existing.release.version}`,
        before: { paused: existing.release.paused },
        after: { paused },
        reason,
        createdAt: now,
      });
    });

    return {
      ok: true,
      value: toSummary({ ...existing, release: { ...existing.release, paused } }),
    };
  }

  /**
   * Promotion moves what the beta channel proved onto stable. It rebuilds nothing
   * and resigns nothing: the artifacts, their digests and their signatures are the
   * ones that were tested.
   */
  async promote(
    actor: AdminIdentity,
    releaseId: string,
    reason: string,
  ): Promise<ReleaseResult<ReleaseSummary>> {
    const existing = await findReleaseById(this.db, releaseId);
    if (!existing) {
      return { ok: false, reason: "unknown-release" };
    }
    if (existing.release.channel === "stable") {
      return { ok: false, reason: "already-stable" };
    }

    const now = new Date(this.clock());
    await this.db.transaction(async (tx) => {
      await promoteRelease(tx, releaseId, now);
      await insertAuditRecord(tx, {
        adminUserId: actor.userId,
        action: "release-promoted",
        targetType: "release",
        targetId: releaseId,
        targetLabel: `stable ${existing.release.version}`,
        before: { channel: existing.release.channel },
        after: { channel: "stable" },
        reason,
        createdAt: now,
      });
    });

    return {
      ok: true,
      value: toSummary({
        artifacts: existing.artifacts,
        release: { ...existing.release, channel: "stable", publishedAt: now },
      }),
    };
  }

  /**
   * A step of the release workflow reporting how it ended. A failed signing or
   * notarization step is the series the paging rule of section 17.4 watches, so it
   * is counted here and logged with the platform that failed.
   */
  recordBuildEvent(event: ReleaseBuildEventRequest): void {
    if (event.outcome === "failed" && (event.step === "sign" || event.step === "notarize")) {
      this.telemetry.metrics.recordSigningFailure(event.target, event.step);
    }
    this.telemetry.recordReleaseBuildEvent(event);
  }
}
