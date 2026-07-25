import { loadServerConfig } from "@gobblet/config";
import { httpErrorBodySchema } from "@gobblet/protocol";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { TIME_CONTROLS_SECONDS, isTimeControlSeconds } from "../src/time-controls";

const config = loadServerConfig({
  APP_ENV: "local",
  APP_VERSION: "9.9.9",
  GIT_SHA: "testsha",
  LOG_LEVEL: "fatal",
});

let app: FastifyInstance | undefined;

async function start(
  options: Partial<Parameters<typeof buildApp>[0]> = {},
): Promise<FastifyInstance> {
  app = await buildApp({ config, ...options });
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("health endpoints", () => {
  it("reports liveness with the running build", async () => {
    const server = await start({ now: () => 5_000 });
    const response = await server.inject({ method: "GET", url: "/health/live" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "live",
      appVersion: "9.9.9",
      gitSha: "testsha",
      uptimeSeconds: 0,
    });
  });

  it("reports uptime from the injected clock", async () => {
    let current = 1_000;
    const server = await start({ now: () => current });
    current += 12_400;

    const response = await server.inject({ method: "GET", url: "/health/live" });

    expect(response.json()).toMatchObject({ uptimeSeconds: 12 });
  });

  it("is ready when no dependency is registered", async () => {
    const server = await start();
    const response = await server.inject({ method: "GET", url: "/health/ready" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ready", checks: [] });
  });

  it("is ready when every probe passes", async () => {
    const server = await start({
      readiness: [
        { name: "database", check: () => true },
        { name: "async-check", check: () => Promise.resolve(true) },
      ],
    });
    const response = await server.inject({ method: "GET", url: "/health/ready" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ready",
      checks: [
        { name: "database", ok: true },
        { name: "async-check", ok: true },
      ],
    });
  });

  it("is unavailable when a probe fails or throws", async () => {
    const server = await start({
      readiness: [
        { name: "database", check: () => false },
        {
          name: "throwing",
          check: () => {
            throw new Error("boom");
          },
        },
      ],
    });
    const response = await server.inject({ method: "GET", url: "/health/ready" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: "unavailable",
      checks: [
        { name: "database", ok: false },
        { name: "throwing", ok: false },
      ],
    });
  });
});

describe("public configuration", () => {
  it("publishes the modes and time controls of the specification", async () => {
    const server = await start();
    const response = await server.inject({ method: "GET", url: "/v1/config" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      appEnv: "local",
      appVersion: "9.9.9",
      minSupportedClientVersion: "0.1.0",
      modes: ["casual", "ranked"],
      timeControlsSeconds: [180, 300, 600, 900],
    });
  });

  it("validates time control values", () => {
    expect(TIME_CONTROLS_SECONDS).toHaveLength(4);
    expect(isTimeControlSeconds(300)).toBe(true);
    expect(isTimeControlSeconds(60)).toBe(false);
  });
});

describe("unknown routes", () => {
  it("answers with the documented problem shape", async () => {
    const server = await start();
    const response = await server.inject({ method: "GET", url: "/v1/does-not-exist" });

    expect(response.statusCode).toBe(404);
    const body = httpErrorBodySchema.parse(response.json());
    expect(body.error.code).toBe("not_found");
    expect(body.error.message).toBe("Unknown endpoint");
  });

  it("does not expose match endpoints without services", async () => {
    const server = await start();

    expect(
      (await server.inject({ method: "POST", url: "/v1/guests", payload: {} })).statusCode,
    ).toBe(404);
  });

  it("applies the configured cors origins", async () => {
    const server = await start();
    const response = await server.inject({
      method: "OPTIONS",
      url: "/v1/config",
      headers: { origin: "http://localhost:5173", "access-control-request-method": "GET" },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
  });
});
