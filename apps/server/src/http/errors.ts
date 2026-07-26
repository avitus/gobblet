import type { HttpErrorBody, HttpErrorCode, HttpErrorDetail } from "@gobblet/protocol";
import type { FastifyReply, FastifyRequest } from "fastify";
import { routePatternOf } from "../observability/http";

const STATUS_BY_CODE: Readonly<Record<HttpErrorCode, number>> = Object.freeze({
  validation_failed: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  internal_error: 500,
  dependency_unavailable: 503,
});

export function errorBody(
  requestId: string,
  code: HttpErrorCode,
  message: string,
  details?: readonly HttpErrorDetail[],
): HttpErrorBody {
  return {
    error: {
      code,
      message,
      requestId,
      ...(details && details.length > 0 ? { details: [...details] } : {}),
    },
  };
}

/**
 * The one place a refusal is written, which is therefore the one place it is
 * counted: the metric and the dashboard's recent errors both come from here, so no
 * route can refuse a caller invisibly (appendix P7.7).
 */
export function sendError(
  request: FastifyRequest,
  reply: FastifyReply,
  code: HttpErrorCode,
  message: string,
  details?: readonly HttpErrorDetail[],
): FastifyReply {
  request.server.telemetry.recordFailure(code, routePatternOf(request));
  return reply.status(STATUS_BY_CODE[code]).send(errorBody(request.id, code, message, details));
}
