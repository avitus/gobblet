import { loadServerConfig } from "@gobblet/config";
import { hashToken } from "@gobblet/auth";
import { findGuestSessionByTokenHash } from "@gobblet/db";
import type { DatabaseHandle } from "@gobblet/db";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bootstrapServer, requireDatabaseUrl } from "../src/bootstrap";
import type { BootstrappedServer } from "../src/bootstrap";
import { MatchRuntime } from "../src/match/runtime";
import { DARK_ACTOR, LIGHT_ACTOR } from "./helpers/match-fixtures";
import { TestClient } from "./helpers/socket-client";
import { TEST_DATABASE_URL, setupTestDatabase, truncateAll } from "./helpers/test-database";

const env = {
  APP_ENV: "local" as const,
  APP_VERSION: "9.9.9",
  GIT_SHA: "testsha",
  LOG_LEVEL: "fatal" as const,
  DATABASE_URL: TEST_DATABASE_URL,
};

let handle: DatabaseHandle;
let server: BootstrappedServer | undefined;

beforeAll(async () => {
  handle = await setupTestDatabase();
});

afterAll(async () => {
  await handle.close();
});

beforeEach(async () => {
  await truncateAll(handle);
});

afterEach(async () => {
  await server?.close();
  server = undefined;
});

/** How far ahead of the database's own clock an injected one runs, in milliseconds. */
const AHEAD_MS = 60_000;

async function createGuest(booted: BootstrappedServer): Promise<string> {
  const created = await booted.app.inject({ method: "POST", url: "/v1/guests", payload: {} });
  return created.json<{ sessionToken: string }>().sessionToken;
}

async function connectTo(booted: BootstrappedServer): Promise<TestClient> {
  await booted.app.listen({ host: "127.0.0.1", port: 0 });
  const address = booted.app.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected a TCP address");
  }
  const client = new TestClient(`http://127.0.0.1:${address.port}`);
  await client.connect();
  return client;
}

function authenticateFrame(sessionToken: string): Record<string, string> {
  return { clientVersion: "0.1.0", appEnv: "local", sessionToken };
}

/** Read through the suite's own handle, which outlives the server under test. */
async function lastSeenAt(sessionToken: string): Promise<Date> {
  const session = await findGuestSessionByTokenHash(handle.db, hashToken(sessionToken));
  if (session === undefined) {
    throw new Error("expected the guest session to exist");
  }
  return session.lastSeenAt;
}

describe("requireDatabaseUrl", () => {
  it("names the missing variable instead of failing at the first request", () => {
    const config = loadServerConfig({ APP_ENV: "local", LOG_LEVEL: "fatal" });

    expect(() => requireDatabaseUrl(config)).toThrow(/DATABASE_URL is required/);
  });

  it("returns the configured url", () => {
    expect(requireDatabaseUrl(loadServerConfig(env))).toBe(TEST_DATABASE_URL);
  });
});

describe("bootstrapServer", () => {
  it("reports readiness through a real database probe", async () => {
    server = await bootstrapServer({ config: loadServerConfig(env) });

    const response = await server.app.inject({ method: "GET", url: "/health/ready" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ready", checks: [{ name: "database", ok: true }] });
  });

  it("serves the match endpoints", async () => {
    server = await bootstrapServer({ config: loadServerConfig(env) });

    const response = await server.app.inject({ method: "POST", url: "/v1/guests", payload: {} });

    expect(response.statusCode).toBe(201);
  });

  it("settles matches whose clock expired while the process was down", async () => {
    // Started far enough in the past that the real boot clock always sees it expired.
    const startedAt = Date.now() - 10 * 60 * 1000;
    const runtime = new MatchRuntime({ db: handle.db, now: () => startedAt });
    const match = await runtime.createMatch({
      mode: "casual",
      timeControlSeconds: 180,
      light: LIGHT_ACTOR,
      dark: DARK_ACTOR,
    });

    server = await bootstrapServer({ config: loadServerConfig(env) });

    expect(server.settledOnBoot).toBe(1);
    const settled = await server.runtime.getSnapshotForActor(match.matchId, LIGHT_ACTOR);
    expect(settled?.status).toBe("completed");
    expect(settled?.result).toEqual({ outcome: "dark", reason: "timeout" });
  });

  it("gives the dashboard the readiness and the sockets of the running process", async () => {
    server = await bootstrapServer({ config: loadServerConfig(env) });

    const summary = await server.admin.metricsSummary();

    expect(summary.health).toEqual({ ready: true, checks: [{ name: "database", ok: true }] });
    expect(summary.sockets).toEqual({ connected: 0 });
    expect(summary.deployment).toMatchObject({ appVersion: "9.9.9", gitSha: "testsha" });
  });

  it("exposes the gauges of the running process when metrics are published", async () => {
    server = await bootstrapServer({
      config: loadServerConfig({ ...env, METRICS_ENABLED: "true" }),
    });

    const response = await server.app.inject({ method: "GET", url: "/metrics" });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("gobblet_active_matches 0");
    expect(response.body).toContain("gobblet_socket_connections 0");
    expect(response.body).toContain("gobblet_queue_depth");
  });

  it("finishes work a socket frame started before it closes the pool", async () => {
    // A shutdown that ended the pool under a handler still in flight would abandon a
    // half-written command and leave an unhandled rejection in a deployment's log.
    const running: { server?: BootstrappedServer } = {};
    let closing: Promise<void> | undefined;
    let armed = false;
    let heldWhenClosingBegan = 0;
    let reachedTheClock = (): void => {};
    const shuttingDown = new Promise<void>((resolve) => {
      reachedTheClock = resolve;
    });
    const booted = await bootstrapServer({
      config: loadServerConfig(env),
      // Read by the authenticate handler between its read and its write, which is the
      // window a shutdown must not close over and the hardest one to hit by waiting.
      // From that moment the clock jumps a minute, so the timestamp a handler writes
      // says whether it was written before the shutdown or during it.
      now: () => {
        const server = running.server;
        if (armed && closing === undefined && server !== undefined) {
          heldWhenClosingBegan = server.gateway.workInFlight();
          closing = server.close();
          reachedTheClock();
        }
        return Date.now() + (closing === undefined ? 0 : AHEAD_MS);
      },
    });
    running.server = booted;
    const sessionToken = await createGuest(booted);
    const client = await connectTo(booted);
    const before = await lastSeenAt(sessionToken);

    armed = true;
    // The acknowledgement is not awaited: the socket is closed under it on purpose.
    client.emitIgnoringAck("session:authenticate", authenticateFrame(sessionToken));
    await shuttingDown;
    await closing;
    client.close();

    // The gateway was holding the handler when the shutdown began, and the timestamp
    // it wrote is from after that moment, so the write was not abandoned.
    expect(heldWhenClosingBegan).toBe(1);
    const moved = (await lastSeenAt(sessionToken)).getTime() - before.getTime();
    expect(moved).toBeGreaterThan(AHEAD_MS / 2);
  });

  it("refuses socket work that arrives after it has begun closing", async () => {
    const booted = await bootstrapServer({ config: loadServerConfig(env) });
    const sessionToken = await createGuest(booted);
    const client = await connectTo(booted);
    const [serverSocket] = [...booted.gateway.io.sockets.sockets.values()];
    if (serverSocket === undefined) {
      throw new Error("expected the gateway to have accepted the connection");
    }
    // Held before the shutdown, because delivering a frame afterwards is the point.
    const deliver = serverSocket.listeners("session:authenticate")[0] as
      ((payload: unknown, ack: (response: unknown) => void) => void) | undefined;
    if (deliver === undefined) {
      throw new Error("expected the gateway to register an authenticate handler");
    }
    const before = await lastSeenAt(sessionToken);

    await booted.close();
    deliver(authenticateFrame(sessionToken), () => {});
    client.close();

    expect(booted.gateway.accepts()).toBe(false);
    expect(await lastSeenAt(sessionToken)).toEqual(before);
  });

  it("refuses to start when the database is unreachable", async () => {
    await expect(
      bootstrapServer({
        config: loadServerConfig({
          ...env,
          DATABASE_URL: TEST_DATABASE_URL.replace(":5432", ":5433"),
        }),
      }),
    ).rejects.toThrow();
  });
});
