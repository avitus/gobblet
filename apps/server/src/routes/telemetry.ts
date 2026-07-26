import {
  httpErrorDetails,
  telemetryErrorRequestSchema,
  telemetryEventsRequestSchema,
} from "@gobblet/protocol";
import type { FastifyInstance } from "fastify";
import { resolveRequestIdentity } from "../http/authenticate";
import { sendError } from "../http/errors";
import type { IdentityResolvers } from "../identity/resolve";
import type { AttemptLimiter } from "../identity/rate-limit";
import type { TelemetryService } from "../observability/telemetry";

/**
 * Where a browser reports what it knows about itself: the three events of appendix
 * P7.11 and an error it could not handle. The route accepts anonymous callers,
 * because an app launch happens before anyone signs in, and it is throttled per
 * address so a page cannot flood the provider
 * (docs/adr/0030-telemetry-behind-ports-relayed-through-the-server.md).
 */
export function registerTelemetryRoutes(
  app: FastifyInstance,
  telemetry: TelemetryService,
  resolvers: IdentityResolvers,
  limiter: AttemptLimiter,
): void {
  app.post("/v1/telemetry/events", async (request, reply) => {
    if (!allow(request.ip, limiter, request, reply)) {
      return reply;
    }

    const parsed = telemetryEventsRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(
        request,
        reply,
        "validation_failed",
        "Invalid telemetry batch",
        httpErrorDetails(parsed.error),
      );
    }

    const identity = await resolveRequestIdentity(resolvers, request);
    for (const event of parsed.data.events) {
      telemetry.capture(identity, event);
    }
    return reply.send({ accepted: parsed.data.events.length });
  });

  app.post("/v1/telemetry/errors", async (request, reply) => {
    if (!allow(request.ip, limiter, request, reply)) {
      return reply;
    }

    const parsed = telemetryErrorRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(
        request,
        reply,
        "validation_failed",
        "Invalid error report",
        httpErrorDetails(parsed.error),
      );
    }

    const identity = await resolveRequestIdentity(resolvers, request);
    telemetry.reportClientError(identity, parsed.data);
    return reply.send({ accepted: 1 });
  });
}

function allow(
  ip: string,
  limiter: AttemptLimiter,
  request: Parameters<typeof sendError>[0],
  reply: Parameters<typeof sendError>[1],
): boolean {
  const attempt = limiter.check(`telemetry:${ip}`);
  if (attempt.allowed) {
    return true;
  }
  void reply.header("retry-after", String(attempt.retryAfter));
  void sendError(request, reply, "rate_limited", "Too many reports, try again later");
  return false;
}
