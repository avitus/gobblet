import {
  achievementsResponseSchema,
  adminAchievementListResponseSchema,
  adminAchievementSchema,
  adminActiveMatchesResponseSchema,
  adminAuditResponseSchema,
  adminMatchDetailSchema,
  adminMetricsSummarySchema,
  adminRatingAdjustResponseSchema,
  adminUserDetailSchema,
  adminUserListResponseSchema,
  authResponseSchema,
  checkUsernameResponseSchema,
  claimGuestResponseSchema,
  createGuestResponseSchema,
  httpErrorBodySchema,
  latestReleasesResponseSchema,
  leaderboardResponseSchema,
  matchHistoryResponseSchema,
  matchSnapshotSchema,
  matchSummarySchema,
  meResponseSchema,
  publicProfileSchema,
  publicServerConfigSchema,
} from "@gobblet/protocol";
import type {
  AchievementsResponse,
  AdminAchievement,
  AdminAchievementCreateRequest,
  AdminAchievementListResponse,
  AdminAchievementUpdateRequest,
  AdminActiveMatchesResponse,
  AdminAuditQuery,
  AdminAuditResponse,
  AdminMatchDetail,
  AdminMetricsSummary,
  AdminRatingAdjustRequest,
  AdminRatingAdjustResponse,
  AdminUserDetail,
  AdminUserListResponse,
  AdminUserSearchQuery,
  AuthResponse,
  CheckUsernameResponse,
  ClaimGuestRequest,
  ClaimGuestResponse,
  ClientAnalyticsEvent,
  CreateGuestResponse,
  LatestReleasesResponse,
  LeaderboardPeriod,
  LeaderboardResponse,
  MatchHistoryResponse,
  MatchSnapshot,
  MatchSummary,
  MeResponse,
  PublicProfile,
  PublicServerConfig,
  RegisterRequest,
  SignInRequest,
  TelemetryErrorRequest,
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

  getAchievements(signal?: AbortSignal): Promise<AchievementsResponse> {
    return this.send(achievementsResponseSchema, "/v1/me/achievements", signal ? { signal } : {});
  }

  /**
   * A board is computed at read time, so the caller asks for a period and pages with
   * the cursor the previous page returned (ADR-0028).
   */
  getLeaderboard(
    query: Readonly<{ period: LeaderboardPeriod; cursor?: string }>,
    signal?: AbortSignal,
  ): Promise<LeaderboardResponse> {
    const search = new URLSearchParams({ period: query.period });
    if (query.cursor !== undefined) {
      search.set("cursor", query.cursor);
    }
    return this.send(
      leaderboardResponseSchema,
      `/v1/leaderboards?${search.toString()}`,
      signal ? { signal } : {},
    );
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

  /**
   * The administrative surface of section 16. It is called from the gated routes of
   * the same client, because an administrator is an account with a role rather than
   * a user of a second application (ADR-0029).
   */
  searchUsers(query: AdminUserSearchQuery, signal?: AbortSignal): Promise<AdminUserListResponse> {
    const search = new URLSearchParams();
    if (query.query !== undefined) {
      search.set("query", query.query);
    }
    if (query.status !== undefined) {
      search.set("status", query.status);
    }
    if (query.cursor !== undefined) {
      search.set("cursor", query.cursor);
    }
    const suffix = search.size === 0 ? "" : `?${search.toString()}`;
    return this.send(
      adminUserListResponseSchema,
      `/v1/admin/users${suffix}`,
      signal ? { signal } : {},
    );
  }

  getAdminUser(userId: string, signal?: AbortSignal): Promise<AdminUserDetail> {
    return this.send(
      adminUserDetailSchema,
      `/v1/admin/users/${encodeURIComponent(userId)}`,
      signal ? { signal } : {},
    );
  }

  suspendUser(userId: string, reason: string): Promise<AdminUserDetail> {
    return this.send(
      adminUserDetailSchema,
      `/v1/admin/users/${encodeURIComponent(userId)}/suspend`,
      {
        method: "POST",
        body: { reason },
      },
    );
  }

  reinstateUser(userId: string, reason: string): Promise<AdminUserDetail> {
    return this.send(
      adminUserDetailSchema,
      `/v1/admin/users/${encodeURIComponent(userId)}/reinstate`,
      { method: "POST", body: { reason } },
    );
  }

  adjustRating(
    userId: string,
    input: AdminRatingAdjustRequest,
  ): Promise<AdminRatingAdjustResponse> {
    return this.send(
      adminRatingAdjustResponseSchema,
      `/v1/admin/users/${encodeURIComponent(userId)}/rating`,
      { method: "POST", body: input },
    );
  }

  getActiveMatches(signal?: AbortSignal): Promise<AdminActiveMatchesResponse> {
    return this.send(
      adminActiveMatchesResponseSchema,
      "/v1/admin/matches",
      signal ? { signal } : {},
    );
  }

  getAdminMatch(matchId: string, signal?: AbortSignal): Promise<AdminMatchDetail> {
    return this.send(
      adminMatchDetailSchema,
      `/v1/admin/matches/${encodeURIComponent(matchId)}`,
      signal ? { signal } : {},
    );
  }

  getAdminAchievements(signal?: AbortSignal): Promise<AdminAchievementListResponse> {
    return this.send(
      adminAchievementListResponseSchema,
      "/v1/admin/achievements",
      signal ? { signal } : {},
    );
  }

  createAchievement(input: AdminAchievementCreateRequest): Promise<AdminAchievement> {
    return this.send(adminAchievementSchema, "/v1/admin/achievements", {
      method: "POST",
      body: input,
    });
  }

  updateAchievement(
    achievementId: string,
    input: AdminAchievementUpdateRequest,
  ): Promise<AdminAchievement> {
    return this.send(
      adminAchievementSchema,
      `/v1/admin/achievements/${encodeURIComponent(achievementId)}`,
      { method: "PATCH", body: input },
    );
  }

  getAdminMetrics(signal?: AbortSignal): Promise<AdminMetricsSummary> {
    return this.send(adminMetricsSummarySchema, "/v1/admin/metrics", signal ? { signal } : {});
  }

  getAuditLog(query: AdminAuditQuery, signal?: AbortSignal): Promise<AdminAuditResponse> {
    const search = new URLSearchParams();
    if (query.action !== undefined) {
      search.set("action", query.action);
    }
    if (query.targetId !== undefined) {
      search.set("targetId", query.targetId);
    }
    if (query.cursor !== undefined) {
      search.set("cursor", query.cursor);
    }
    const suffix = search.size === 0 ? "" : `?${search.toString()}`;
    return this.send(
      adminAuditResponseSchema,
      `/v1/admin/audit${suffix}`,
      signal ? { signal } : {},
    );
  }

  /** What the download page offers, which is what the updater is offered (ADR-0035). */
  getLatestReleases(signal?: AbortSignal): Promise<LatestReleasesResponse> {
    return this.send(latestReleasesResponseSchema, "/v1/releases/latest", signal ? { signal } : {});
  }

  /**
   * Analytics and browser errors go to the server, which decides what reaches a
   * provider: no provider software ships to the browser (ADR-0030).
   */
  async sendTelemetryEvents(events: readonly ClientAnalyticsEvent[]): Promise<void> {
    await this.send(acknowledgementSchema, "/v1/telemetry/events", {
      method: "POST",
      body: { events },
    });
  }

  async reportClientError(report: TelemetryErrorRequest): Promise<void> {
    await this.send(acknowledgementSchema, "/v1/telemetry/errors", {
      method: "POST",
      body: report,
    });
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
