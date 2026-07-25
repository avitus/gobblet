import { describe, expect, it, vi } from "vitest";
import { ApiClient, type FetchLike } from "../src/api/client";
import { ApiError, describeApiError, isApiError } from "../src/api/errors";

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
