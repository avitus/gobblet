import { loadServerConfig } from "@gobblet/config";
import { httpErrorBodySchema } from "@gobblet/protocol";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { createSilentTelemetry } from "../src/observability/telemetry";
import type { TelemetryService } from "../src/observability/telemetry";

/**
 * The Prometheus exposition of ADR-0031: absent unless a deployment enables it, and
 * guarded by a token when one is configured, because the exposition names the running
 * version and the shape of the traffic (spec section 17.3).
 */

const TOKEN = "a-metrics-token-value";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function start(
  environment: Record<string, string>,
): Promise<Readonly<{ server: FastifyInstance; telemetry: TelemetryService }>> {
  const telemetry = createSilentTelemetry();
  app = await buildApp({
    config: loadServerConfig({ APP_ENV: "local", LOG_LEVEL: "fatal", ...environment }),
    telemetry,
    now: () => 1_000,
  });
  return { server: app, telemetry };
}

describe("GET /metrics", () => {
  it("is absent in a deployment that does not publish it", async () => {
    const { server } = await start({});
    const response = await server.inject({ method: "GET", url: "/metrics" });

    expect(response.statusCode).toBe(404);
    expect(httpErrorBodySchema.parse(response.json()).error.code).toBe("not_found");
  });

  it("serves the exposition when it is enabled and unguarded", async () => {
    const { server, telemetry } = await start({ METRICS_ENABLED: "true" });
    telemetry.metrics.recordSocketConnection();

    const response = await server.inject({ method: "GET", url: "/metrics" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.body).toContain("gobblet_socket_connections_total 1");
  });

  it("requires the configured token", async () => {
    const { server } = await start({ METRICS_ENABLED: "true", METRICS_TOKEN: TOKEN });

    const anonymous = await server.inject({ method: "GET", url: "/metrics" });
    const wrong = await server.inject({
      method: "GET",
      url: "/metrics",
      headers: { authorization: "Bearer not-the-metrics-token" },
    });
    const right = await server.inject({
      method: "GET",
      url: "/metrics",
      headers: { authorization: `Bearer ${TOKEN}` },
    });

    expect(anonymous.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(right.statusCode).toBe(200);
    expect(right.body).toContain("gobblet_deployment_info");
  });

  it("refuses a token of the right length that is not the token", async () => {
    const { server } = await start({ METRICS_ENABLED: "true", METRICS_TOKEN: TOKEN });
    const response = await server.inject({
      method: "GET",
      url: "/metrics",
      headers: { authorization: `Bearer ${"x".repeat(TOKEN.length)}` },
    });

    expect(response.statusCode).toBe(401);
  });
});
