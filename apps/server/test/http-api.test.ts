import { randomUUID } from "node:crypto";
import { loadServerConfig } from "@gobblet/config";
import type { ServerConfig } from "@gobblet/config";
import type { DatabaseHandle } from "@gobblet/db";
import {
  createDevMatchResponseSchema,
  createGuestResponseSchema,
  httpErrorBodySchema,
  matchSnapshotSchema,
  matchSummarySchema,
} from "@gobblet/protocol";
import type { CreateGuestResponse } from "@gobblet/protocol";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { GuestService } from "../src/guests/service";
import { IdentityService } from "../src/identity/service";
import { LeaderboardService } from "../src/leaderboard/service";
import { MatchRuntime } from "../src/match/runtime";
import { createSilentTelemetry } from "../src/observability/telemetry";
import { adminServiceFixture } from "./helpers/admin-service";
import { TestClock } from "./helpers/match-fixtures";
import { setupTestDatabase, truncateAll } from "./helpers/test-database";

const baseEnv = {
  APP_VERSION: "9.9.9",
  GIT_SHA: "testsha",
  LOG_LEVEL: "fatal" as const,
};

const localConfig = loadServerConfig({ ...baseEnv, APP_ENV: "local" });

let handle: DatabaseHandle;
let clock: TestClock;
let runtime: MatchRuntime;
let guests: GuestService;
let identity: IdentityService;
let leaderboards: LeaderboardService;
let app: FastifyInstance | undefined;

beforeAll(async () => {
  handle = await setupTestDatabase();
});

afterAll(async () => {
  await handle.close();
});

beforeEach(async () => {
  await truncateAll(handle);
  clock = new TestClock();
  runtime = new MatchRuntime({ db: handle.db, now: clock.now });
  guests = new GuestService({ db: handle.db, config: localConfig, now: clock.now });
  identity = new IdentityService({ db: handle.db, config: localConfig, now: clock.now });
  leaderboards = new LeaderboardService({ db: handle.db, now: clock.now });
});

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function start(config: ServerConfig = localConfig): Promise<FastifyInstance> {
  app = await buildApp({
    config,
    services: {
      runtime,
      guests,
      identity,
      leaderboards,
      admin: adminServiceFixture({ db: handle.db, config, runtime, identity, now: clock.now }),
      db: handle.db,
    },
    telemetry: createSilentTelemetry(),
    now: clock.now,
  });
  return app;
}

async function createGuest(server: FastifyInstance): Promise<CreateGuestResponse> {
  const response = await server.inject({ method: "POST", url: "/v1/guests", payload: {} });
  return createGuestResponseSchema.parse(response.json());
}

async function createMatch(
  server: FastifyInstance,
  light: CreateGuestResponse,
  dark: CreateGuestResponse,
): Promise<string> {
  const response = await server.inject({
    method: "POST",
    url: "/v1/dev/matches",
    payload: {
      mode: "casual",
      timeControlSeconds: 300,
      light: { actorType: "guest", actorId: light.guestId, displayName: light.displayName },
      dark: { actorType: "guest", actorId: dark.guestId, displayName: dark.displayName },
    },
  });
  return createDevMatchResponseSchema.parse(response.json()).matchId;
}

describe("POST /v1/guests", () => {
  it("issues a guest session with a generated name", async () => {
    const server = await start();
    const response = await server.inject({ method: "POST", url: "/v1/guests", payload: {} });

    expect(response.statusCode).toBe(201);
    const body = createGuestResponseSchema.parse(response.json());
    expect(body.displayName).toMatch(/^guest-[0-9a-f]{4}$/);
    expect(body.sessionToken.length).toBeGreaterThanOrEqual(32);
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(clock.now());
  });

  it("accepts a chosen display name and trims it", async () => {
    const server = await start();
    const response = await server.inject({
      method: "POST",
      url: "/v1/guests",
      payload: { displayName: "  Ada  " },
    });

    expect(createGuestResponseSchema.parse(response.json()).displayName).toBe("Ada");
  });

  it("rejects a display name that is too short", async () => {
    const server = await start();
    const response = await server.inject({
      method: "POST",
      url: "/v1/guests",
      payload: { displayName: "a" },
    });

    expect(response.statusCode).toBe(400);
    const body = httpErrorBodySchema.parse(response.json());
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.details?.[0]?.path).toBe("displayName");
  });

  it("rejects unknown fields", async () => {
    const server = await start();
    const response = await server.inject({
      method: "POST",
      url: "/v1/guests",
      payload: { displayName: "Ada", isAdmin: true },
    });

    expect(response.statusCode).toBe(400);
  });

  it("never returns the stored token hash", async () => {
    const server = await start();
    const body = await createGuest(server);

    expect(JSON.stringify(body)).not.toContain("tokenHash");
  });

  it("accepts a request with no body at all", async () => {
    const server = await start();
    const response = await server.inject({ method: "POST", url: "/v1/guests" });

    expect(response.statusCode).toBe(201);
  });

  it("issues sessions on the wall clock when none is injected", async () => {
    const service = new GuestService({ db: handle.db, config: localConfig });
    const before = Date.now();

    const guest = await service.createGuest();

    expect(new Date(guest.expiresAt).getTime()).toBeGreaterThanOrEqual(
      before + localConfig.guestSessionTtlDays * 24 * 60 * 60 * 1000,
    );
    expect(await service.authenticate(guest.sessionToken)).toMatchObject({
      guestId: guest.guestId,
    });
  });
});

describe("POST /v1/dev/matches", () => {
  it("creates a match and returns its opening snapshot", async () => {
    const server = await start();
    const light = await createGuest(server);
    const dark = await createGuest(server);

    const response = await server.inject({
      method: "POST",
      url: "/v1/dev/matches",
      payload: {
        mode: "casual",
        timeControlSeconds: 600,
        light: { actorType: "guest", actorId: light.guestId, displayName: light.displayName },
        dark: { actorType: "guest", actorId: dark.guestId, displayName: dark.displayName },
        firstPlayer: "dark",
      },
    });

    expect(response.statusCode).toBe(201);
    const body = createDevMatchResponseSchema.parse(response.json());
    expect(body.snapshot.status).toBe("active");
    expect(body.snapshot.activePlayer).toBe("dark");
    expect(body.snapshot.timeControlSeconds).toBe(600);
    expect(body.snapshot.matchId).toBe(body.matchId);
  });

  it("rejects an unsupported time control", async () => {
    const server = await start();
    const light = await createGuest(server);
    const dark = await createGuest(server);

    const response = await server.inject({
      method: "POST",
      url: "/v1/dev/matches",
      payload: {
        mode: "casual",
        timeControlSeconds: 60,
        light: { actorType: "guest", actorId: light.guestId, displayName: light.displayName },
        dark: { actorType: "guest", actorId: dark.guestId, displayName: dark.displayName },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(httpErrorBodySchema.parse(response.json()).error.code).toBe("validation_failed");
  });

  it("refuses a match against yourself", async () => {
    const server = await start();
    const light = await createGuest(server);

    const response = await server.inject({
      method: "POST",
      url: "/v1/dev/matches",
      payload: {
        mode: "casual",
        timeControlSeconds: 300,
        light: { actorType: "guest", actorId: light.guestId, displayName: light.displayName },
        dark: { actorType: "guest", actorId: light.guestId, displayName: light.displayName },
      },
    });

    expect(response.statusCode).toBe(409);
    expect(httpErrorBodySchema.parse(response.json()).error.code).toBe("conflict");
  });

  it("does not exist in a deployed environment", async () => {
    const server = await start(
      loadServerConfig({ ...baseEnv, APP_ENV: "production", NODE_ENV: "production" }),
    );

    const response = await server.inject({
      method: "POST",
      url: "/v1/dev/matches",
      payload: {},
    });

    expect(response.statusCode).toBe(404);
    expect(httpErrorBodySchema.parse(response.json()).error.code).toBe("not_found");
  });

  it("rejects a request with no body", async () => {
    const server = await start();
    const response = await server.inject({ method: "POST", url: "/v1/dev/matches" });

    expect(response.statusCode).toBe(400);
  });

  it("still exists for automated tests in a staging build", async () => {
    const server = await start(
      loadServerConfig({ ...baseEnv, APP_ENV: "staging", NODE_ENV: "test" }),
    );
    const light = await createGuest(server);
    const dark = await createGuest(server);

    expect(await createMatch(server, light, dark)).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("GET /v1/matches/:matchId", () => {
  it("returns the summary to a participant", async () => {
    const server = await start();
    const light = await createGuest(server);
    const dark = await createGuest(server);
    const matchId = await createMatch(server, light, dark);

    const response = await server.inject({
      method: "GET",
      url: `/v1/matches/${matchId}`,
      headers: { authorization: `Bearer ${dark.sessionToken}` },
    });

    expect(response.statusCode).toBe(200);
    const summary = matchSummarySchema.parse(response.json());
    expect(summary.status).toBe("active");
    expect(summary.players.light.displayName).toBe(light.displayName);
    expect(summary.result).toBeNull();
  });

  it("requires a session token", async () => {
    const server = await start();
    const light = await createGuest(server);
    const dark = await createGuest(server);
    const matchId = await createMatch(server, light, dark);

    const response = await server.inject({ method: "GET", url: `/v1/matches/${matchId}` });

    expect(response.statusCode).toBe(401);
  });

  it("hides the match from a non-participant", async () => {
    const server = await start();
    const light = await createGuest(server);
    const dark = await createGuest(server);
    const stranger = await createGuest(server);
    const matchId = await createMatch(server, light, dark);

    const response = await server.inject({
      method: "GET",
      url: `/v1/matches/${matchId}`,
      headers: { authorization: `Bearer ${stranger.sessionToken}` },
    });

    expect(response.statusCode).toBe(404);
  });

  it("returns 404 for an unknown match and for a malformed id", async () => {
    const server = await start();
    const light = await createGuest(server);
    const headers = { authorization: `Bearer ${light.sessionToken}` };

    expect(
      (await server.inject({ method: "GET", url: `/v1/matches/${randomUUID()}`, headers }))
        .statusCode,
    ).toBe(404);
    expect(
      (await server.inject({ method: "GET", url: "/v1/matches/not-a-uuid", headers })).statusCode,
    ).toBe(404);
  });
});

describe("GET /v1/matches/:matchId/snapshot", () => {
  it("serves a participant", async () => {
    const server = await start();
    const light = await createGuest(server);
    const dark = await createGuest(server);
    const matchId = await createMatch(server, light, dark);

    const response = await server.inject({
      method: "GET",
      url: `/v1/matches/${matchId}/snapshot`,
      headers: { authorization: `Bearer ${light.sessionToken}` },
    });

    expect(response.statusCode).toBe(200);
    const snapshot = matchSnapshotSchema.parse(response.json());
    expect(snapshot.matchId).toBe(matchId);
    expect(snapshot.version).toBe(0);
  });

  it("requires a session token", async () => {
    const server = await start();
    const light = await createGuest(server);
    const dark = await createGuest(server);
    const matchId = await createMatch(server, light, dark);

    const response = await server.inject({
      method: "GET",
      url: `/v1/matches/${matchId}/snapshot`,
    });

    expect(response.statusCode).toBe(401);
    expect(httpErrorBodySchema.parse(response.json()).error.code).toBe("unauthenticated");
  });

  it("rejects a malformed authorization header", async () => {
    const server = await start();
    const light = await createGuest(server);
    const dark = await createGuest(server);
    const matchId = await createMatch(server, light, dark);

    for (const authorization of ["", "Bearer", "Bearer   ", `Basic ${light.sessionToken}`]) {
      const response = await server.inject({
        method: "GET",
        url: `/v1/matches/${matchId}/snapshot`,
        headers: { authorization },
      });
      expect(response.statusCode).toBe(401);
    }
  });

  it("rejects an unknown token", async () => {
    const server = await start();
    const light = await createGuest(server);
    const dark = await createGuest(server);
    const matchId = await createMatch(server, light, dark);

    const response = await server.inject({
      method: "GET",
      url: `/v1/matches/${matchId}/snapshot`,
      headers: { authorization: "Bearer not-a-real-token" },
    });

    expect(response.statusCode).toBe(401);
  });

  it("rejects an expired session", async () => {
    const server = await start();
    const light = await createGuest(server);
    const dark = await createGuest(server);
    const matchId = await createMatch(server, light, dark);
    clock.advance(31 * 24 * 60 * 60 * 1000);

    const response = await server.inject({
      method: "GET",
      url: `/v1/matches/${matchId}/snapshot`,
      headers: { authorization: `Bearer ${light.sessionToken}` },
    });

    expect(response.statusCode).toBe(401);
  });

  it("hides the match from a non-participant", async () => {
    const server = await start();
    const light = await createGuest(server);
    const dark = await createGuest(server);
    const stranger = await createGuest(server);
    const matchId = await createMatch(server, light, dark);

    const response = await server.inject({
      method: "GET",
      url: `/v1/matches/${matchId}/snapshot`,
      headers: { authorization: `Bearer ${stranger.sessionToken}` },
    });

    expect(response.statusCode).toBe(404);
  });

  it("returns 404 for an unknown match and for a malformed id", async () => {
    const server = await start();
    const light = await createGuest(server);
    const headers = { authorization: `Bearer ${light.sessionToken}` };

    expect(
      (
        await server.inject({
          method: "GET",
          url: `/v1/matches/${randomUUID()}/snapshot`,
          headers,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await server.inject({ method: "GET", url: "/v1/matches/nope/snapshot", headers }))
        .statusCode,
    ).toBe(404);
  });
});
