import { describe, expect, it } from "vitest";
import {
  RELEASE_BUILD_STEPS,
  RELEASE_CHANNELS,
  UPDATE_TARGETS,
  adminReleaseListResponseSchema,
  compareVersions,
  isClientVersionSupported,
  isNewerVersion,
  latestReleasesResponseSchema,
  parseVersion,
  pauseReleaseRequestSchema,
  promoteReleaseRequestSchema,
  publishReleaseRequestSchema,
  releaseArtifactSchema,
  releaseBuildEventRequestSchema,
  releaseSummarySchema,
  updateChannelParamsSchema,
  updateManifestSchema,
  updateQuerySchema,
  versionSchema,
  type PublishReleaseRequest,
  type ReleaseArtifact,
} from "../src/index";

const artifact: ReleaseArtifact = {
  target: "darwin-aarch64",
  url: "https://github.com/avitus/gobblet/releases/download/v1.2.0/Gobblet.app.tar.gz",
  downloadUrl:
    "https://github.com/avitus/gobblet/releases/download/v1.2.0/Gobblet_1.2.0_aarch64.dmg",
  signature: "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZQ==",
  sizeBytes: 12_582_912,
  sha256: "a".repeat(64),
};

const publish: PublishReleaseRequest = {
  version: "1.2.0",
  channel: "beta",
  notes: "Faster board loading.",
  artifacts: [artifact],
  reason: "Publishing the release candidate to the staged channel.",
};

describe("release versions", () => {
  it("reads three dotted numbers and refuses anything else", () => {
    expect(parseVersion("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseVersion("1.2")).toBeNull();
    expect(parseVersion("1.2.3-beta")).toBeNull();
    expect(parseVersion("v1.2.3")).toBeNull();
    expect(versionSchema.safeParse("1.2.3").success).toBe(true);
    expect(versionSchema.safeParse("1.2.3-rc.1").success).toBe(false);
  });

  it("orders versions by major, then minor, then patch", () => {
    expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
    expect(compareVersions("1.9.9", "2.0.0")).toBe(-1);
    expect(compareVersions("1.3.0", "1.2.9")).toBe(1);
    expect(compareVersions("1.2.9", "1.3.0")).toBe(-1);
    expect(compareVersions("1.2.4", "1.2.3")).toBe(1);
    expect(compareVersions("1.2.3", "1.2.4")).toBe(-1);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  it("says nothing about a version it cannot read", () => {
    expect(compareVersions("nightly", "1.0.0")).toBeNull();
    expect(compareVersions("1.0.0", "nightly")).toBeNull();
  });

  it("treats an unreadable client version as unsupported", () => {
    expect(isClientVersionSupported("1.0.0", "1.0.0")).toBe(true);
    expect(isClientVersionSupported("1.0.1", "1.0.0")).toBe(true);
    expect(isClientVersionSupported("0.9.9", "1.0.0")).toBe(false);
    expect(isClientVersionSupported("", "1.0.0")).toBe(false);
  });

  it("offers only a strictly newer version", () => {
    expect(isNewerVersion("1.2.1", "1.2.0")).toBe(true);
    expect(isNewerVersion("1.2.0", "1.2.0")).toBe(false);
    expect(isNewerVersion("1.1.0", "1.2.0")).toBe(false);
    expect(isNewerVersion("garbage", "1.2.0")).toBe(false);
  });
});

describe("a release artifact", () => {
  it("accepts one platform's signed bytes", () => {
    expect(releaseArtifactSchema.parse(artifact)).toEqual(artifact);
  });

  it("refuses an artifact that is not served over TLS", () => {
    const result = releaseArtifactSchema.safeParse({
      ...artifact,
      url: "http://example.com/Gobblet.app.tar.gz",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("an artifact must be served over TLS");
  });

  it("refuses an artifact without a signature, which is what makes one unpublishable", () => {
    expect(releaseArtifactSchema.safeParse({ ...artifact, signature: "" }).success).toBe(false);
    expect(releaseArtifactSchema.safeParse({ ...artifact, signature: "not base64!" }).success).toBe(
      false,
    );
    const { signature: _signature, ...unsigned } = artifact;
    expect(releaseArtifactSchema.safeParse(unsigned).success).toBe(false);
  });

  it("refuses a digest that is not a SHA-256, and a size that is not positive", () => {
    expect(releaseArtifactSchema.safeParse({ ...artifact, sha256: "abc" }).success).toBe(false);
    expect(releaseArtifactSchema.safeParse({ ...artifact, sha256: "A".repeat(64) }).success).toBe(
      false,
    );
    expect(releaseArtifactSchema.safeParse({ ...artifact, sizeBytes: 0 }).success).toBe(false);
  });

  it("names only the platforms a desktop artifact is built for", () => {
    expect([...UPDATE_TARGETS]).toEqual(["darwin-aarch64", "darwin-x86_64", "windows-x86_64"]);
    expect(releaseArtifactSchema.safeParse({ ...artifact, target: "linux-x86_64" }).success).toBe(
      false,
    );
  });
});

describe("publishing a release", () => {
  it("accepts a version, a channel, notes and at least one artifact", () => {
    expect(publishReleaseRequestSchema.parse(publish)).toEqual(publish);
  });

  it("requires a reason long enough to be a sentence", () => {
    expect(publishReleaseRequestSchema.safeParse({ ...publish, reason: "because" }).success).toBe(
      false,
    );
  });

  it("refuses an empty artifact list and more artifacts than there are platforms", () => {
    expect(publishReleaseRequestSchema.safeParse({ ...publish, artifacts: [] }).success).toBe(
      false,
    );
    const tooMany = UPDATE_TARGETS.map((target) => ({ ...artifact, target })).concat([artifact]);
    expect(publishReleaseRequestSchema.safeParse({ ...publish, artifacts: tooMany }).success).toBe(
      false,
    );
  });

  it("knows two channels and no others", () => {
    expect([...RELEASE_CHANNELS]).toEqual(["stable", "beta"]);
    expect(publishReleaseRequestSchema.safeParse({ ...publish, channel: "nightly" }).success).toBe(
      false,
    );
    expect(updateChannelParamsSchema.parse({ channel: "stable" })).toEqual({ channel: "stable" });
    expect(updateChannelParamsSchema.safeParse({ channel: "internal" }).success).toBe(false);
  });

  it("requires a reason to pause, to resume and to promote", () => {
    expect(
      pauseReleaseRequestSchema.parse({ paused: true, reason: "Crash on the Windows build." }),
    ).toEqual({ paused: true, reason: "Crash on the Windows build." });
    expect(pauseReleaseRequestSchema.safeParse({ paused: false }).success).toBe(false);
    expect(promoteReleaseRequestSchema.safeParse({ reason: "short" }).success).toBe(false);
  });
});

describe("what a release looks like when it is read back", () => {
  const summary = {
    releaseId: "6f1a1f16-6b16-4a2f-95f8-1a9b0f7f0b21",
    version: "1.2.0",
    channel: "stable" as const,
    notes: "Faster board loading.",
    paused: false,
    publishedAt: "2026-07-26T10:00:00.000Z",
    artifacts: [
      {
        target: "darwin-aarch64" as const,
        downloadUrl: artifact.downloadUrl,
        sizeBytes: artifact.sizeBytes,
        sha256: artifact.sha256,
      },
    ],
  };

  it("carries the digest a person can check by hand, and no signature", () => {
    expect(releaseSummarySchema.parse(summary)).toEqual(summary);
    expect(
      releaseSummarySchema.safeParse({
        ...summary,
        artifacts: [{ ...summary.artifacts[0], signature: artifact.signature }],
      }).success,
    ).toBe(false);
  });

  it("lets a channel be empty, because a product may have no beta", () => {
    expect(latestReleasesResponseSchema.parse({ stable: summary, beta: null })).toEqual({
      stable: summary,
      beta: null,
    });
    expect(adminReleaseListResponseSchema.parse({ releases: [summary] }).releases).toHaveLength(1);
  });
});

describe("the manifest the updater reads", () => {
  const manifest = {
    version: "1.2.0",
    notes: "Faster board loading.",
    pub_date: "2026-07-26T10:00:00.000Z",
    platforms: {
      "darwin-aarch64": { signature: artifact.signature, url: artifact.url },
    },
  };

  it("is Tauri's shape, spelling and all", () => {
    expect(updateManifestSchema.parse(manifest)).toEqual(manifest);
  });

  it("refuses a platform it does not build for and a manifest without a date", () => {
    expect(
      updateManifestSchema.safeParse({
        ...manifest,
        platforms: { "linux-x86_64": { signature: artifact.signature, url: artifact.url } },
      }).success,
    ).toBe(false);
    const { pub_date: _date, ...undated } = manifest;
    expect(updateManifestSchema.safeParse(undated).success).toBe(false);
  });

  it("reads the target and the running version the updater substitutes", () => {
    expect(updateQuerySchema.parse({ target: "windows-x86_64", currentVersion: "1.1.0" })).toEqual({
      target: "windows-x86_64",
      currentVersion: "1.1.0",
    });
    expect(
      updateQuerySchema.safeParse({ target: "windows-x86_64", currentVersion: "latest" }).success,
    ).toBe(false);
  });
});

describe("a build event from the release workflow", () => {
  it("names the ordered steps of a desktop release", () => {
    expect([...RELEASE_BUILD_STEPS]).toEqual(["bundle", "sign", "notarize", "publish"]);
  });

  it("carries the step, the platform and how it ended", () => {
    const event = {
      version: "1.2.0",
      target: "darwin-aarch64" as const,
      step: "sign" as const,
      outcome: "failed" as const,
      detail: "No Developer ID Application certificate in the keychain.",
    };

    expect(releaseBuildEventRequestSchema.parse(event)).toEqual(event);
    expect(releaseBuildEventRequestSchema.safeParse({ ...event, step: "upload" }).success).toBe(
      false,
    );
    expect(releaseBuildEventRequestSchema.safeParse({ ...event, outcome: "maybe" }).success).toBe(
      false,
    );
  });
});
