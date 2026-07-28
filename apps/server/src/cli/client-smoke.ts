import { checkBaseUrl } from "../ops/base-url";
import { formatClientReport, runClientSmoke } from "../ops/client-smoke";

/**
 * `pnpm --filter @gobblet/server client-smoke`, run by the deploy workflow against the
 * client it has just released. Exits non-zero on any failed check.
 */

const address = checkBaseUrl("CLIENT_BASE_URL", process.env["CLIENT_BASE_URL"]);
if (!address.ok) {
  console.error(address.problem);
  process.exit(2);
}

const report = await runClientSmoke({ baseUrl: address.baseUrl });

console.warn(formatClientReport(report));
process.exit(report.ok ? 0 : 1);
