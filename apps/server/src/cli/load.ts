import { formatLoadReport, judgeLoad, runLoad } from "../ops/load";
import type { LoadPlan } from "../ops/load";
import { createSocketLoadPort } from "../ops/load-socket";
import { openLoadTarget } from "../ops/load-target";

/**
 * `pnpm load [baseUrl]`, the load target of specification section 20.8. The scale
 * comes from the environment because it depends on the host: the default is what a
 * shared runner carries, and the report says so either way
 * (docs/adr/0037-the-load-harness-is-ours.md).
 */

function number(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.error(`${name} must be a positive integer, got ${raw}`);
    process.exit(2);
  }
  return parsed;
}

const target = await openLoadTarget({
  baseUrl: process.argv[2] ?? process.env.LOAD_BASE_URL,
  appVersion: process.env.APP_VERSION ?? "0.1.0",
  gitSha: process.env.GIT_SHA ?? "localdev",
});

const plan: LoadPlan = {
  matches: number("LOAD_MATCHES", 25),
  movesPerMatch: number("LOAD_MOVES_PER_MATCH", 12),
  waveSize: number("LOAD_WAVE_SIZE", 25),
  seed: number("LOAD_SEED", 20_260_727),
};

const port = createSocketLoadPort({
  baseUrl: target.baseUrl,
  clientVersion: process.env.LOAD_CLIENT_VERSION ?? "0.1.0",
  appEnv: process.env.LOAD_APP_ENV ?? "local",
  mode: "casual",
  timeControlSeconds: number("LOAD_TIME_CONTROL_SECONDS", 300),
});

console.warn(
  `Driving ${String(plan.matches * 2)} clients in ${String(plan.matches)} matches against ${target.description}.`,
);

try {
  const summary = await runLoad(port, plan);
  const verdict = judgeLoad(summary);

  console.warn(formatLoadReport(summary, verdict));
  process.exitCode = verdict.ok ? 0 : 1;
} finally {
  await target.stop();
}
