import { loadServerConfig } from "@gobblet/config";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app";
import { createSilentTelemetry } from "../src/observability/telemetry";
import { formatSmokeReport, runSmoke } from "../src/ops/smoke";

/**
 * The deploy workflow's smoke step (spec section 22.2 step 5). It runs against the
 * real application through `inject`, so a check that passes here is a check of the
 * endpoints a deployment will actually be asked about, not of a stand-in.
 */

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function serving(
  overrides: Record<string, string> = {},
  probes: readonly { name: string; check: () => Promise<boolean> }[] = [],
): Promise<typeof globalThis.fetch> {
  app = await buildApp({
    config: loadServerConfig({
      APP_ENV: "local",
      LOG_LEVEL: "fatal",
      APP_VERSION: "1.4.0",
      ...overrides,
    }),
    telemetry: createSilentTelemetry(),
    readiness: probes,
  });
  const server = app;
  return async (input) => {
    const response = await server.inject({ method: "GET", url: pathOf(input) });
    return new Response(response.body, {
      status: response.statusCode,
      headers: { "content-type": response.headers["content-type"]?.toString() ?? "text/plain" },
    });
  };
}

function pathOf(input: Parameters<typeof globalThis.fetch>[0]): string {
  if (typeof input === "string") {
    return new URL(input).pathname;
  }
  return new URL(input instanceof URL ? input.href : input.url).pathname;
}

describe("the deploy smoke test", () => {
  it("passes against a healthy instance serving the released version", async () => {
    const fetch = await serving();

    const report = await runSmoke({
      baseUrl: "https://staging.example.com/",
      expectVersion: "1.4.0",
      fetch,
    });

    expect(report.ok).toBe(true);
    expect(report.checks.map((check) => check.name)).toEqual([
      "liveness",
      "readiness",
      "configuration",
      "configuration document",
      "released build is serving",
    ]);
    expect(formatSmokeReport(report)).toContain("smoke test passed");
  });

  it("fails when the instance would not accept traffic", async () => {
    const fetch = await serving({}, [{ name: "database", check: () => Promise.resolve(false) }]);

    const report = await runSmoke({ baseUrl: "https://staging.example.com", fetch });

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.name === "readiness")?.detail).toContain("503");
    expect(formatSmokeReport(report)).toContain("FAIL readiness");
  });

  it("fails when the version matches but the commit serving is the one replaced", async () => {
    // The package version does not change with every commit, so on its own it cannot
    // tell the container just released from the container it replaced.
    const fetch = await serving({ APP_VERSION: "1.4.0", GIT_SHA: "old" });

    const report = await runSmoke({
      baseUrl: "https://staging.example.com",
      expectVersion: "1.4.0",
      expectGitSha: "new",
      fetch,
    });

    expect(report.ok).toBe(false);
    expect(report.checks.at(-1)?.detail).toBe("expected 1.4.0 at new, found 1.4.0 at old");
  });

  it("passes when both the version and the commit are the ones released", async () => {
    const fetch = await serving({ APP_VERSION: "1.4.0", GIT_SHA: "new" });

    const report = await runSmoke({
      baseUrl: "https://staging.example.com",
      expectVersion: "1.4.0",
      expectGitSha: "new",
      fetch,
    });

    expect(report.ok).toBe(true);
  });

  it("fails when the build that is serving is not the build that was released", async () => {
    const fetch = await serving({ APP_VERSION: "1.3.9" });

    const report = await runSmoke({
      baseUrl: "https://staging.example.com",
      expectVersion: "1.4.0",
      fetch,
    });

    expect(report.ok).toBe(false);
    expect(report.checks.at(-1)?.detail).toBe("expected 1.4.0, found 1.3.9");
  });

  it("reports the host being unreachable rather than throwing", async () => {
    const report = await runSmoke({
      baseUrl: "https://nowhere.example.com",
      fetch: () => Promise.reject(new Error("getaddrinfo ENOTFOUND")),
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toHaveLength(3);
    expect(report.checks[0]?.detail).toContain("could not be reached: getaddrinfo ENOTFOUND");
    expect(formatSmokeReport(report)).toContain("smoke test failed");
  });

  it("survives a reply that is not the document it claims to be", async () => {
    const responses: Record<string, Response> = {
      "/health/live": new Response("not json", { status: 200 }),
      "/health/ready": new Response(JSON.stringify({ status: "ready" }), { status: 200 }),
      "/v1/config": new Response(JSON.stringify({ appEnv: "production" }), { status: 200 }),
    };
    const report = await runSmoke({
      baseUrl: "https://staging.example.com",
      expectVersion: "1.4.0",
      fetch: (input) =>
        Promise.resolve(responses[pathOf(input)] ?? new Response("", { status: 404 })),
    });

    expect(report.checks.find((check) => check.name === "configuration document")?.ok).toBe(false);
    expect(report.checks.at(-1)?.detail).toBe("expected 1.4.0, found unknown");
  });

  it("uses the runtime's own fetch when none is injected", async () => {
    const served = await serving();
    vi.stubGlobal("fetch", served);
    try {
      const report = await runSmoke({ baseUrl: "https://staging.example.com" });

      expect(report.ok).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("treats a reply that is valid JSON but not a document as empty", async () => {
    const report = await runSmoke({
      baseUrl: "https://staging.example.com",
      expectVersion: "1.4.0",
      fetch: () => Promise.resolve(new Response("42", { status: 200 })),
    });

    expect(report.checks.find((check) => check.name === "configuration document")?.ok).toBe(false);
    expect(report.checks.at(-1)?.detail).toBe("expected 1.4.0, found unknown");
  });

  it("reports a thrown value that is not an error", async () => {
    // A transport can fail with anything at all, and the report says so rather
    // than failing while describing the failure.
    const report = await runSmoke({
      baseUrl: "https://staging.example.com",
      timeoutMs: 50,
      fetch: () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw "connection reset";
      },
    });

    expect(report.checks[0]?.detail).toContain("connection reset");
  });
});
