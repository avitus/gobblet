import type { HttpErrorCode, HttpErrorDetail } from "@gobblet/protocol";

/**
 * Two failure modes the server never sends but the client must still describe:
 * the request never arrived, and the answer did not match the contract.
 */
export type ApiFailureCode = HttpErrorCode | "network_unreachable" | "malformed_response";

export class ApiError extends Error {
  readonly code: ApiFailureCode;
  readonly status: number;
  readonly requestId: string | null;
  readonly details: readonly HttpErrorDetail[];

  constructor(options: {
    code: ApiFailureCode;
    message: string;
    status: number;
    requestId?: string | null;
    details?: readonly HttpErrorDetail[];
  }) {
    super(options.message);
    this.name = "ApiError";
    this.code = options.code;
    this.status = options.status;
    this.requestId = options.requestId ?? null;
    this.details = options.details ?? [];
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

/** The message a screen shows when it has nothing better to say. */
export function describeApiError(error: unknown): string {
  if (isApiError(error)) {
    return error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong";
}
