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
    results: { staging: "success", production: "success", ...overrides.results },
  };
}

describe("confirming a release happened", () => {
  it("accepts a run that released both environments", () => {
    expect(verifyReleaseHappened(run())).toEqual({
      ok: true,
      detail: "released to staging and production",
    });
  });

  it("rejects the run that reported success having skipped everything", () => {
    const verdict = verifyReleaseHappened(
      run({ skipStaging: true, results: { staging: "skipped", production: "skipped" } }),
    );

    expect(verdict).toEqual({
      ok: false,
      detail: "nothing was released: production skipped",
    });
  });

  it("ignores the environment the run was told to skip", () => {
    const verdict = verifyReleaseHappened(
      run({ skipStaging: true, results: { staging: "skipped" } }),
    );

    expect(verdict).toEqual({ ok: true, detail: "released to production" });
  });

  it("accepts a staging-only run", () => {
    const verdict = verifyReleaseHappened(
      run({ skipProduction: true, results: { production: "skipped" } }),
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

  it("names every environment that did not get the release", () => {
    const verdict = verifyReleaseHappened(
      run({ results: { staging: "failure", production: "cancelled" } }),
    );

    expect(verdict).toEqual({
      ok: false,
      detail: "nothing was released: staging failure, production cancelled",
    });
  });

  it("reports a result the workflow never supplied rather than assuming it passed", () => {
    const verdict = verifyReleaseHappened(
      run({ skipStaging: true, results: { production: "missing" } }),
    );

    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain("production missing");
  });
});
