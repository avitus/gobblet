import type {
  MatchHistoryResponse,
  MeResponse,
  PublicProfile,
  PublicServerConfig,
} from "@gobblet/protocol";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useApi } from "./provider";

export const queryKeys = {
  serverConfig: ["server-config"] as const,
  me: ["me"] as const,
  matchHistory: ["me", "matches"] as const,
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

export function usePublicProfile(username: string): UseQueryResult<PublicProfile> {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.profile(username),
    queryFn: ({ signal }) => api.getPublicProfile(username, signal),
  });
}
