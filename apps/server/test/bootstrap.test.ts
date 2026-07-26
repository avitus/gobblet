import { loadServerConfig } from "@gobblet/config";
import type { DatabaseHandle } from "@gobblet/db";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bootstrapServer, requireDatabaseUrl } from "../src/bootstrap";
import type { BootstrappedServer } from "../src/bootstrap";
import { MatchRuntime } from "../src/match/runtime";
import { DARK_ACTOR, LIGHT_ACTOR } from "./helpers/match-fixtures";
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
