import type {
  AchievementsResponse,
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
  leaderboard: (period: LeaderboardPeriod) => ["leaderboard", period] as const,
  profile: (username: string) => ["profile", username] as const,
};

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
