import cors from "@fastify/cors";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import type { ServerConfig } from "@gobblet/config";
import { TIME_CONTROLS_SECONDS } from "./time-controls";

/**
 * A dependency probe reported by `GET /health/ready`. Phase 2 registers the
 * database probe here; readiness stays independent of liveness so a failing
 * dependency takes an instance out of the load balancer without restarting it.
 */
export type ReadinessProbe = Readonly<{
  name: string;
  check: () => Promise<boolean> | boolean;
}>;

export type BuildAppOptions = Readonly<{
  config: ServerConfig;
  readiness?: readonly ReadinessProbe[];
  now?: () => number;
}>;

const REQUEST_BODY_LIMIT_BYTES = 64 * 1024;

export async function buildApp({
  config,
  readiness = [],
  now = Date.now,
}: BuildAppOptions): Promise<FastifyInstance> {
  const startedAt = now();

  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: ["req.headers.authorization", "req.headers.cookie"],
      base: { appVersion: config.appVersion, gitSha: config.gitSha, appEnv: config.appEnv },
    },
    bodyLimit: REQUEST_BODY_LIMIT_BYTES,
    trustProxy: true,
  });

  await app.register(cors, { origin: [...config.corsOrigins], credentials: true });

  app.setNotFoundHandler((_request, reply) => {
    void reply.status(404).send({ error: { code: "not-found", message: "Unknown endpoint" } });
  });

  app.get("/health/live", () => ({
    status: "live" as const,
    appVersion: config.appVersion,
    gitSha: config.gitSha,
    uptimeSeconds: Math.max(0, Math.round((now() - startedAt) / 1000)),
  }));

  app.get("/health/ready", async (_request, reply) => {
    const checks = await Promise.all(
      readiness.map(async (probe) => {
        try {
          return { name: probe.name, ok: await probe.check() };
        } catch {
          return { name: probe.name, ok: false };
        }
      }),
    );

    const ready = checks.every((check) => check.ok);
    return reply.status(ready ? 200 : 503).send({
      status: ready ? ("ready" as const) : ("unavailable" as const),
      checks,
    });
  });

  app.get("/v1/config", () => ({
    appEnv: config.appEnv,
    appVersion: config.appVersion,
    minSupportedClientVersion: config.minSupportedClientVersion,
    modes: ["casual", "ranked"] as const,
    timeControlsSeconds: TIME_CONTROLS_SECONDS,
  }));

  return app;
}
