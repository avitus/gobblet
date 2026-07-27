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
