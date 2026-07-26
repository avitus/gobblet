import { formatSmokeReport, runSmoke } from "../ops/smoke";

/**
 * `pnpm --filter @gobblet/server smoke`, run by the deploy workflow against the
 * environment it has just released to. Exits non-zero on any failed check, which is
 * what stops the workflow before the production gate.
 */

const baseUrl = process.env["SMOKE_BASE_URL"];
if (baseUrl === undefined || baseUrl === "") {
  console.error("SMOKE_BASE_URL is required, for example https://staging.example.com");
  process.exit(2);
}

const expectVersion = process.env["APP_VERSION"];
const report = await runSmoke({
  baseUrl,
  ...(expectVersion !== undefined && expectVersion !== "" ? { expectVersion } : {}),
});

console.warn(formatSmokeReport(report));
process.exit(report.ok ? 0 : 1);
