import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { clientConfig } from "../config";
import { sessionToken } from "../session/store";
import { ApiClient } from "./client";
import { isApiError } from "./errors";

const ApiContext = createContext<ApiClient | null>(null);

export function useApi(): ApiClient {
  const client = useContext(ApiContext);
  if (client === null) {
    throw new Error("useApi was called outside an ApiProvider");
  }
  return client;
}

/**
 * Retrying a rejected credential or a missing profile only delays the error the
 * player needs to see, so only transport and server faults are retried.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) => {
          if (failureCount >= 2) {
            return false;
          }
          return isApiError(error)
            ? error.code === "network_unreachable" ||
                error.code === "internal_error" ||
                error.code === "dependency_unavailable"
            : false;
        },
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  });
}

export type ApiProviderProps = Readonly<{
  children: ReactNode;
  client?: ApiClient;
  queryClient?: QueryClient;
}>;

export function ApiProvider({
  children,
  client,
  queryClient,
}: ApiProviderProps): React.JSX.Element {
  const apiClient = useMemo(
    () => client ?? new ApiClient({ baseUrl: clientConfig.apiBaseUrl, sessionToken }),
    [client],
  );
  const queries = useMemo(() => queryClient ?? createQueryClient(), [queryClient]);

  return (
    <QueryClientProvider client={queries}>
      <ApiContext.Provider value={apiClient}>{children}</ApiContext.Provider>
    </QueryClientProvider>
  );
}
