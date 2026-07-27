import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  releaseArtifactSchema,
  RELEASE_CHANNELS,
  UPDATE_TARGETS,
  type ReleaseArtifact,
  type ReleaseChannel,
  type UpdateTarget,
} from "@gobblet/protocol";
import {
  checkDesktopManifest,
  describeDesktopArtifact,
  nodeBundleReader,
  promoteDesktopRelease,
  publishDesktopRelease,
} from "../ops/desktop-release";

/**
 * `pnpm --filter @gobblet/server desktop-release <step>`, called by
 * `.github/workflows/desktop-release.yml`. Each step reads its environment, calls
 * one function from `src/ops/desktop-release.ts` and exits non-zero when it fails,
 * so the workflow stops where the failure is rather than carrying on to publish.
 */

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    console.error(`${name} is required`);
    process.exit(2);
  }
  return value;
}

function target(value: string): UpdateTarget {
  const found = UPDATE_TARGETS.find((candidate) => candidate === value);
  if (found === undefined) {
    console.error(`TARGET must be one of ${UPDATE_TARGETS.join(", ")}`);
    process.exit(2);
  }
  return found;
}

function channel(value: string): ReleaseChannel {
  const found = RELEASE_CHANNELS.find((candidate) => candidate === value);
  if (found === undefined) {
    console.error(`CHANNEL must be one of ${RELEASE_CHANNELS.join(", ")}`);
    process.exit(2);
  }
  return found;
}

async function describe(): Promise<void> {
  const artifact = await describeDesktopArtifact({
    target: target(required("TARGET")),
    directory: required("BUNDLE_DIR"),
    downloadBase: required("DOWNLOAD_BASE"),
    reader: nodeBundleReader,
  });
  await writeFile(required("ARTIFACT_FILE"), `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.warn(`${artifact.target}: ${artifact.downloadUrl} (${String(artifact.sizeBytes)} bytes)`);
}

async function readArtifacts(directory: string): Promise<ReleaseArtifact[]> {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name === "artifact.json")
    .map((entry) => path.join(entry.parentPath, entry.name));
  if (files.length === 0) {
    console.error(`No artifact.json under ${directory}`);
    process.exit(2);
  }
  return Promise.all(
    files.map(async (file) =>
      releaseArtifactSchema.parse(JSON.parse(await readFile(file, "utf8"))),
    ),
  );
}

async function publish(): Promise<void> {
  const version = required("VERSION");
  const artifacts = await readArtifacts(required("ARTIFACTS_DIR"));
  const release = await publishDesktopRelease({
    fetch: globalThis.fetch,
    baseUrl: required("HOST"),
    token: required("TOKEN"),
    version,
    channel: channel(required("CHANNEL")),
    notes: process.env["NOTES"] ?? `Gobblet Online ${version}`,
    artifacts,
    reason:
      process.env["REASON"] ?? `Released by ${process.env["GITHUB_WORKFLOW"] ?? "the workflow"}`,
  });
  console.warn(`Published ${release.version} to ${release.channel} as ${release.releaseId}`);
}

async function check(): Promise<void> {
  const artifacts = await readArtifacts(required("ARTIFACTS_DIR"));
  await checkDesktopManifest({
    fetch: globalThis.fetch,
    baseUrl: required("HOST"),
    version: required("VERSION"),
    channel: channel(required("CHANNEL")),
    targets: artifacts.map((artifact) => artifact.target),
  });
  console.warn("The update endpoint offers this release to an older client");
}

async function promote(): Promise<void> {
  const release = await promoteDesktopRelease({
    fetch: globalThis.fetch,
    baseUrl: required("HOST"),
    token: required("TOKEN"),
    version: required("VERSION"),
    reason: process.env["REASON"] ?? "The staged channel ran clean",
  });
  console.warn(`${release.version} is now ${release.channel}`);
}

const STEPS: Readonly<Record<string, () => Promise<void>>> = Object.freeze({
  describe,
  publish,
  check,
  promote,
});

const step = process.argv[2] ?? "";
const run = STEPS[step];
if (run === undefined) {
  console.error(`Usage: desktop-release <${Object.keys(STEPS).join("|")}>`);
  process.exit(2);
}

try {
  await run();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
