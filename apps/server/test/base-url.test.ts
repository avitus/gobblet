import { describe, expect, it } from "vitest";
import { checkBaseUrl } from "../src/ops/base-url";

/**
 * A production release waited five minutes and made sixty attempts against
 * `gobblet-production.up.railway.app`, because the variable holding it had no scheme
 * and `fetch` cannot parse that. No amount of waiting fixes a value like this.
 */

describe("the address a release check is given", () => {
  it("is accepted when it is absolute", () => {
    expect(checkBaseUrl("PRODUCTION_URL", "https://gobblet-production.up.railway.app")).toEqual({
      ok: true,
      baseUrl: "https://gobblet-production.up.railway.app",
    });
  });

  it("loses its trailing slashes, so the path is joined once", () => {
    const verdict = checkBaseUrl("PRODUCTION_URL", "https://example.com//");

    expect(verdict).toEqual({ ok: true, baseUrl: "https://example.com" });
  });

  it("is rejected without a scheme, and the message shows the fix", () => {
    const verdict = checkBaseUrl("PRODUCTION_URL", "gobblet-production.up.railway.app");

    expect(verdict.ok).toBe(false);
    expect(verdict.ok ? "" : verdict.problem).toBe(
      "PRODUCTION_URL must be an absolute URL including the scheme, for example https://gobblet-production.up.railway.app",
    );
  });

  it("is rejected when it is missing, naming the variable that is not set", () => {
    for (const value of [undefined, "", "   "]) {
      const verdict = checkBaseUrl("SMOKE_BASE_URL", value);

      expect(verdict.ok).toBe(false);
      expect(verdict.ok ? "" : verdict.problem).toContain("SMOKE_BASE_URL is required");
    }
  });

  it("is rejected when the scheme is one fetch will not speak", () => {
    const verdict = checkBaseUrl("PRODUCTION_URL", "postgres://example.com");

    expect(verdict.ok).toBe(false);
    expect(verdict.ok ? "" : verdict.problem).toContain("must be an http or https URL");
  });

  it("tolerates the surrounding whitespace a copied value brings with it", () => {
    expect(checkBaseUrl("PRODUCTION_URL", "  https://example.com  ")).toEqual({
      ok: true,
      baseUrl: "https://example.com",
    });
  });
});
