import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The deploy workflow is the one piece of this repository that only ever runs where it
 * cannot be watched. These are the mistakes that would look like a green run: releasing
 * one service and not the other, calling a build a deployment, smoking an address the
 * release never went to, and asking for configuration nobody was told to create
 * (docs/adr/0043-railway-hosts-the-deployment.md).
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const workflow = readFileSync(resolve(ROOT, ".github/workflows/deploy.yml"), "utf8");

/** One job's lines, from its name to the next job at the same indentation. */
function job(name: string): string {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  expect(start, `${name} is a job in the workflow`).toBeGreaterThan(-1);
  const rest = workflow.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z][a-z-]*:\n/);

  return next === -1 ? rest : rest.slice(0, next + 1);
}

describe("each deploy job", () => {
  for (const name of ["staging-deploy", "production-deploy"]) {
    describe(name, () => {
      const steps = job(name);

      it("releases both services, because the client and the server are deployed together", () => {
        expect(steps).toContain('railway up --ci --service "${{ vars.RAILWAY_SERVER_SERVICE }}"');
        expect(steps).toContain('railway up --ci --service "${{ vars.RAILWAY_WEB_SERVICE }}"');
      });

      it("waits for the released version to answer, rather than trusting the build", () => {
        expect(steps).toContain("pnpm --filter @gobblet/server await-release");
      });

      it("tells the platform which version it is releasing", () => {
        expect(steps).toContain("APP_VERSION=${{ needs.build.outputs.version }}");
        expect(steps).toContain("--skip-deploys");
      });

      it("refuses to run before its environment is configured", () => {
        expect(steps).toContain("Require a host");
        expect(steps).toContain("RAILWAY_TOKEN");
      });
    });
  }

  it("waits on and then smokes the same address, per environment", () => {
    const environments = [
      { deploy: "staging-deploy", smoke: "staging-smoke", variable: "vars.STAGING_URL" },
      { deploy: "production-deploy", smoke: "production-smoke", variable: "vars.PRODUCTION_URL" },
    ];

    for (const environment of environments) {
      expect(job(environment.deploy)).toContain(
        `RELEASE_BASE_URL: \${{ ${environment.variable} }}`,
      );
      expect(job(environment.smoke)).toContain(`SMOKE_BASE_URL: \${{ ${environment.variable} }}`);
    }
  });
});

describe("a production release without a staging rehearsal", () => {
  it("is possible, because staging does not exist yet", () => {
    expect(workflow).toContain("skip-staging:");

    for (const name of ["staging-migrate", "staging-deploy"]) {
      expect(job(name)).toContain("!inputs.skip-staging");
    }
  });

  it("still stops at the approval gate", () => {
    expect(job("production-approval")).toContain("!inputs.skip-production");
  });

  it("is recorded as untried rather than passed off as rehearsed", () => {
    expect(job("production-approval")).toContain("No staging rehearsal");
  });

  it("does not turn a skipped rehearsal into a skipped production deploy", () => {
    expect(job("production-approval")).toContain(
      "(needs.staging-smoke.result == 'success' || inputs.skip-staging)",
    );
  });
});

describe("a job that depends on another", () => {
  /** Every job in the file, in order, with its lines. */
  const names = [...workflow.matchAll(/\n {2}([a-z][a-z-]*):\n/g)].map(
    (match) => match[1] as string,
  );

  it("is a set the test can see", () => {
    expect(names).toContain("build");
    expect(names).toContain("production-smoke");
  });

  it("says which upstream results it needs, rather than inheriting the answer", () => {
    // Without a status function in its condition, GitHub skips a job when anything
    // upstream skipped, whatever its own condition says, and a skipped job leaves the
    // run green. That is how the first production run announced a deploy it never made.
    const silent = names.filter((name) => {
      const lines = job(name);
      if (!lines.includes("needs:")) {
        return false;
      }
      const condition = /\n {4}if: (.*)/.exec(lines)?.[1] ?? "";

      return !condition.includes("always()") && !condition.includes("!cancelled()");
    });

    expect(silent).toEqual([]);
  });
});

describe("a job that runs a workspace command", () => {
  const names = [...workflow.matchAll(/\n {2}([a-z][a-z-]*):\n/g)].map(
    (match) => match[1] as string,
  );

  it("builds the packages that command imports, which a fresh checkout does not have", () => {
    // tsx compiles the CLI from source, but an import of @gobblet/config resolves to
    // that package's dist. Installing is not building, and the runner starts empty.
    const unbuilt = names.filter((name) => {
      const lines = job(name);
      const commands = [...lines.matchAll(/run: (pnpm .*)/g)].map((match) => match[1] as string);
      const runsWorkspaceCommand = commands.some(
        (command) => command !== "pnpm install --frozen-lockfile" && !command.includes("run build"),
      );
      const builds = commands.some((command) => /pnpm( --filter \S+)? (run )?build/.test(command));

      return runsWorkspaceCommand && !builds;
    });

    expect(unbuilt).toEqual([]);
  });

  it("builds before it runs, not after", () => {
    for (const name of ["production-migrate", "production-smoke"]) {
      const lines = job(name);

      expect(lines.indexOf("run build")).toBeLessThan(lines.lastIndexOf("run: pnpm"));
    }
  });
});

describe("the last job of a run", () => {
  const lines = job("release-check");

  it("runs whatever else did, including after a failure", () => {
    expect(lines).toContain("if: ${{ always() }}");
  });

  it("waits for every job that releases anything", () => {
    for (const name of [
      "staging-deploy",
      "staging-smoke",
      "production-deploy",
      "production-smoke",
    ]) {
      expect(lines).toContain(name);
    }
  });

  it("fails the run when the release did not happen", () => {
    // The decision is apps/server/src/ops/release.ts, proved in release-check.test.ts;
    // the workflow only supplies the results.
    expect(lines).toContain("pnpm --filter @gobblet/server check-release");
    expect(lines).toContain("PRODUCTION_DEPLOY_RESULT: ${{ needs.production-deploy.result }}");
    expect(lines).toContain("SKIP_STAGING: ${{ inputs.skip-staging }}");
  });
});

describe("everything the workflow asks the operator for", () => {
  it("is named in the runbook, so nobody has to read the workflow to configure it", () => {
    const operations = readFileSync(resolve(ROOT, "docs/operations.md"), "utf8");
    const asked = new Set(
      [...workflow.matchAll(/(?:vars|secrets)\.([A-Z_]+)/g)].map((match) => match[1] as string),
    );
    const undocumented = [...asked].filter((name) => !operations.includes(name)).sort();

    expect(undocumented).toEqual([]);
  });
});
