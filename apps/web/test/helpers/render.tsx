import { render, type RenderResult } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { ApiClient, type FetchLike } from "../../src/api/client";
import { ApiProvider } from "../../src/api/provider";

export function testQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

export type RouteResponse = Readonly<{
  status?: number;
  body?: unknown;
}>;

export type RouteTable = Readonly<Record<string, RouteResponse | (() => RouteResponse)>>;

/**
 * A fetch stand-in keyed by "METHOD /path". Anything not listed answers 404,
 * which surfaces a forgotten route as a test failure rather than a hang.
 */
export function fakeFetch(routes: RouteTable): { fetch: FetchLike; calls: string[] } {
  const calls: string[] = [];
  const fetchImpl: FetchLike = (input, init) => {
    const method = init?.method ?? "GET";
    const path = new URL(input, "http://server.test").pathname;
    const key = `${method} ${path}`;
    calls.push(key);
    const entry = routes[key];
    const resolved = typeof entry === "function" ? entry() : entry;
    if (resolved === undefined) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            error: { code: "not_found", message: `No stub for ${key}`, requestId: "test" },
          }),
          { status: 404, headers: { "content-type": "application/json" } },
        ),
      );
    }
    return Promise.resolve(
      new Response(resolved.body === undefined ? null : JSON.stringify(resolved.body), {
        status: resolved.status ?? 200,
        headers: { "content-type": "application/json" },
      }),
    );
  };
  return { fetch: fetchImpl, calls };
}

export type RenderAppOptions = Readonly<{
  routes?: RouteTable;
  initialPath?: string;
  sessionToken?: () => string | null;
}>;

export function renderWithProviders(
  ui: ReactNode,
  options: RenderAppOptions = {},
): RenderResult & { calls: string[] } {
  const { fetch: fetchImpl, calls } = fakeFetch(options.routes ?? {});
  const client = new ApiClient({
    baseUrl: "http://server.test",
    fetch: fetchImpl,
    ...(options.sessionToken ? { sessionToken: options.sessionToken } : {}),
  });

  const result = render(
    <ApiProvider client={client} queryClient={testQueryClient()}>
      <MemoryRouter initialEntries={[options.initialPath ?? "/"]}>{ui}</MemoryRouter>
    </ApiProvider>,
  );

  return { ...result, calls };
}
