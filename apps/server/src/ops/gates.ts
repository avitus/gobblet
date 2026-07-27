/**
 * The twenty-five quality gates of spec section 21, as a definition rather than a
 * list somebody reads (docs/adr/0038-quality-gates-are-a-definition-not-a-checklist.md).
 * A gate either names the command that proves it here, or names what it is waiting
 * for. `pnpm gates` runs the first kind and reports the second kind as deferred,
 * never as passed.
 */

export type GateSet = "pull-request" | "release-candidate";

export type GateDefinition = Readonly<{
  /** Stable identifier, used by the report and by the exit-criteria test. */
  id: string;
  set: GateSet;
  /** The clause of section 21, quoted. */
  clause: string;
  /** What running it proves, in one line. */
  proves: string;
  /** The command, from the repository root, or null when nothing here can prove it. */
  command: readonly string[] | null;
  /** Required when `command` is null: what the gate is waiting for. */
  deferred?: string;
  /** For a pull-request gate, the step of `.github/workflows/ci.yml` that runs it. */
  workflowStep?: string;
}>;

export const GATE_DEFINITIONS: readonly GateDefinition[] = Object.freeze([
  {
    id: "typecheck",
    set: "pull-request",
    clause: "Type checking passes.",
    proves: "Every workspace compiles under the strict configuration.",
    command: ["pnpm", "typecheck"],
    workflowStep: "Typecheck",
  },
  {
    id: "lint",
    set: "pull-request",
    clause: "Lint passes.",
    proves: "The boundary rules of architecture section 6 hold, along with the style rules.",
    command: ["pnpm", "lint"],
    workflowStep: "Lint",
  },
  {
    id: "format",
    set: "pull-request",
    clause: "Formatting check passes.",
    proves: "Every tracked file is formatted as Prettier would write it.",
    command: ["pnpm", "format:check"],
    workflowStep: "Formatting",
  },
  {
    id: "unit-tests",
    set: "pull-request",
    clause: "Unit tests pass.",
    proves: "Every suite in the workspace passes with its coverage thresholds.",
    command: ["pnpm", "test:coverage"],
    workflowStep: "Tests with coverage gates",
  },
  {
    id: "game-core-coverage",
    set: "pull-request",
    clause: "Game-core coverage remains 100%.",
    proves: "The rules engine is fully covered; its own threshold fails the run otherwise.",
    command: ["pnpm", "--filter", "@gobblet/game-core", "run", "test:coverage"],
    workflowStep: "Tests with coverage gates",
  },
  {
    id: "protocol-compatibility",
    set: "pull-request",
    clause: "Protocol compatibility tests pass.",
    proves: "The shared schemas still accept what the server sends and refuse what it must refuse.",
    command: ["pnpm", "--filter", "@gobblet/protocol", "run", "test"],
    workflowStep: "Tests with coverage gates",
  },
  {
    id: "migration-validation",
    set: "pull-request",
    clause: "Database migration validation passes.",
    proves: "Every migration applies in order to an empty database and matches the schema.",
    command: ["pnpm", "--filter", "@gobblet/db", "run", "test"],
    workflowStep: "Tests with coverage gates",
  },
  {
    id: "dependency-audit",
    set: "pull-request",
    clause: "Dependency vulnerability threshold passes.",
    proves: "No dependency carries a known advisory at high severity or above.",
    command: ["pnpm", "audit", "--audit-level", "high", "--prod"],
    workflowStep: "Dependency advisories",
  },
  {
    id: "secret-scan",
    set: "pull-request",
    clause: "No secrets detected.",
    proves: "No tracked file carries a credential, outside the reviewed allowlist.",
    command: ["pnpm", "ops:secrets"],
    workflowStep: "Secret scan",
  },
  {
    id: "adr-present",
    set: "pull-request",
    clause: "Required ADR added for architectural changes.",
    proves: "Whether a change needed a decision record is a judgement a reviewer makes.",
    command: null,
    deferred: "Human review. The index in docs/adr/README.md is what a reviewer checks against.",
  },
  {
    id: "no-critical-defects",
    set: "release-candidate",
    clause: "Zero known critical defects.",
    proves: "The defect register holds no open row at critical severity.",
    command: ["pnpm", "ops:defects"],
  },
  {
    id: "no-high-defects",
    set: "release-candidate",
    clause: "Zero known high-severity defects.",
    proves: "The defect register holds no open row at high severity.",
    command: ["pnpm", "ops:defects"],
  },
  {
    id: "critical-journeys",
    set: "release-candidate",
    clause: "All critical end-to-end journeys pass.",
    proves: "The browser suite plays every journey of section 20.6 in two engines.",
    command: ["pnpm", "test:e2e"],
  },
  {
    id: "official-rules",
    set: "release-candidate",
    clause: "All official rules acceptance tests pass.",
    proves: "Every rule of docs/rules.md is asserted by the game-core suite.",
    command: ["pnpm", "--filter", "@gobblet/game-core", "run", "test"],
  },
  {
    id: "property-nightly",
    set: "release-candidate",
    clause: "Property test nightly suite passes.",
    proves: "A hundred thousand generated transitions keep every invariant.",
    command: ["pnpm", "test:properties:nightly"],
  },
  {
    id: "load-target",
    set: "release-candidate",
    clause: "Load target passes.",
    proves: "Sessions play concurrently within the latency budget, losing no committed move.",
    command: ["pnpm", "load"],
  },
  {
    id: "backup-restore",
    set: "release-candidate",
    clause: "Backup restore succeeds.",
    proves: "A dump restores into another database and reads back identically.",
    command: ["pnpm", "--filter", "@gobblet/db", "run", "test"],
  },
  {
    id: "restart-recovery",
    set: "release-candidate",
    clause: "Active-match restart recovery succeeds.",
    proves: "A match survives the process being replaced and re-synchronises.",
    command: ["pnpm", "--filter", "@gobblet/server", "run", "test"],
  },
  {
    id: "macos-signed",
    set: "release-candidate",
    clause: "macOS binary signed and notarized.",
    proves: "The workflow signs, notarizes and staples when the identity exists.",
    command: null,
    deferred:
      "An Apple Developer Program membership, a Developer ID certificate and a notarization password. See operations.md section 13.",
  },
  {
    id: "windows-signed",
    set: "release-candidate",
    clause: "Windows binary signed.",
    proves: "The workflow signs the installer when the certificate exists.",
    command: null,
    deferred:
      "An organisation-validated or extended-validation code-signing certificate. See operations.md section 13.",
  },
  {
    id: "auto-update",
    set: "release-candidate",
    clause: "Auto-update works from prior public version.",
    proves: "An older client is offered the release and installs it.",
    command: null,
    deferred:
      "A published prior version. The endpoint half is proved by phase8-exit-criteria.test.ts; the install half needs a signed build on a clean machine.",
  },
  {
    id: "release-marker",
    set: "release-candidate",
    clause: "Error-monitoring release marker present.",
    proves: "Every report carries the version and commit of the build that produced it.",
    command: ["pnpm", "--filter", "@gobblet/server", "run", "test"],
  },
  {
    id: "rollback-tested",
    set: "release-candidate",
    clause: "Rollback procedure tested.",
    proves: "The smoke check refuses a deployment serving a version other than the one released.",
    command: ["pnpm", "--filter", "@gobblet/server", "run", "test"],
  },
  {
    id: "admin-audit",
    set: "release-candidate",
    clause: "Admin suspension and audit log tested.",
    proves: "A suspension and its audit record are written together, or neither is.",
    command: ["pnpm", "--filter", "@gobblet/server", "run", "test"],
  },
  {
    id: "legal-pages",
    set: "release-candidate",
    clause: "Privacy and terms pages published.",
    proves: "Both pages render from the shipped build and are reachable without a session.",
    command: ["pnpm", "--filter", "@gobblet/web", "run", "test"],
  },
]);

export type GateOutcome = "passed" | "failed" | "deferred";

export type GateResult = Readonly<{
  id: string;
  set: GateSet;
  outcome: GateOutcome;
  detail: string;
  durationMs: number;
}>;

export type GateReport = Readonly<{
  ok: boolean;
  results: readonly GateResult[];
}>;

/** Runs one command and says whether it succeeded. Injected so tests spawn nothing. */
export type CommandRunner = (
  command: readonly string[],
) => Promise<Readonly<{ ok: boolean; detail: string }>>;

export type GateRunOptions = Readonly<{
  run: CommandRunner;
  now: () => number;
  /** Restrict the run to one set, which is what a pull request wants. */
  set?: GateSet;
  /** Gates whose command is the same are run once; a repeat reuses the outcome. */
  definitions?: readonly GateDefinition[];
}>;

export async function runGates(options: GateRunOptions): Promise<GateReport> {
  const definitions = (options.definitions ?? GATE_DEFINITIONS).filter(
    (definition) => options.set === undefined || definition.set === options.set,
  );
  const seen = new Map<string, Readonly<{ ok: boolean; detail: string; durationMs: number }>>();
  const results: GateResult[] = [];

  for (const definition of definitions) {
    if (definition.command === null) {
      results.push({
        id: definition.id,
        set: definition.set,
        outcome: "deferred",
        detail: definition.deferred ?? "",
        durationMs: 0,
      });
      continue;
    }

    const key = definition.command.join(" ");
    // Several gates are proved by the same suite. Running it once is the difference
    // between a report that finishes and one nobody waits for.
    const previous = seen.get(key);
    const outcome = previous ?? (await timed(options, definition.command));
    seen.set(key, outcome);
    results.push({
      id: definition.id,
      set: definition.set,
      outcome: outcome.ok ? "passed" : "failed",
      detail: previous === undefined ? outcome.detail : `${outcome.detail} (already run)`,
      durationMs: outcome.durationMs,
    });
  }

  return {
    ok: results.every((result) => result.outcome !== "failed"),
    results,
  };
}

async function timed(
  options: GateRunOptions,
  command: readonly string[],
): Promise<Readonly<{ ok: boolean; detail: string; durationMs: number }>> {
  const started = options.now();
  const outcome = await options.run(command);
  return { ...outcome, durationMs: options.now() - started };
}

const SYMBOLS: Readonly<Record<GateOutcome, string>> = Object.freeze({
  passed: "pass",
  failed: "FAIL",
  deferred: "defer",
});

export function formatGateReport(report: GateReport): string {
  const lines = report.results.map((result) => {
    const definition = GATE_DEFINITIONS.find((candidate) => candidate.id === result.id);
    const duration = result.durationMs === 0 ? "" : ` ${String(result.durationMs)}ms`;
    const detail = result.detail === "" ? "" : `\n        ${result.detail}`;
    return `  ${SYMBOLS[result.outcome].padEnd(5)} ${result.id.padEnd(24)} ${definition?.clause ?? ""}${duration}${detail}`;
  });
  const deferred = report.results.filter((result) => result.outcome === "deferred").length;
  const failed = report.results.filter((result) => result.outcome === "failed").length;
  const passed = report.results.filter((result) => result.outcome === "passed").length;

  return [
    "Quality gates, specification section 21",
    ...lines,
    `  ${String(passed)} passed, ${String(failed)} failed, ${String(deferred)} deferred`,
  ].join("\n");
}
