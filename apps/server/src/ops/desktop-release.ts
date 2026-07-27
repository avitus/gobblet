import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  adminReleaseListResponseSchema,
  latestReleasesResponseSchema,
  releaseArtifactSchema,
  releaseSummarySchema,
  updateManifestSchema,
} from "@gobblet/protocol";
import type {
  ReleaseArtifact,
  ReleaseChannel,
  ReleaseSummary,
  UpdateTarget,
} from "@gobblet/protocol";

/**
 * What the desktop release workflow does between the bundler and the API: read what
 * was built, publish it, ask the endpoint whether it would offer it, and promote it.
 *
 * It lives here rather than in the YAML for the reason the smoke checks do: a step
 * that only ever runs during a release is a step that is never exercised, so the
 * workflow keeps the ordering and the secrets and this keeps the logic, which is
 * proved in `test/desktop-release.test.ts` against injected bytes and an injected
 * `fetch` (docs/adr/0035-installers-live-in-github-releases.md).
 */

/** The filesystem the bundle is read from. Injected so the tests need no disk. */
export type BundleReader = Readonly<{
  list(directory: string): Promise<readonly string[]>;
  read(file: string): Promise<Uint8Array>;
}>;

export const nodeBundleReader: BundleReader = {
  async list(directory) {
    const entries = await readdir(directory, { recursive: true, withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(entry.parentPath, entry.name));
  },
  async read(file) {
    return new Uint8Array(await readFile(file));
  },
};

type TargetShape = Readonly<{
  /** The bundle the updater downloads and verifies against the public key. */
  update: string;
  /** The file a person downloads. On Windows it is the same installer. */
  installer: string;
}>;

const SHAPES: Readonly<Record<UpdateTarget, TargetShape>> = Object.freeze({
  "darwin-aarch64": { update: ".app.tar.gz", installer: ".dmg" },
  "darwin-x86_64": { update: ".app.tar.gz", installer: ".dmg" },
  "windows-x86_64": { update: "-setup.exe", installer: "-setup.exe" },
});

export type DescribeArtifactOptions = Readonly<{
  target: UpdateTarget;
  /** The bundler's output directory, searched recursively. */
  directory: string;
  /** Where the assets will be served from, without a trailing slash. */
  downloadBase: string;
  /** The real one is `nodeBundleReader`; the tests pass their own bytes. */
  reader: BundleReader;
}>;

function only(files: readonly string[], suffix: string, kind: string): string {
  const matches = files.filter((file) => file.endsWith(suffix));
  if (matches.length === 0) {
    throw new Error(`The bundler produced no ${kind} ending in ${suffix}`);
  }
  if (matches.length > 1) {
    throw new Error(`The bundler produced ${matches.length} files ending in ${suffix}`);
  }
  return matches[0] as string;
}

function assetUrl(downloadBase: string, file: string): string {
  return `${downloadBase.replace(/\/+$/, "")}/${encodeURIComponent(path.basename(file))}`;
}

/**
 * Reads one platform's output into the artifact the API is given. The signature is
 * read from the `.sig` Tauri writes beside the update bundle; there is no branch
 * here that produces an artifact without one, so an unsigned build cannot be
 * described, let alone published.
 *
 * `sha256` and `sizeBytes` describe the installer at `downloadUrl`, because that is
 * the file a person downloads and can check. The updater checks `url` with the
 * signature instead.
 */
export async function describeDesktopArtifact(
  options: DescribeArtifactOptions,
): Promise<ReleaseArtifact> {
  const reader = options.reader;
  const shape = SHAPES[options.target];
  const files = await reader.list(options.directory);

  const update = only(files, shape.update, "update bundle");
  const installer =
    shape.installer === shape.update ? update : only(files, shape.installer, "installer");
  const signatureFile = `${update}.sig`;
  if (!files.includes(signatureFile)) {
    throw new Error(`No signature beside ${path.basename(update)}. The build was not signed.`);
  }

  const [signature, bytes] = await Promise.all([
    reader.read(signatureFile),
    reader.read(installer),
  ]);

  return releaseArtifactSchema.parse({
    target: options.target,
    url: assetUrl(options.downloadBase, update),
    downloadUrl: assetUrl(options.downloadBase, installer),
    signature: new TextDecoder().decode(signature).trim(),
    sizeBytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}

type Caller = Readonly<{ baseUrl: string; token?: string; fetch: typeof globalThis.fetch }>;

async function call(caller: Caller, method: string, route: string, body?: unknown): Promise<Json> {
  const response = await caller.fetch(`${caller.baseUrl.replace(/\/+$/, "")}${route}`, {
    method,
    headers: {
      ...(caller.token === undefined ? {} : { authorization: `Bearer ${caller.token}` }),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `${method} ${route} answered ${String(response.status)}: ${text.slice(0, 500)}`,
    );
  }
  return text === "" ? {} : (JSON.parse(text) as Json);
}

type Json = Record<string, unknown>;

export type PublishOptions = Caller &
  Readonly<{
    version: string;
    channel: ReleaseChannel;
    notes: string;
    artifacts: readonly ReleaseArtifact[];
    reason: string;
  }>;

/** Records the built artifacts as a release. The assets are already public. */
export async function publishDesktopRelease(options: PublishOptions): Promise<ReleaseSummary> {
  const body = await call(options, "POST", "/v1/admin/releases", {
    version: options.version,
    channel: options.channel,
    notes: options.notes,
    artifacts: options.artifacts,
    reason: options.reason,
  });
  return releaseSummarySchema.parse(body);
}

export type ManifestCheckOptions = Caller &
  Readonly<{
    version: string;
    channel: ReleaseChannel;
    targets: readonly UpdateTarget[];
    /** The version the imagined client is running. Anything older than the release. */
    from?: string;
  }>;

/**
 * Asks the update endpoint what a client older than this release would be offered,
 * for every platform that was built. This is the check that a publication actually
 * reaches an updater rather than merely landing in a table.
 */
export async function checkDesktopManifest(options: ManifestCheckOptions): Promise<void> {
  const from = options.from ?? "0.0.1";
  for (const target of options.targets) {
    const query = `target=${target}&currentVersion=${from}`;
    const body = await call(options, "GET", `/v1/updates/${options.channel}?${query}`);
    // The endpoint answers 204 when it has nothing, which is a success to `fetch`
    // and a failed release to us.
    if (Object.keys(body).length === 0) {
      throw new Error(`${options.channel} offers nothing to a ${target} client running ${from}`);
    }
    const manifest = updateManifestSchema.parse(body);
    if (manifest.version !== options.version) {
      throw new Error(
        `${options.channel} offers ${manifest.version} to a ${target} client, not ${options.version}`,
      );
    }
    if (manifest.platforms[target] === undefined) {
      throw new Error(`The ${options.channel} manifest has nothing for ${target}`);
    }
  }
}

export type PromoteOptions = Caller & Readonly<{ version: string; reason: string }>;

/** Finds the release by version and promotes it to stable. */
export async function promoteDesktopRelease(options: PromoteOptions): Promise<ReleaseSummary> {
  const listed = adminReleaseListResponseSchema.parse(
    await call(options, "GET", "/v1/admin/releases"),
  );
  const release = listed.releases.find((candidate) => candidate.version === options.version);
  if (release === undefined) {
    throw new Error(`No release ${options.version} to promote`);
  }
  if (release.channel === "stable") {
    return release;
  }

  const body = await call(options, "POST", `/v1/admin/releases/${release.releaseId}/promote`, {
    reason: options.reason,
  });
  return releaseSummarySchema.parse(body);
}

/** Reads the published channels, for a workflow summary or a manual check. */
export async function readLatestReleases(caller: Caller): Promise<{
  stable: ReleaseSummary | null;
  beta: ReleaseSummary | null;
}> {
  return latestReleasesResponseSchema.parse(await call(caller, "GET", "/v1/releases/latest"));
}
