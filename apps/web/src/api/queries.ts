import type {
  AchievementsResponse,
  AdminAchievementListResponse,
  AdminActiveMatchesResponse,
  AdminAuditResponse,
  AdminMatchDetail,
  AdminMetricsSummary,
  AdminUserDetail,
  AdminUserListResponse,
  AdminUserSearchQuery,
  LeaderboardPeriod,
  LeaderboardResponse,
  MatchHistoryResponse,
  MeResponse,
  PublicProfile,
  PublicServerConfig,
} from "@gobblet/protocol";
import {
  useInfiniteQuery,
  useQuery,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useApi } from "./provider";

export const queryKeys = {
  serverConfig: ["server-config"] as const,
  me: ["me"] as const,
  matchHistory: ["me", "matches"] as const,
  achievements: ["me", "achievements"] as const,
  leaderboards: ["leaderboard"] as const,
  leaderboard: (period: LeaderboardPeriod) => ["leaderboard", period] as const,
  profile: (username: string) => ["profile", username] as const,
  admin: ["admin"] as const,
  adminUsers: (query: AdminUserSearchQuery) =>
    ["admin", "users", query.query ?? "", query.status ?? ""] as const,
  adminUser: (userId: string) => ["admin", "user", userId] as const,
  adminMatches: ["admin", "matches"] as const,
  adminMatch: (matchId: string) => ["admin", "match", matchId] as const,
  adminAchievements: ["admin", "achievements"] as const,
  adminMetrics: ["admin", "metrics"] as const,
  adminAudit: ["admin", "audit"] as const,
};

/**
 * What a finished match changes about the reader: their rating, their record, their
 * rank, their history and their badges. A board is read at read time (ADR-0028), so
 * the cached copies are dropped rather than patched.
 */
export const COMPLETED_MATCH_QUERY_KEYS: readonly (readonly string[])[] = Object.freeze([
  queryKeys.me,
  queryKeys.matchHistory,
  queryKeys.achievements,
  queryKeys.leaderboards,
]);

export function useServerConfig(): UseQueryResult<PublicServerConfig> {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.serverConfig,
    queryFn: ({ signal }) => api.getServerConfig(signal),
    staleTime: 5 * 60_000,
  });
}

export function useMe(enabled: boolean): UseQueryResult<MeResponse> {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: ({ signal }) => api.getMe(signal),
    enabled,
  });
}

export function useMatchHistory(enabled: boolean): UseQueryResult<MatchHistoryResponse> {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.matchHistory,
    queryFn: ({ signal }) => api.getMatchHistory(signal),
    enabled,
  });
}

export function useAchievements(enabled: boolean): UseQueryResult<AchievementsResponse> {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.achievements,
    queryFn: ({ signal }) => api.getAchievements(signal),
    enabled,
  });
}

/**
 * Pages by the cursor the previous page returned rather than by an offset, because a
 * rating that moves between requests must not make a page skip or repeat an account
 * (ADR-0028).
 */
export function useLeaderboard(
  period: LeaderboardPeriod,
): UseInfiniteQueryResult<InfiniteData<LeaderboardResponse>> {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: queryKeys.leaderboard(period),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      api.getLeaderboard({ period, ...(pageParam === null ? {} : { cursor: pageParam }) }, signal),
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function usePublicProfile(username: string): UseQueryResult<PublicProfile> {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.profile(username),
    queryFn: ({ signal }) => api.getPublicProfile(username, signal),
  });
}

/**
 * The dashboard reads. Every one of them is asked for only once the role is known,
 * so a player never sends a request the server would refuse (ADR-0029).
 */
export function useAdminUsers(
  query: AdminUserSearchQuery,
  enabled: boolean,
): UseInfiniteQueryResult<InfiniteData<AdminUserListResponse>> {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: queryKeys.adminUsers(query),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      api.searchUsers({ ...query, ...(pageParam === null ? {} : { cursor: pageParam }) }, signal),
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  });
}

export function useAdminUser(userId: string, enabled: boolean): UseQueryResult<AdminUserDetail> {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.adminUser(userId),
    queryFn: ({ signal }) => api.getAdminUser(userId, signal),
    enabled,
  });
}

export function useAdminMatches(enabled: boolean): UseQueryResult<AdminActiveMatchesResponse> {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.adminMatches,
    queryFn: ({ signal }) => api.getActiveMatches(signal),
    enabled,
  });
}

export function useAdminMatch(matchId: string, enabled: boolean): UseQueryResult<AdminMatchDetail> {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.adminMatch(matchId),
    queryFn: ({ signal }) => api.getAdminMatch(matchId, signal),
    enabled,
  });
}

export function useAdminAchievements(
  enabled: boolean,
): UseQueryResult<AdminAchievementListResponse> {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.adminAchievements,
    queryFn: ({ signal }) => api.getAdminAchievements(signal),
    enabled,
  });
}

export function useAdminMetrics(enabled: boolean): UseQueryResult<AdminMetricsSummary> {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.adminMetrics,
    queryFn: ({ signal }) => api.getAdminMetrics(signal),
    enabled,
  });
}

export function useAdminAudit(
  enabled: boolean,
): UseInfiniteQueryResult<InfiniteData<AdminAuditResponse>> {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: queryKeys.adminAudit,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      api.getAuditLog(pageParam === null ? {} : { cursor: pageParam }, signal),
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  });
}
