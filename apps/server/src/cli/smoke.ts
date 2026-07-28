import { checkBaseUrl } from "../ops/base-url";
import { formatSmokeReport, runSmoke } from "../ops/smoke";

/**
 * `pnpm --filter @gobblet/server smoke`, run by the deploy workflow against the
 * environment it has just released to. Exits non-zero on any failed check, which is
 * what stops the workflow before the production gate.
 */

const address = checkBaseUrl("SMOKE_BASE_URL", process.env["SMOKE_BASE_URL"]);
if (!address.ok) {
  console.error(address.problem);
  process.exit(2);
}

const expectVersion = process.env["APP_VERSION"];
const expectGitSha = process.env["GIT_SHA"];
const report = await runSmoke({
  baseUrl: address.baseUrl,
  ...(expectVersion !== undefined && expectVersion !== "" ? { expectVersion } : {}),
  ...(expectGitSha !== undefined && expectGitSha !== "" ? { expectGitSha } : {}),
});

console.warn(formatSmokeReport(report));
process.exit(report.ok ? 0 : 1);
