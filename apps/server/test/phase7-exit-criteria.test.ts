import { randomUUID } from "node:crypto";
import { loadServerConfig } from "@gobblet/config";
import { countAuditRecords, findMatchById, listAuditRecords, setUserRole } from "@gobblet/db";
import type { DatabaseHandle } from "@gobblet/db";
import {
  adminUserDetailSchema,
  authResponseSchema,
  httpErrorBodySchema,
  matchSnapshotSchema,
  queueJoinAckSchema,
} from "@gobblet/protocol";
import type {
  AuthResponse,
  CommandAck,
  MatchFoundEvent,
  MatchSyncAck,
  QueueJoinAck,
  RecoverableError,
  SessionAuthenticateAck,
} from "@gobblet/protocol";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bootstrapServer } from "../src/bootstrap";
import type { BootstrappedServer } from "../src/bootstrap";
import { ALERT_DEFINITIONS } from "../src/observability/alerts";
import { TestClock, WINNING_SCRIPT, envelope } from "./helpers/match-fixtures";
import { fires, parseExposition } from "./helpers/prometheus";
import type { Sample } from "./helpers/prometheus";
import { TestClient } from "./helpers/socket-client";
import { TEST_DATABASE_URL, setupTestDatabase, truncateAll } from "./helpers/test-database";

/**
 * The Phase 7 exit criteria of spec section 24: administrative actions are audited,
 * alerts fire in a controlled failure, and a deployment preserves or recovers the
 * matches that were being played while it happened. The fourth criterion, that a
 * backup restores, is a database round trip and is proved where the tools live, in
 * `packages/db/test/backup-restore.test.ts`.
 */

const env = {
  APP_ENV: "local" as const,
  APP_VERSION: "9.9.9",
  GIT_SHA: "testsha",
  LOG_LEVEL: "fatal" as const,
  DATABASE_URL: TEST_DATABASE_URL,
  METRICS_ENABLED: "true",
};

const CLIENT_VERSION = "0.1.0";
const PASSWORD = "correct-horse-7";
const CASUAL = { mode: "casual", timeControlSeconds: 300 } as const;
const REASON = "Repeated abuse reports from three separate matches.";

let handle: DatabaseHandle;
let clock: TestClock;
let servers: BootstrappedServer[] = [];
let clients: TestClient[] = [];

beforeAll(async () => {
  handle = await setupTestDatabase();
});

afterAll(async () => {
  await handle.close();
});

beforeEach(async () => {
  await truncateAll(handle);
  clock = new TestClock();
});

afterEach(async () => {
  for (const client of clients) {
    client.close();
  }
  clients = [];
  for (const server of servers.reverse()) {
    await server.close();
  }
  servers = [];
});

type RunningServer = Readonly<{ server: BootstrappedServer; url: string }>;

async function boot(): Promise<RunningServer> {
  const server = await bootstrapServer({ config: loadServerConfig(env), now: clock.now });
  servers.push(server);
  await server.app.listen({ host: "127.0.0.1", port: 0 });

  const address = server.app.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected a TCP address");
  }
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function account(server: BootstrappedServer, username: string): Promise<AuthResponse> {
  const registered = await server.app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: { email: `${username}@example.com`, password: PASSWORD, username },
  });
  expect(registered.statusCode).toBe(201);
  const auth = authResponseSchema.parse(registered.json());

  const verified = await server.app.inject({
    method: "POST",
    url: "/v1/auth/verify-email",
    payload: { token: auth.emailVerification?.token },
  });
  expect(verified.statusCode).toBe(200);
  return auth;
}

async function administrator(server: BootstrappedServer): Promise<AuthResponse> {
  const auth = await account(server, "sysop");
  await setUserRole(handle.db, auth.account.userId, "admin");
  return auth;
}

async function connected(url: string, sessionToken: string): Promise<TestClient> {
  const client = new TestClient(url);
  clients.push(client);
  await client.connect();
  const handshake = await client.emit<SessionAuthenticateAck>("session:authenticate", {
    clientVersion: CLIENT_VERSION,
    appEnv: "local",
    sessionToken,
  });
  expect(handshake.ok).toBe(true);
  return client;
}

type Seated = Readonly<{
  matchId: string;
  light: { auth: AuthResponse; client: TestClient };
  dark: { auth: AuthResponse; client: TestClient };
}>;

async function pair(running: RunningServer): Promise<Seated> {
  const ada = await account(running.server, "ada");
  const grace = await account(running.server, "grace");
  const adaClient = await connected(running.url, ada.session.sessionToken);
  const graceClient = await connected(running.url, grace.session.sessionToken);

  expect(
    queueJoinAckSchema.parse(await adaClient.emit<QueueJoinAck>("queue:join", CASUAL)).state,
  ).toBe("queued");
  const matched = queueJoinAckSchema.parse(
    await graceClient.emit<QueueJoinAck>("queue:join", CASUAL),
  );
  if (matched.state !== "matched") {
    throw new Error(`expected a pairing, got ${matched.state}`);
  }
  const found = await adaClient.next<MatchFoundEvent>("match:found");
  await graceClient.next("match:found");

  const adaIsLight = found.yourColor === "light";
  return {
    matchId: matched.matchId,
    light: adaIsLight ? { auth: ada, client: adaClient } : { auth: grace, client: graceClient },
    dark: adaIsLight ? { auth: grace, client: graceClient } : { auth: ada, client: adaClient },
  };
}

describe("admin actions are audited", () => {
  it("writes the change and its record together, or neither", async () => {
    const running = await boot();
    const admin = await administrator(running.server);
    const target = await account(running.server, "ada");
    const headers = { authorization: `Bearer ${admin.session.sessionToken}` };

    const suspended = await running.server.app.inject({
      method: "POST",
      url: `/v1/admin/users/${target.account.userId}/suspend`,
      headers,
      payload: { reason: REASON },
    });
    expect(suspended.statusCode).toBe(200);
    expect(adminUserDetailSchema.parse(suspended.json()).user.status).toBe("suspended");

    const records = await listAuditRecords(handle.db, { limit: 10 });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      action: "user-suspended",
      adminUserId: admin.account.userId,
      targetType: "user",
      targetId: target.account.userId,
      reason: REASON,
    });

    // A mutation that cannot happen leaves neither a change nor a record: an
    // unknown subject, and a reason too thin to be a reason.
    const unknown = await running.server.app.inject({
      method: "POST",
      url: `/v1/admin/users/${randomUUID()}/rating`,
      headers,
      payload: { rating: 1_400, reason: REASON },
    });
    expect(unknown.statusCode).toBe(404);

    const unreasoned = await running.server.app.inject({
      method: "POST",
      url: `/v1/admin/users/${target.account.userId}/rating`,
      headers,
      payload: { rating: 1_400, reason: "because" },
    });
    expect(unreasoned.statusCode).toBe(400);

    expect(await countAuditRecords(handle.db)).toBe(1);
  });

  it("refuses every administrative route to an ordinary account, and says nothing more", async () => {
    const running = await boot();
    const ada = await account(running.server, "ada");
    const headers = { authorization: `Bearer ${ada.session.sessionToken}` };

    for (const url of [
      "/v1/admin/metrics",
      "/v1/admin/users?query=ada",
      `/v1/admin/users/${ada.account.userId}`,
      "/v1/admin/matches",
      "/v1/admin/audit",
    ]) {
      const response = await running.server.app.inject({ method: "GET", url, headers });

      expect(response.statusCode).toBe(403);
      expect(httpErrorBodySchema.parse(response.json()).error.code).toBe("forbidden");
    }

    const attempted = await running.server.app.inject({
      method: "POST",
      url: `/v1/admin/users/${ada.account.userId}/suspend`,
      headers,
      payload: { reason: REASON },
    });
    expect(attempted.statusCode).toBe(403);

    expect(await countAuditRecords(handle.db)).toBe(0);
  });

  it("keeps the audit log append-only: no endpoint edits or deletes a record", async () => {
    const running = await boot();
    const admin = await administrator(running.server);
    const target = await account(running.server, "ada");
    const headers = { authorization: `Bearer ${admin.session.sessionToken}` };

    const suspended = await running.server.app.inject({
      method: "POST",
      url: `/v1/admin/users/${target.account.userId}/suspend`,
      headers,
      payload: { reason: REASON },
    });
    expect(suspended.statusCode).toBe(200);
    const [record] = await listAuditRecords(handle.db, { limit: 1 });

    for (const method of ["PATCH", "PUT", "DELETE"] as const) {
      const response = await running.server.app.inject({
        method,
        url: `/v1/admin/audit/${record?.id ?? "missing"}`,
        headers,
        payload: { reason: "a better reason entirely" },
      });
      expect(response.statusCode).toBe(404);
    }

    expect((await listAuditRecords(handle.db, { limit: 1 }))[0]?.reason).toBe(REASON);
  });
});

describe("alerts fire in a controlled failure", () => {
  it("turns a broken database into a readiness alert over the real exposition", async () => {
    const running = await boot();
    const scrape = async (): Promise<readonly Sample[]> => {
      const response = await running.server.app.inject({ method: "GET", url: "/metrics" });
      expect(response.statusCode).toBe(200);
      return parseExposition(response.body);
    };
    const healthy = await scrape();
    const readiness = ALERT_DEFINITIONS.find(
      (definition) => definition.alert === "GobbletReadinessFailing",
    );
    if (!readiness) {
      throw new Error("the readiness rule is missing");
    }
    expect(fires(readiness, { before: healthy, after: healthy, nowSeconds: 0 })).toBe(false);

    // The controlled failure: the database goes away underneath a running instance.
    await running.server.database.close();

    const broken = await scrape();
    expect(fires(readiness, { before: healthy, after: broken, nowSeconds: 0 })).toBe(true);
    const ready = await running.server.app.inject({ method: "GET", url: "/health/ready" });
    expect(ready.statusCode).toBe(503);

    // The instance is already unusable; drop it before the shared fixture truncates.
    servers = servers.filter((server) => server !== running.server);
    await running.server.app.close();
  });

  it("turns failing requests into an error-rate alert", async () => {
    const running = await boot();
    const admin = await administrator(running.server);
    const scrape = async (): Promise<readonly Sample[]> =>
      parseExposition((await running.server.app.inject({ method: "GET", url: "/metrics" })).body);

    for (let index = 0; index < 20; index += 1) {
      await running.server.app.inject({ method: "GET", url: "/v1/config" });
    }
    const before = await scrape();

    // A page of users read after the database has gone is a server error, which is
    // exactly the class of failure the rule is meant to notice.
    await running.server.database.close();
    for (let index = 0; index < 5; index += 1) {
      const response = await running.server.app.inject({
        method: "GET",
        url: "/v1/admin/users?query=ada",
        headers: { authorization: `Bearer ${admin.session.sessionToken}` },
      });
      expect(response.statusCode).toBe(500);
    }
    const after = await scrape();

    const rule = ALERT_DEFINITIONS.find(
      (definition) => definition.alert === "GobbletServerErrorRateElevated",
    );
    expect(rule && fires(rule, { before, after, nowSeconds: 0 })).toBe(true);

    servers = servers.filter((server) => server !== running.server);
    await running.server.app.close();
  });
});

describe("a deployment preserves or recovers active matches", () => {
  it("drains the queue, keeps the match, and lets the next instance answer for it", async () => {
    const first = await boot();
    const seated = await pair(first);

    clock.advance(4_000);
    const moved = await seated.light.client.emit<CommandAck>("match:move", {
      ...envelope(seated.matchId, 0),
      payload: { move: WINNING_SCRIPT[0] },
    });
    expect(moved).toMatchObject({ ok: true, newVersion: 1 });

    // Someone is waiting for a pairing when the deployment starts.
    const waiting = await account(first.server, "hopper");
    const waitingClient = await connected(first.url, waiting.session.sessionToken);
    expect(
      queueJoinAckSchema.parse(await waitingClient.emit<QueueJoinAck>("queue:join", CASUAL)).state,
    ).toBe("queued");

    // Step three of the runbook: the queue closes first, and it says so.
    first.server.gateway.drain();
    const closed = await waitingClient.next<RecoverableError>("error:recoverable");
    expect(closed.code).toBe("queue_closed");
    expect(closed.retryable).toBe(true);

    const stored = await findMatchById(handle.db, seated.matchId);
    expect(stored?.status).toBe("active");

    // The old instance stops. The clock keeps running, because it is derived from
    // turn_started_at rather than held in the process (ADR-0009).
    for (const client of clients) {
      client.close();
    }
    clients = [];
    await first.server.close();
    servers = servers.filter((server) => server !== first.server);
    clock.advance(30_000);

    const second = await boot();
    const reconnected = await connected(second.url, seated.dark.auth.session.sessionToken);
    const ack = await reconnected.emit<MatchSyncAck>("match:sync", { matchId: seated.matchId });
    if (!ack.ok) {
      throw new Error(`the replacement instance refused the sync: ${ack.reason}`);
    }
    const synced = matchSnapshotSchema.parse(ack.snapshot);

    expect(synced.version).toBe(1);
    expect(synced.status).toBe("active");
    expect(synced.activePlayer).toBe("dark");
    expect(synced.lastMove?.move).toEqual(WINNING_SCRIPT[0]);
    // Light was charged for the four seconds it thought about its move and for
    // nothing else. Dark's turn is still running: the stored budget is untouched and
    // the elapsed part is derived from turn_started_at, which is why thirty seconds
    // of deployment cost dark exactly thirty seconds and cost the match nothing.
    expect(synced.clocks.lightRemainingMs).toBe(300_000 - 4_000);
    expect(synced.clocks.darkRemainingMs).toBe(300_000);
    expect(synced.clocks.serverTime - (synced.clocks.turnStartedAt ?? 0)).toBe(30_000);

    const resumed = await reconnected.emit<CommandAck>("match:move", {
      ...envelope(seated.matchId, 1),
      payload: { move: WINNING_SCRIPT[1] },
    });
    expect(resumed).toMatchObject({ ok: true, newVersion: 2 });
  });

  it("counts a session that reconnects after the replacement, so the deploy can be watched", async () => {
    const first = await boot();
    const seated = await pair(first);
    for (const client of clients) {
      client.close();
    }
    clients = [];
    await first.server.close();
    servers = servers.filter((server) => server !== first.server);

    const second = await boot();
    const back = await connected(second.url, seated.light.auth.session.sessionToken);
    const resynced = await back.emit<MatchSyncAck>("match:sync", { matchId: seated.matchId });
    expect(resynced.ok).toBe(true);

    const exposition = (await second.server.app.inject({ method: "GET", url: "/metrics" })).body;
    expect(exposition).toContain("gobblet_socket_connections_total 1");
    expect(exposition).toContain("gobblet_active_matches 1");
  });
});
