import { checkBaseUrl } from "../ops/base-url";
import { awaitRelease, formatAwaitRelease } from "../ops/release";

/**
 * `pnpm --filter @gobblet/server await-release`, run by the deploy workflow between
 * releasing a build and smoking it. The provider's command returns when the build is
 * finished; this returns when the build is the one answering.
 */

const address = checkBaseUrl("RELEASE_BASE_URL", process.env["RELEASE_BASE_URL"]);
if (!address.ok) {
  console.error(address.problem);
  process.exit(2);
}

const version = process.env["APP_VERSION"];
if (version === undefined || version === "") {
  console.error("APP_VERSION is required: it is the version this run released");
  process.exit(2);
}

const gitSha = process.env["GIT_SHA"];
const released = gitSha === undefined || gitSha === "" ? version : `${version} at ${gitSha}`;
const timeoutSeconds = Number(process.env["RELEASE_TIMEOUT_SECONDS"] ?? "300");

console.warn(`Waiting for ${released} to be the build serving ${address.baseUrl}.`);

const result = await awaitRelease({
  baseUrl: address.baseUrl,
  version,
  ...(gitSha === undefined || gitSha === "" ? {} : { gitSha }),
  timeoutMs: timeoutSeconds * 1000,
  onAttempt: (attempt, detail) => {
    console.warn(`  attempt ${String(attempt)}: ${detail}`);
  },
});

console.warn(formatAwaitRelease(released, result));
process.exit(result.ok ? 0 : 1);
