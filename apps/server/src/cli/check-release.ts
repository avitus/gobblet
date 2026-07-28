import { verifyReleaseHappened } from "../ops/release";

/**
 * `pnpm --filter @gobblet/server check-release`, the last job of the deploy workflow.
 * GitHub reports a run whose every release job skipped as a success, so the run says it
 * deployed when it did nothing. This turns that into a failure.
 */

function result(name: string): string {
  const value = process.env[name];
  return value === undefined || value === "" ? "missing" : value;
}

const verdict = verifyReleaseHappened({
  skipStaging: process.env["SKIP_STAGING"] === "true",
  skipProduction: process.env["SKIP_PRODUCTION"] === "true",
  results: {
    staging: result("STAGING_RESULT"),
    production: result("PRODUCTION_RESULT"),
  },
});

console.warn(verdict.detail);
process.exit(verdict.ok ? 0 : 1);
