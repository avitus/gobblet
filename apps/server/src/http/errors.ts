import type { HttpErrorBody, HttpErrorCode, HttpErrorDetail } from "@gobblet/protocol";
import type { FastifyReply, FastifyRequest } from "fastify";

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

export function sendError(
  request: FastifyRequest,
  reply: FastifyReply,
  code: HttpErrorCode,
  message: string,
  details?: readonly HttpErrorDetail[],
): FastifyReply {
  return reply.status(STATUS_BY_CODE[code]).send(errorBody(request.id, code, message, details));
}
