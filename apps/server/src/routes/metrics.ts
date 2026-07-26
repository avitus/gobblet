import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { bearerToken } from "../http/authenticate";
import { sendError } from "../http/errors";
import type { MetricsRegistry } from "../observability/metrics";

/**
 * The Prometheus exposition of ADR-0031. It is absent unless metrics are enabled, so
 * a deployment that does not scrape does not publish, and it requires a bearer token
 * when one is configured, because the exposition names the running version and the
 * shape of the traffic.
 */
export function registerMetricsRoute(
  app: FastifyInstance,
  metrics: MetricsRegistry,
  token: string | null,
): void {
  app.get("/metrics", async (request, reply) => {
    if (token !== null && !presentedToken(bearerToken(request), token)) {
      return sendError(request, reply, "unauthenticated", "A metrics token is required");
    }

    const body = await metrics.expose();
    return reply.header("content-type", metrics.contentType).send(body);
  });
}

/** Compared in constant time, since the token is a secret like any other. */
function presentedToken(presented: string | null, expected: string): boolean {
  if (presented === null) {
    return false;
  }
  const left = Buffer.from(presented);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
