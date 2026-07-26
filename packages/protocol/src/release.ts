import { z } from "zod";
import { auditReasonSchema } from "./admin";
import {
  BUILD_OUTCOMES,
  RELEASE_BUILD_STEPS,
  RELEASE_CHANNELS,
  RELEASE_NOTES_MAX_LENGTH,
  UPDATE_TARGETS,
} from "./constants";
import { isoTimestampSchema, uuidSchema } from "./primitives";

/**
 * The desktop release contract of docs/product-spec.md sections 22.3 and 24. A
 * release is a row with one artifact per platform, the updater asks this server for
 * it, and pausing or promoting is an audited administrative mutation
 * (docs/adr/0034-updates-are-asked-of-our-own-server.md).
 */

const VERSION_PATTERN = /^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)$/;

/** Three dotted numbers. A release version is not a range and not a tag. */
export const versionSchema = z.string().regex(VERSION_PATTERN);

export type Version = Readonly<{ major: number; minor: number; patch: number }>;

export function parseVersion(value: string): Version | null {
  const groups = VERSION_PATTERN.exec(value)?.groups;
  if (!groups) {
    return null;
  }
  return {
    major: Number(groups.major),
    minor: Number(groups.minor),
    patch: Number(groups.patch),
  };
}

/**
 * Orders two dotted versions, or returns `null` when either cannot be read. Both
 * the handshake's minimum-version check and the updater's "is this newer" question
 * are this one comparison, so they cannot disagree.
 */
export function compareVersions(left: string, right: string): number | null {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) {
    return null;
  }
  if (a.major !== b.major) {
    return a.major > b.major ? 1 : -1;
  }
  if (a.minor !== b.minor) {
    return a.minor > b.minor ? 1 : -1;
  }
  if (a.patch !== b.patch) {
    return a.patch > b.patch ? 1 : -1;
  }
  return 0;
}

/**
 * Whether a client is old enough to be refused. An unreadable version counts as
 * unsupported, because a client that cannot name its version is broken.
 */
export function isClientVersionSupported(clientVersion: string, minimum: string): boolean {
  const order = compareVersions(clientVersion, minimum);
  return order !== null && order >= 0;
}

/** Whether `candidate` is something a client running `current` should be offered. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const order = compareVersions(candidate, current);
  return order !== null && order > 0;
}

/** A minisign signature as Tauri writes it beside a bundle: base64, one line. */
const updateSignatureSchema = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .regex(/^[A-Za-z0-9+/=]+$/);

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

const artifactUrlSchema = z.url().refine((value) => value.startsWith("https://"), {
  message: "an artifact must be served over TLS",
});

/**
 * One platform's bytes. The signature is required by the schema, which is what
 * makes an unsigned artifact unpublishable rather than merely discouraged
 * (docs/adr/0036-signing-is-a-workflow-step-that-fails-loudly.md).
 */
export const releaseArtifactSchema = z.strictObject({
  target: z.enum(UPDATE_TARGETS),
  url: artifactUrlSchema,
  /** The installer a person downloads, which is not the bundle the updater installs. */
  downloadUrl: artifactUrlSchema,
  signature: updateSignatureSchema,
  sizeBytes: z.int().positive(),
  sha256: sha256Schema,
});

export type ReleaseArtifact = z.infer<typeof releaseArtifactSchema>;

export const publishReleaseRequestSchema = z.strictObject({
  version: versionSchema,
  channel: z.enum(RELEASE_CHANNELS),
  notes: z.string().trim().min(1).max(RELEASE_NOTES_MAX_LENGTH),
  artifacts: z.array(releaseArtifactSchema).min(1).max(UPDATE_TARGETS.length),
  reason: auditReasonSchema,
});

export type PublishReleaseRequest = z.infer<typeof publishReleaseRequestSchema>;

export const pauseReleaseRequestSchema = z.strictObject({
  paused: z.boolean(),
  reason: auditReasonSchema,
});

export const promoteReleaseRequestSchema = z.strictObject({ reason: auditReasonSchema });

export const releaseSummarySchema = z.strictObject({
  releaseId: uuidSchema,
  version: versionSchema,
  channel: z.enum(RELEASE_CHANNELS),
  notes: z.string(),
  paused: z.boolean(),
  publishedAt: isoTimestampSchema,
  artifacts: z.array(
    z.strictObject({
      target: z.enum(UPDATE_TARGETS),
      downloadUrl: artifactUrlSchema,
      sizeBytes: z.int().positive(),
      sha256: sha256Schema,
    }),
  ),
});

export type ReleaseSummary = z.infer<typeof releaseSummarySchema>;

/** What the download page reads: the newest unpaused release of each channel. */
export const latestReleasesResponseSchema = z.strictObject({
  stable: releaseSummarySchema.nullable(),
  beta: releaseSummarySchema.nullable(),
});

export type LatestReleasesResponse = z.infer<typeof latestReleasesResponseSchema>;

export const adminReleaseListResponseSchema = z.strictObject({
  releases: z.array(releaseSummarySchema),
});

/**
 * The manifest Tauri's updater expects, in its own spelling. Nothing else in this
 * package uses snake case; this shape belongs to the updater, not to us.
 */
export const updateManifestSchema = z.strictObject({
  version: versionSchema,
  notes: z.string(),
  pub_date: isoTimestampSchema,
  /** Partial: a manifest answers the platform that asked, not every platform. */
  platforms: z.partialRecord(
    z.enum(UPDATE_TARGETS),
    z.strictObject({ signature: updateSignatureSchema, url: artifactUrlSchema }),
  ),
});

export type UpdateManifest = z.infer<typeof updateManifestSchema>;

/** What the updater sends: Tauri fills both from its own endpoint template. */
export const updateQuerySchema = z.strictObject({
  target: z.enum(UPDATE_TARGETS),
  currentVersion: versionSchema,
});

export const updateChannelParamsSchema = z.strictObject({
  channel: z.enum(RELEASE_CHANNELS),
});

/**
 * A step of the release workflow reporting how it ended. A failed `sign` or
 * `notarize` is what makes `gobblet_desktop_signing_failures_total` a real series,
 * so the paging rule of section 17.4 is no longer waiting for Phase 8.
 */
export const releaseBuildEventRequestSchema = z.strictObject({
  version: versionSchema,
  target: z.enum(UPDATE_TARGETS),
  step: z.enum(RELEASE_BUILD_STEPS),
  outcome: z.enum(BUILD_OUTCOMES),
  detail: z.string().trim().max(500).optional(),
});

export type ReleaseBuildEventRequest = z.infer<typeof releaseBuildEventRequestSchema>;
