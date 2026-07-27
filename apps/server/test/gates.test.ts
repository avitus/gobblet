import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GATE_DEFINITIONS, formatGateReport, runGates } from "../src/ops/gates";
import type { CommandRunner, GateDefinition } from "../src/ops/gates";

/**
 * Two things are asserted here. The runner behaves: it de-duplicates commands, it
 * reports a gate with no command as deferred rather than passed, and one failure
 * fails the run. And the definition is closed over specification sections 21.1 and
 * 21.2, so a clause cannot be dropped by deleting a line (appendix P9.3).
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SPEC = path.resolve(HERE, "../../../docs/product-spec.md");
const CI_WORKFLOW = path.resolve(HERE, "../../../.github/workflows/ci.yml");

function definition(
  overrides: Partial<GateDefinition> & Pick<GateDefinition, "id">,
): GateDefinition {
  return {
    set: "pull-request",
    clause: "A clause.",
    proves: "Something.",
    command: ["pnpm", overrides.id],
    ...overrides,
  };
}

function runnerOver(outcomes: Readonly<Record<string, boolean>>): {
  run: CommandRunner;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    run: (command) => {
      const key = command.join(" ");
      calls.push(key);
      return Promise.resolve({
        ok: outcomes[key] ?? true,
        detail: (outcomes[key] ?? true) ? "" : "output",
      });
    },
  };
}

function clock(): () => number {
  let current = 1_000;
  return () => {
    current += 250;
    return current;
  };
}

describe("running the gates", () => {
  it("passes when every command succeeds", async () => {
    const { run } = runnerOver({});

    const report = await runGates({
      run,
      now: clock(),
      definitions: [definition({ id: "one" }), definition({ id: "two" })],
    });

    expect(report.ok).toBe(true);
    expect(report.results.map((result) => result.outcome)).toEqual(["passed", "passed"]);
  });

  it("times each gate", async () => {
    const { run } = runnerOver({});

    const report = await runGates({ run, now: clock(), definitions: [definition({ id: "one" })] });

    expect(report.results[0]?.durationMs).toBe(250);
  });

  it("fails the run when one command fails, and keeps going", async () => {
    const { run } = runnerOver({ "pnpm two": false });

    const report = await runGates({
      run,
      now: clock(),
      definitions: [
        definition({ id: "one" }),
        definition({ id: "two" }),
        definition({ id: "three" }),
      ],
    });

    expect(report.ok).toBe(false);
    expect(report.results.map((result) => result.outcome)).toEqual(["passed", "failed", "passed"]);
    expect(report.results[1]?.detail).toBe("output");
  });

  it("runs a shared command once and reuses the outcome", async () => {
    const { run, calls } = runnerOver({});
    const shared = ["pnpm", "test"] as const;

    const report = await runGates({
      run,
      now: clock(),
      definitions: [
        definition({ id: "one", command: shared }),
        definition({ id: "two", command: shared }),
      ],
    });

    expect(calls).toEqual(["pnpm test"]);
    expect(report.results[1]?.detail).toBe(" (already run)");
    expect(report.results[1]?.outcome).toBe("passed");
  });

  it("reports a gate with no command as deferred, never as passed", async () => {
    const { run, calls } = runnerOver({});

    const report = await runGates({
      run,
      now: clock(),
      definitions: [definition({ id: "one", command: null, deferred: "A signing certificate." })],
    });

    expect(calls).toEqual([]);
    expect(report.results[0]?.outcome).toBe("deferred");
    expect(report.results[0]?.detail).toBe("A signing certificate.");
    expect(report.ok).toBe(true);
  });

  it("says nothing about a deferred gate that forgot to say what it waits for", async () => {
    const { run } = runnerOver({});

    const report = await runGates({
      run,
      now: clock(),
      definitions: [definition({ id: "one", command: null })],
    });

    expect(report.results[0]?.detail).toBe("");
  });

  it("runs the real definition when none is given", async () => {
    const { run, calls } = runnerOver({});

    const report = await runGates({ run, now: clock(), set: "release-candidate" });

    expect(report.results.map((result) => result.id)).toEqual(
      GATE_DEFINITIONS.filter((gate) => gate.set === "release-candidate").map((gate) => gate.id),
    );
    expect(calls.length).toBeGreaterThan(0);
  });

  it("runs only the set that was asked for", async () => {
    const { run, calls } = runnerOver({});

    await runGates({
      run,
      now: clock(),
      set: "release-candidate",
      definitions: [
        definition({ id: "one", set: "pull-request" }),
        definition({ id: "two", set: "release-candidate" }),
      ],
    });

    expect(calls).toEqual(["pnpm two"]);
  });

  it("runs both sets when none is asked for", async () => {
    const { run, calls } = runnerOver({});

    await runGates({
      run,
      now: clock(),
      definitions: [
        definition({ id: "one", set: "pull-request" }),
        definition({ id: "two", set: "release-candidate" }),
      ],
    });

    expect(calls).toEqual(["pnpm one", "pnpm two"]);
  });
});

describe("the report", () => {
  it("counts each outcome and quotes the clause of the real gates", async () => {
    const { run } = runnerOver({ "pnpm lint": false });
    const report = await runGates({
      run,
      now: clock(),
      definitions: [
        GATE_DEFINITIONS.find((gate) => gate.id === "typecheck") as GateDefinition,
        { ...(GATE_DEFINITIONS.find((gate) => gate.id === "lint") as GateDefinition) },
        GATE_DEFINITIONS.find((gate) => gate.id === "adr-present") as GateDefinition,
      ],
    });

    const text = formatGateReport(report);

    expect(text).toContain("Quality gates, specification section 21");
    expect(text).toContain("pass  typecheck");
    expect(text).toContain("FAIL  lint");
    expect(text).toContain("defer adr-present");
    expect(text).toContain("Type checking passes.");
    expect(text).toContain("1 passed, 1 failed, 1 deferred");
  });

  it("leaves the duration out of a gate that ran no command", async () => {
    const { run } = runnerOver({});
    const report = await runGates({
      run,
      now: clock(),
      definitions: [definition({ id: "one", command: null, deferred: "A host." })],
    });

    expect(formatGateReport(report)).not.toContain("ms");
  });

  it("names an unknown gate without a clause rather than failing", () => {
    const text = formatGateReport({
      ok: true,
      results: [
        { id: "invented", set: "pull-request", outcome: "passed", detail: "", durationMs: 10 },
      ],
    });

    expect(text).toContain("invented");
  });
});

describe("the definition against specification section 21", () => {
  async function clauses(heading: string): Promise<readonly string[]> {
    const spec = await readFile(SPEC, "utf8");
    const section = spec.slice(spec.indexOf(heading));
    const body = section.slice(0, section.indexOf("\n### ", 1));
    return body
      .split("\n")
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2).trim());
  }

  it("covers every clause of 21.1, the pull-request gates", async () => {
    const covered = GATE_DEFINITIONS.filter((gate) => gate.set === "pull-request").map(
      (gate) => gate.clause,
    );

    expect(new Set(covered)).toEqual(new Set(await clauses("### 21.1")));
  });

  it("covers every clause of 21.2, the release-candidate gates", async () => {
    const covered = GATE_DEFINITIONS.filter((gate) => gate.set === "release-candidate").map(
      (gate) => gate.clause,
    );

    expect(new Set(covered)).toEqual(new Set(await clauses("### 21.2")));
  });

  it("gives every gate a unique identifier", () => {
    const identifiers = GATE_DEFINITIONS.map((gate) => gate.id);

    expect(new Set(identifiers).size).toBe(identifiers.length);
  });

  it("makes every gate either executable or deferred with a reason", () => {
    for (const gate of GATE_DEFINITIONS) {
      if (gate.command === null) {
        expect(gate.deferred ?? "").not.toBe("");
      } else {
        expect(gate.command.length).toBeGreaterThan(1);
        expect(gate.deferred).toBeUndefined();
      }
    }
  });

  it("says what each gate proves", () => {
    for (const gate of GATE_DEFINITIONS) {
      expect(gate.proves.length).toBeGreaterThan(20);
    }
  });

  it("runs every pull-request gate as a step of the continuous integration workflow", async () => {
    const workflow = await readFile(CI_WORKFLOW, "utf8");
    const steps = [...workflow.matchAll(/^ +- name: (.+)$/gm)].map((match) => match[1]);

    for (const gate of GATE_DEFINITIONS.filter((candidate) => candidate.set === "pull-request")) {
      if (gate.command === null) {
        expect(gate.workflowStep).toBeUndefined();
        continue;
      }
      expect(steps).toContain(gate.workflowStep);
    }
  });
});
