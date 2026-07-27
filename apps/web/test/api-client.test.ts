import { describe, expect, it, vi } from "vitest";
import { ApiClient, type FetchLike } from "../src/api/client";
import { ApiError, describeApiError, isApiError } from "../src/api/errors";
import { LIGHT_ACTOR_ID, MATCH_ID, makeSnapshot } from "./helpers/match";

const MATCH_SUMMARY = {
  matchId: MATCH_ID,
  mode: "casual",
  timeControlSeconds: 300,
  status: "completed",
  result: { outcome: "draw", reason: "repetition" },
  players: makeSnapshot().players,
  moveCount: 22,
  createdAt: "2026-07-20T09:00:00.000Z",
  startedAt: "2026-07-20T09:00:01.000Z",
  endedAt: "2026-07-20T09:08:00.000Z",
};

const LEADERBOARD = {
  period: "all-time",
  periodStart: null,
  periodEnd: null,
  generatedAt: "2026-07-25T08:00:00.000Z",
  entries: [],
  nextCursor: null,
  you: null,
};

const CONFIG = {
  appEnv: "local",
  appVersion: "1.0.0",
  minSupportedClientVersion: "0.1.0",
  modes: ["casual", "ranked"],
  timeControlsSeconds: [180, 300, 600, 900],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function clientWith(fetchImpl: FetchLike, token: string | null = null): ApiClient {
  return new ApiClient({
    baseUrl: "http://server.test/",
    fetch: fetchImpl,
    sessionToken: () => token,
  });
}

describe("ApiClient", () => {
  it("reads the published releases without an abort signal to hand it", async () => {
    const client = clientWith(() => Promise.resolve(jsonResponse({ stable: null, beta: null })));

    await expect(client.getLatestReleases()).resolves.toEqual({ stable: null, beta: null });
  });

  it("validates the answer against the shared schema", async () => {
    const client = clientWith(() => Promise.resolve(jsonResponse(CONFIG)));

    await expect(client.getServerConfig()).resolves.toMatchObject({ appEnv: "local" });
  });

  it("rejects an answer that does not match the contract", async () => {
    const client = clientWith(() => Promise.resolve(jsonResponse({ appEnv: "test" })));

    await expect(client.getServerConfig()).rejects.toMatchObject({
      code: "malformed_response",
    });
  });

  it("sends the bearer token when there is one and omits it otherwise", async () => {
    const seen: (string | undefined)[] = [];
    const fetchImpl: FetchLike = (_input, init) => {
      const headers = init?.headers as Record<string, string> | undefined;
      seen.push(headers?.authorization);
      return Promise.resolve(jsonResponse(CONFIG));
    };

    await clientWith(fetchImpl, "tok").getServerConfig();
    await clientWith(fetchImpl).getServerConfig();

    expect(seen).toEqual(["Bearer tok", undefined]);
  });

  it("sends a JSON body and a content type only when there is a body", async () => {
    const inits: RequestInit[] = [];
    const fetchImpl: FetchLike = (_input, init) => {
      inits.push(init ?? {});
      return Promise.resolve(new Response(null, { status: 204 }));
    };
    const client = clientWith(fetchImpl, "tok");

    await client.signOut();
    await client.verifyEmail("token-value");

    expect(inits[0]?.body).toBeUndefined();
    expect((inits[0]?.headers as Record<string, string>)["content-type"]).toBeUndefined();
    expect(inits[1]?.body).toBe(JSON.stringify({ token: "token-value" }));
    expect((inits[1]?.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });

  it("turns a problem document into an ApiError with its code and request id", async () => {
    const client = clientWith(() =>
      Promise.resolve(
        jsonResponse(
          {
            error: {
              code: "conflict",
              message: "Email already registered",
              requestId: "req-7",
              details: [{ path: "email", issue: "custom" }],
            },
          },
          409,
        ),
      ),
    );

    const error: unknown = await client
      .register({ email: "a@b.co", password: "correct horse 1", username: "ada" })
      .catch((caught: unknown) => caught);

    expect(isApiError(error)).toBe(true);
    expect(error).toMatchObject({
      code: "conflict",
      status: 409,
      requestId: "req-7",
      message: "Email already registered",
    });
    expect((error as ApiError).details).toHaveLength(1);
  });

  it("describes an unparseable error body by its status", async () => {
    const client = clientWith(() => Promise.resolve(new Response("<html>oops", { status: 502 })));

    await expect(client.getMe()).rejects.toMatchObject({
      code: "malformed_response",
      status: 502,
    });
  });

  it("reports an unreachable server rather than throwing the transport error", async () => {
    const client = clientWith(() => Promise.reject(new TypeError("Failed to fetch")));

    const error: unknown = await client.getServerConfig().catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: "network_unreachable", status: 0 });
    expect(describeApiError(error)).toBe("The server could not be reached");
  });

  it("passes the abort signal through", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<FetchLike>(() => Promise.resolve(jsonResponse(CONFIG)));
    const client = clientWith(fetchImpl);

    await client.getServerConfig(controller.signal);

    expect(fetchImpl.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });

  it("escapes path parameters", async () => {
    const urls: string[] = [];
    const fetchImpl: FetchLike = (input) => {
      urls.push(input);
      return Promise.resolve(jsonResponse({ matches: [] }));
    };
    const client = clientWith(fetchImpl);

    await client.getMatchHistory();
    await expect(client.getPublicProfile("a b/c")).rejects.toBeInstanceOf(ApiError);

    expect(urls).toEqual([
      "http://server.test/v1/me/matches",
      "http://server.test/v1/profiles/a%20b%2Fc",
    ]);
  });

  it("names a guest only when the caller asked for a name", async () => {
    const bodies: (BodyInit | null | undefined)[] = [];
    const fetchImpl: FetchLike = (_input, init) => {
      bodies.push(init?.body);
      return Promise.resolve(
        jsonResponse({
          guestId: LIGHT_ACTOR_ID,
          displayName: "Guest 1234",
          sessionToken: "session-token",
          expiresAt: "2026-08-01T00:00:00.000Z",
        }),
      );
    };
    const client = clientWith(fetchImpl);

    await client.createGuest();
    await client.createGuest("Ada");

    expect(bodies).toEqual([JSON.stringify({}), JSON.stringify({ displayName: "Ada" })]);
  });

  it("reads a single match and its snapshot, with or without a signal", async () => {
    const controller = new AbortController();
    const urls: string[] = [];
    const signals: (AbortSignal | null | undefined)[] = [];
    const fetchImpl: FetchLike = (input, init) => {
      urls.push(input);
      signals.push(init?.signal);
      return Promise.resolve(
        jsonResponse(urls.length <= 2 ? MATCH_SUMMARY : makeSnapshot({ version: 3 })),
      );
    };
    const client = clientWith(fetchImpl);

    await expect(client.getMatch(MATCH_ID)).resolves.toMatchObject({ mode: "casual" });
    await client.getMatch(MATCH_ID, controller.signal);
    await expect(client.getMatchSnapshot(MATCH_ID)).resolves.toMatchObject({ version: 3 });
    await client.getMatchSnapshot(MATCH_ID, controller.signal);

    expect(urls).toEqual([
      `http://server.test/v1/matches/${MATCH_ID}`,
      `http://server.test/v1/matches/${MATCH_ID}`,
      `http://server.test/v1/matches/${MATCH_ID}/snapshot`,
      `http://server.test/v1/matches/${MATCH_ID}/snapshot`,
    ]);
    expect(signals).toEqual([undefined, controller.signal, undefined, controller.signal]);
  });

  it("asks for a leaderboard period, and pages with the cursor it was given", async () => {
    const controller = new AbortController();
    const urls: string[] = [];
    const signals: (AbortSignal | null | undefined)[] = [];
    const fetchImpl: FetchLike = (input, init) => {
      urls.push(input);
      signals.push(init?.signal);
      return Promise.resolve(jsonResponse(LEADERBOARD));
    };
    const client = clientWith(fetchImpl);

    await expect(client.getLeaderboard({ period: "weekly" })).resolves.toMatchObject({
      period: "all-time",
    });
    await client.getLeaderboard(
      { period: "daily", cursor: "1380.9.14.1784889600000.abc" },
      controller.signal,
    );

    expect(urls).toEqual([
      "http://server.test/v1/leaderboards?period=weekly",
      "http://server.test/v1/leaderboards?period=daily&cursor=1380.9.14.1784889600000.abc",
    ]);
    expect(signals).toEqual([undefined, controller.signal]);
  });

  it("reads the achievement catalogue with the caller's progress", async () => {
    const controller = new AbortController();
    const signals: (AbortSignal | null | undefined)[] = [];
    const client = clientWith((_input, init) => {
      signals.push(init?.signal);
      return Promise.resolve(jsonResponse({ achievements: [] }));
    });

    await expect(client.getAchievements()).resolves.toEqual({ achievements: [] });
    await client.getAchievements(controller.signal);

    expect(signals).toEqual([undefined, controller.signal]);
  });

  it("reads every administrative page without a signal when none is given", async () => {
    const urls: string[] = [];
    const signals: (AbortSignal | null | undefined)[] = [];
    const client = clientWith((input, init) => {
      urls.push(input);
      signals.push(init?.signal);
      return Promise.resolve(jsonResponse(null));
    });

    await Promise.allSettled([
      client.searchUsers({}),
      client.getAdminUser("22222222-2222-4222-8222-222222222222"),
      client.getActiveMatches(),
      client.getAdminMatch("11111111-1111-4111-8111-111111111111"),
      client.getAdminAchievements(),
      client.getAdminMetrics(),
      client.getAuditLog({}),
    ]);

    expect(urls).toEqual([
      "http://server.test/v1/admin/users",
      "http://server.test/v1/admin/users/22222222-2222-4222-8222-222222222222",
      "http://server.test/v1/admin/matches",
      "http://server.test/v1/admin/matches/11111111-1111-4111-8111-111111111111",
      "http://server.test/v1/admin/achievements",
      "http://server.test/v1/admin/metrics",
      "http://server.test/v1/admin/audit",
    ]);
    expect(signals.every((signal) => signal === undefined)).toBe(true);
  });

  it("narrows the audit log to an action, a target and a page", async () => {
    const urls: string[] = [];
    const client = clientWith((input) => {
      urls.push(input);
      return Promise.resolve(jsonResponse({ entries: [], nextCursor: null }));
    });

    await client.getAuditLog({});
    await client.getAuditLog({
      action: "user-suspended",
      targetId: "22222222-2222-4222-8222-222222222222",
      cursor: "1784889600000.7",
    });

    expect(urls).toEqual([
      "http://server.test/v1/admin/audit",
      "http://server.test/v1/admin/audit?action=user-suspended&targetId=22222222-2222-4222-8222-222222222222&cursor=1784889600000.7",
    ]);
  });

  it("treats an empty body as no payload", async () => {
    const client = clientWith(() => Promise.resolve(new Response("", { status: 200 })));

    await expect(client.signOut()).resolves.toBeUndefined();
  });

  it("defaults to the global fetch when none is injected", async () => {
    const stub = vi.fn(() => Promise.resolve(jsonResponse(CONFIG)));
    vi.stubGlobal("fetch", stub);

    const client = new ApiClient({ baseUrl: "http://server.test" });
    await expect(client.getServerConfig()).resolves.toMatchObject({ appVersion: "1.0.0" });

    expect(stub).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("describes a non-API error as its message", () => {
    expect(describeApiError(new Error("boom"))).toBe("boom");
    expect(describeApiError("nope")).toBe("Something went wrong");
  });
});
