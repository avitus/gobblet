import {
  authResponseSchema,
  checkUsernameResponseSchema,
  claimGuestResponseSchema,
  createGuestResponseSchema,
  httpErrorBodySchema,
  matchHistoryResponseSchema,
  matchSnapshotSchema,
  matchSummarySchema,
  meResponseSchema,
  publicProfileSchema,
  publicServerConfigSchema,
} from "@gobblet/protocol";
import type {
  AuthResponse,
  CheckUsernameResponse,
  ClaimGuestRequest,
  ClaimGuestResponse,
  CreateGuestResponse,
  MatchHistoryResponse,
  MatchSnapshot,
  MatchSummary,
  MeResponse,
  PublicProfile,
  PublicServerConfig,
  RegisterRequest,
  SignInRequest,
  UpdateProfileRequest,
} from "@gobblet/protocol";
import { z } from "zod";
import { ApiError } from "./errors";

/** Endpoints that answer with a bare acknowledgement: the status code is the answer. */
const acknowledgementSchema = z.unknown();

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type ApiClientOptions = Readonly<{
  baseUrl: string;
  fetch?: FetchLike;
  /** Read on every request, so a sign-in mid-session is picked up without rewiring. */
  sessionToken?: () => string | null;
}>;

type RequestOptions = Readonly<{
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
  signal?: AbortSignal;
}>;

/**
 * The only place the client talks HTTP. Every response is validated with the
 * shared protocol schema before it is returned, so a contract drift shows up as
 * one error here instead of an undefined field somewhere in a screen
 * (ADR-0020).
 */
export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly readToken: () => string | null;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.readToken = options.sessionToken ?? (() => null);
  }

  private async send<T>(
    schema: z.ZodType<T>,
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const token = this.readToken();
    const headers: Record<string, string> = { accept: "application/json" };
    if (options.body !== undefined) {
      headers["content-type"] = "application/json";
    }
    if (token !== null) {
      headers.authorization = `Bearer ${token}`;
    }

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: options.method ?? "GET",
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch {
      throw new ApiError({
        code: "network_unreachable",
        message: "The server could not be reached",
        status: 0,
      });
    }

    const payload = await readJson(response);

    if (!response.ok) {
      throw toApiError(response.status, payload);
    }

    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new ApiError({
        code: "malformed_response",
        message: `The server answered ${path} in an unexpected shape`,
        status: response.status,
      });
    }
    return parsed.data;
  }

  getServerConfig(signal?: AbortSignal): Promise<PublicServerConfig> {
    return this.send(publicServerConfigSchema, "/v1/config", signal ? { signal } : {});
  }

  createGuest(displayName?: string): Promise<CreateGuestResponse> {
    return this.send(createGuestResponseSchema, "/v1/guests", {
      method: "POST",
      body: displayName === undefined ? {} : { displayName },
    });
  }

  claimGuest(input: ClaimGuestRequest): Promise<ClaimGuestResponse> {
    return this.send(claimGuestResponseSchema, "/v1/guests/claim", {
      method: "POST",
      body: input,
    });
  }

  register(input: RegisterRequest): Promise<AuthResponse> {
    return this.send(authResponseSchema, "/v1/auth/register", { method: "POST", body: input });
  }

  signIn(input: SignInRequest): Promise<AuthResponse> {
    return this.send(authResponseSchema, "/v1/auth/sign-in", { method: "POST", body: input });
  }

  async signOut(): Promise<void> {
    await this.send(acknowledgementSchema, "/v1/auth/sign-out", { method: "POST" });
  }

  async verifyEmail(token: string): Promise<void> {
    await this.send(acknowledgementSchema, "/v1/auth/verify-email", {
      method: "POST",
      body: { token },
    });
  }

  checkUsername(username: string): Promise<CheckUsernameResponse> {
    return this.send(checkUsernameResponseSchema, "/v1/usernames/check", {
      method: "POST",
      body: { username },
    });
  }

  getMe(signal?: AbortSignal): Promise<MeResponse> {
    return this.send(meResponseSchema, "/v1/me", signal ? { signal } : {});
  }

  updateProfile(patch: UpdateProfileRequest): Promise<MeResponse> {
    return this.send(meResponseSchema, "/v1/me/profile", { method: "PATCH", body: patch });
  }

  getMatchHistory(signal?: AbortSignal): Promise<MatchHistoryResponse> {
    return this.send(matchHistoryResponseSchema, "/v1/me/matches", signal ? { signal } : {});
  }

  getPublicProfile(username: string, signal?: AbortSignal): Promise<PublicProfile> {
    return this.send(
      publicProfileSchema,
      `/v1/profiles/${encodeURIComponent(username)}`,
      signal ? { signal } : {},
    );
  }

  getMatch(matchId: string, signal?: AbortSignal): Promise<MatchSummary> {
    return this.send(
      matchSummarySchema,
      `/v1/matches/${encodeURIComponent(matchId)}`,
      signal ? { signal } : {},
    );
  }

  getMatchSnapshot(matchId: string, signal?: AbortSignal): Promise<MatchSnapshot> {
    return this.send(
      matchSnapshotSchema,
      `/v1/matches/${encodeURIComponent(matchId)}/snapshot`,
      signal ? { signal } : {},
    );
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === "") {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function toApiError(status: number, payload: unknown): ApiError {
  const parsed = httpErrorBodySchema.safeParse(payload);
  if (parsed.success) {
    return new ApiError({
      code: parsed.data.error.code,
      message: parsed.data.error.message,
      status,
      requestId: parsed.data.error.requestId,
      details: parsed.data.error.details ?? [],
    });
  }
  return new ApiError({
    code: "malformed_response",
    message: `The server answered with status ${String(status)}`,
    status,
  });
}
