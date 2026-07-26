import type { FastifyInstance, FastifyRequest } from "fastify";
import type { TelemetryService } from "./telemetry";

/**
 * What every HTTP request contributes to observability: the latency histogram of
 * section 17.3, the error counters behind the dashboard, and the structured line of
 * section 17.2 carrying the route pattern, the duration and the outcome. The route
 * pattern is used rather than the path, so no series and no log field is keyed by an
 * id (docs/adr/0031-metrics-are-a-prometheus-exposition.md).
 */

declare module "fastify" {
  interface FastifyRequest {
    /** Set on arrival, so the response reports a duration it measured itself. */
    observedAt?: number;
  }

  interface FastifyInstance {
    /** Decorated so `sendError` can count a refusal without every route passing it. */
    telemetry: TelemetryService;
  }
}

const UNMATCHED_ROUTE = "unmatched";

export function routePatternOf(request: FastifyRequest): string {
  return request.routeOptions.url ?? UNMATCHED_ROUTE;
}

export function registerRequestObservability(
  app: FastifyInstance,
  telemetry: TelemetryService,
  now: () => number,
): void {
  app.decorate("telemetry", telemetry);

  app.addHook("onRequest", (request, _reply, done) => {
    request.observedAt = now();
    done();
  });

  app.addHook("onResponse", (request, reply, done) => {
    const durationMs = now() - (request.observedAt ?? now());
    const route = routePatternOf(request);
    telemetry.metrics.recordHttpRequest(request.method, route, reply.statusCode, durationMs / 1000);

    request.log.info(
      {
        requestId: request.id,
        route,
        method: request.method,
        status: reply.statusCode,
        durationMs,
        result: reply.statusCode < 400 ? "ok" : "error",
      },
      "request completed",
    );
    done();
  });

  /**
   * An unhandled failure is reported once, from here, so no route has to remember
   * to. The caller still receives the generic body Fastify produces.
   */
  app.addHook("onError", (request, _reply, error, done) => {
    const route = routePatternOf(request);
    telemetry.recordFailure("internal_error", route);
    telemetry.reportServerError(
      {
        name: error.name,
        message: error.message,
        ...(error.stack === undefined ? {} : { stack: error.stack }),
      },
      { route, actor: null },
    );
    done();
  });
}
