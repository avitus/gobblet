import { describe, expect, it } from "vitest";
import { verifyReleaseHappened, type ReleaseRun } from "../src/ops/release";

/**
 * The first production run of the deploy workflow finished green having skipped every
 * job that releases anything. These are the runs that must not be called a release.
 */

type Overrides = Partial<Omit<ReleaseRun, "results">> & {
  results?: Partial<ReleaseRun["results"]>;
};

function run(overrides: Overrides = {}): ReleaseRun {
  return {
    skipStaging: overrides.skipStaging ?? false,
    skipProduction: overrides.skipProduction ?? false,
    results: {
      stagingDeploy: "success",
      stagingSmoke: "success",
      productionDeploy: "success",
      productionSmoke: "success",
      ...overrides.results,
    },
  };
}

describe("confirming a release happened", () => {
  it("accepts a run that deployed and smoked both environments", () => {
    expect(verifyReleaseHappened(run())).toEqual({
      ok: true,
      detail: "released to staging and production",
    });
  });

  it("rejects the run that reported success having skipped everything", () => {
    const verdict = verifyReleaseHappened(
      run({
        skipStaging: true,
        results: {
          stagingDeploy: "skipped",
          stagingSmoke: "skipped",
          productionDeploy: "skipped",
          productionSmoke: "skipped",
        },
      }),
    );

    expect(verdict).toEqual({
      ok: false,
      detail: "nothing was released: production deploy skipped, production smoke skipped",
    });
  });

  it("ignores the environment the run was told to skip", () => {
    const verdict = verifyReleaseHappened(
      run({
        skipStaging: true,
        results: { stagingDeploy: "skipped", stagingSmoke: "skipped" },
      }),
    );

    expect(verdict).toEqual({ ok: true, detail: "released to production" });
  });

  it("accepts a staging-only run", () => {
    const verdict = verifyReleaseHappened(
      run({
        skipProduction: true,
        results: { productionDeploy: "skipped", productionSmoke: "skipped" },
      }),
    );

    expect(verdict).toEqual({ ok: true, detail: "released to staging" });
  });

  it("refuses a run that was told to skip both environments", () => {
    const verdict = verifyReleaseHappened(run({ skipStaging: true, skipProduction: true }));

    expect(verdict).toEqual({
      ok: false,
      detail: "skipping both environments releases nothing",
    });
  });

  it("names a deploy that succeeded but whose smoke test did not", () => {
    const verdict = verifyReleaseHappened(
      run({ skipStaging: true, results: { productionSmoke: "failure" } }),
    );

    expect(verdict).toEqual({
      ok: false,
      detail: "nothing was released: production smoke failure",
    });
  });

  it("treats a cancelled deploy as no release", () => {
    const verdict = verifyReleaseHappened(run({ results: { stagingDeploy: "cancelled" } }));

    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain("staging deploy cancelled");
  });

  it("reports a result the workflow never supplied rather than assuming it passed", () => {
    const verdict = verifyReleaseHappened(
      run({ skipStaging: true, results: { productionDeploy: "missing" } }),
    );

    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain("production deploy missing");
  });
});
