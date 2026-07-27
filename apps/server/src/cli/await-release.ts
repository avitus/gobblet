import { awaitRelease, formatAwaitRelease } from "../ops/release";

/**
 * `pnpm --filter @gobblet/server await-release`, run by the deploy workflow between
 * releasing a build and smoking it. The provider's command returns when the build is
 * finished; this returns when the build is the one answering.
 */

const baseUrl = process.env["RELEASE_BASE_URL"];
if (baseUrl === undefined || baseUrl === "") {
  console.error("RELEASE_BASE_URL is required, for example https://api.example.com");
  process.exit(2);
}

const version = process.env["APP_VERSION"];
if (version === undefined || version === "") {
  console.error("APP_VERSION is required: it is the version this run released");
  process.exit(2);
}

const timeoutSeconds = Number(process.env["RELEASE_TIMEOUT_SECONDS"] ?? "300");
const result = await awaitRelease({ baseUrl, version, timeoutMs: timeoutSeconds * 1000 });

console.warn(formatAwaitRelease(version, result));
process.exit(result.ok ? 0 : 1);
