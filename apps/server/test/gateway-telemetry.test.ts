import { loadServerConfig } from "@gobblet/config";
import { listMatchConnectionEvents } from "@gobblet/db";
import { clearMatchStart } from "@gobblet/db/testing";
import type { DatabaseHandle } from "@gobblet/db";
import type {
  CommandAck,
  CreateGuestResponse,
  MatchSyncAck,
  QueueJoinAck,
  SessionAuthenticateAck,
} from "@gobblet/protocol";
import type { AnalyticsEvent } from "@gobblet/protocol";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app";
import { GuestService } from "../src/guests/service";
import { IdentityService } from "../src/identity/service";
import { LeaderboardService } from "../src/leaderboard/service";
import { MatchRuntime } from "../src/match/runtime";
import { RematchService } from "../src/matchmaking/rematch";
import { MatchmakingService } from "../src/matchmaking/service";
import { RecentErrors } from "../src/observability/error-log";
import { MetricsRegistry } from "../src/observability/metrics";
import { TelemetryService } from "../src/observability/telemetry";
import type { AnalyticsIdentity, AnalyticsPort } from "../src/observability/analytics";
import type { ErrorContext, ErrorReportingPort } from "../src/observability/error-reporting";
import { MatchGateway } from "../src/socket/gateway";
import { adminServiceFixture } from "./helpers/admin-service";
import { TestClock, envelope } from "./helpers/match-fixtures";
import { TestClient } from "./helpers/socket-client";
import { setupTestDatabase, truncateAll } from "./helpers/test-database";

/**
 * What playing over the socket contributes to observability: the metrics of spec
 * section 17.3, the analytics events of section 17.1 and the connection history of
 * section 16 (docs/adr/0030-telemetry-behind-ports-relayed-through-the-server.md).
 */

const CLIENT_VERSION = "0.1.0";

const config = loadServerConfig({ APP_ENV: "local", LOG_LEVEL: "fatal" });

type Reported = Readonly<{
  error: Readonly<{ name: string; message: string; stack?: string }>;
  context: ErrorContext;
}>;

let handle: DatabaseHandle;
let clock: TestClock;
let app: FastifyInstance;
let gateway: MatchGateway;
let runtime: MatchRuntime;
let guests: GuestService;
let telemetry: TelemetryService;
let metrics: MetricsRegistry;
let captured: Readonly<{ identity: AnalyticsIdentity; event: AnalyticsEvent }>[];
let reported: Reported[];
let clients: TestClient[];
let extras: (() => Promise<void>)[];
let url: string;

class RecordingAnalytics implements AnalyticsPort {
  capture(identity: AnalyticsIdentity, event: AnalyticsEvent): void {
    captured.push({ identity, event });
  }

  flush(): Promise<void> {
    // Everything is kept in memory, so there is nothing to send.
    return Promise.resolve();
  }
}

class RecordingErrors implements ErrorReportingPort {
  report(
    error: Readonly<{ name: string; message: string; stack?: string }>,
    context: ErrorContext,
  ): void {
    reported.push({ error, context });
  }

  flush(): Promise<void> {
    // Nothing is buffered here either.
    return Promise.resolve();
  }
}

beforeAll(async () => {
  handle = await setupTestDatabase();
});

afterAll(async () => {
  await handle.close();
});

beforeEach(async () => {
  await truncateAll(handle);
  clock = new TestClock();
  captured = [];
  reported = [];
  clients = [];
  extras = [];
  metrics = new MetricsRegistry({ appVersion: "7.0.0", gitSha: "phase7", appEnv: "local" });
  telemetry = new TelemetryService({
    analytics: new RecordingAnalytics(),
    errors: new RecordingErrors(),
    metrics,
    recentErrors: new RecentErrors(),
    pseudonymise: null,
    now: clock.now,
  });
  runtime = new MatchRuntime({ db: handle.db, now: clock.now, telemetry });
  guests = new GuestService({ db: handle.db, config, now: clock.now, telemetry });
  const identity = new IdentityService({ db: handle.db, config, now: clock.now, telemetry });
  app = await buildApp({
    config,
    services: {
      runtime,
      guests,
      identity,
      leaderboards: new LeaderboardService({ db: handle.db, now: clock.now }),
      admin: adminServiceFixture({ db: handle.db, config, runtime, identity, now: clock.now }),
      db: handle.db,
    },
    telemetry,
    now: clock.now,
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  gateway = new MatchGateway({
    httpServer: app.server,
    config,
    runtime,
    resolvers: { identity, guests },
    matchmaking: new MatchmakingService({ runtime, identity, now: clock.now }),
    rematch: new RematchService({ runtime, identity, now: clock.now }),
    log: { info: () => undefined, error: () => undefined },
    telemetry,
    now: clock.now,
    startTicking: false,
  });

  const address = app.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected a TCP address");
  }
  url = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  for (const client of clients) {
    client.close();
  }
  for (const dispose of extras.reverse()) {
    await dispose();
  }
  await gateway.close();
  await app.close();
});

/** A second server, for the cases that need a runtime whose writes fail. */
async function spawnGateway(gatewayRuntime: MatchRuntime): Promise<string> {
  const identity = new IdentityService({ db: handle.db, config, now: clock.now });
  const local = await buildApp({
    config,
    services: {
      runtime: gatewayRuntime,
      guests,
      identity,
      leaderboards: new LeaderboardService({ db: handle.db, now: clock.now }),
      admin: adminServiceFixture({
        db: handle.db,
        config,
        runtime: gatewayRuntime,
        identity,
        now: clock.now,
      }),
      db: handle.db,
    },
    telemetry,
    now: clock.now,
  });
  await local.listen({ host: "127.0.0.1", port: 0 });
  const localGateway = new MatchGateway({
    httpServer: local.server,
    config,
    runtime: gatewayRuntime,
    resolvers: { identity, guests },
    matchmaking: new MatchmakingService({ runtime: gatewayRuntime, identity, now: clock.now }),
    rematch: new RematchService({ runtime: gatewayRuntime, identity, now: clock.now }),
    log: { info: () => undefined, error: () => undefined },
    telemetry,
    now: clock.now,
    startTicking: false,
  });
  extras.push(async () => {
    await localGateway.close();
    await local.close();
  });

  const address = local.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected a TCP address");
  }
  return `http://127.0.0.1:${address.port}`;
}

/** A match on a runtime other than the shared one, attached to by its light seat. */
async function attachTo(other: MatchRuntime): Promise<void> {
  const light = await guests.createGuest("light-player");
  const dark = await guests.createGuest("dark-player");
  const snapshot = await other.createMatch({
    mode: "casual",
    timeControlSeconds: 300,
    light: { actorType: "guest", actorId: light.guestId, displayName: light.displayName },
    dark: { actorType: "guest", actorId: dark.guestId, displayName: dark.displayName },
  });
  const client = new TestClient(await spawnGateway(other));
  clients.push(client);
  await client.connect();
  await client.emit<SessionAuthenticateAck>("session:authenticate", {
    clientVersion: CLIENT_VERSION,
    appEnv: "local",
    sessionToken: light.sessionToken,
  });
  const ack = await client.emit<MatchSyncAck>("match:sync", { matchId: snapshot.matchId });
  expect(ack.ok).toBe(true);
}

async function authenticated(
  guest: CreateGuestResponse,
  platform?: "web" | "desktop",
): Promise<TestClient> {
  const client = new TestClient(url);
  clients.push(client);
  await client.connect();
  const ack = await client.emit<SessionAuthenticateAck>("session:authenticate", {
    clientVersion: CLIENT_VERSION,
    appEnv: "local",
    sessionToken: guest.sessionToken,
    ...(platform === undefined ? {} : { platform }),
  });
  expect(ack.ok).toBe(true);
  return client;
}

async function seatedMatch(): Promise<
  Readonly<{
    matchId: string;
    light: CreateGuestResponse;
    dark: CreateGuestResponse;
    lightClient: TestClient;
    darkClient: TestClient;
  }>
> {
  const light = await guests.createGuest("light-player");
  const dark = await guests.createGuest("dark-player");
  const snapshot = await runtime.createMatch({
    mode: "casual",
    timeControlSeconds: 300,
    light: { actorType: "guest", actorId: light.guestId, displayName: light.displayName },
    dark: { actorType: "guest", actorId: dark.guestId, displayName: dark.displayName },
  });
  const lightClient = await authenticated(light);
  const darkClient = await authenticated(dark);
  await lightClient.emit<MatchSyncAck>("match:sync", { matchId: snapshot.matchId });
  await darkClient.emit<MatchSyncAck>("match:sync", { matchId: snapshot.matchId });
  return { matchId: snapshot.matchId, light, dark, lightClient, darkClient };
}

function eventNames(): readonly string[] {
  return captured.map((entry) => entry.event.name);
}

describe("what a socket contributes to the exposition", () => {
  it("counts the connection and the handshake's platform and version", async () => {
    const guest = await guests.createGuest("web-player");
    await authenticated(guest, "desktop");

    const exposition = await metrics.expose();
    expect(exposition).toContain("gobblet_socket_connections_total 1");
    expect(exposition).toContain(
      `gobblet_client_sessions_total{platform="desktop",version="${CLIENT_VERSION}"} 1`,
    );
  });

  it("reports a handshake with no platform as the web client", async () => {
    const guest = await guests.createGuest("web-player");
    await authenticated(guest);

    expect(await metrics.expose()).toContain(
      `gobblet_client_sessions_total{platform="web",version="${CLIENT_VERSION}"} 1`,
    );
  });

  it("reports how many matches and sockets this instance is serving", async () => {
    const match = await seatedMatch();

    expect(gateway.activeMatchCount()).toBe(1);
    expect(gateway.connectionCount()).toBe(2);
    expect(match.matchId).toBeDefined();
  });

  it("counts a refused command with its kind and reason", async () => {
    const match = await seatedMatch();
    const ack = await match.darkClient.emit<CommandAck>("match:move", {
      ...envelope(match.matchId, 0),
      payload: { move: { kind: "reserve", reserveStack: 0, to: "r0c0" } },
    });

    expect(ack.ok).toBe(false);
    expect(await metrics.expose()).toContain(
      'gobblet_command_rejections_total{command="move",reason="not-your-turn"} 1',
    );
  });

  it("times a move that was accepted", async () => {
    const match = await seatedMatch();
    await match.lightClient.emit<CommandAck>("match:move", {
      ...envelope(match.matchId, 0),
      payload: { move: { kind: "reserve", reserveStack: 0, to: "r0c0" } },
    });

    expect(await metrics.expose()).toContain("gobblet_move_validation_duration_seconds_count 1");
  });
});

describe("the connection history of a match", () => {
  it("records an attachment once, however many times a client syncs", async () => {
    const match = await seatedMatch();
    await match.lightClient.emit<MatchSyncAck>("match:sync", { matchId: match.matchId });

    const events = await listMatchConnectionEvents(handle.db, match.matchId);
    expect(events.filter((event) => event.actorId === match.light.guestId)).toHaveLength(1);
    expect(events).toHaveLength(2);
  });

  it("records the detachment when a socket goes away, with the reason", async () => {
    const match = await seatedMatch();
    match.lightClient.close();

    await vi.waitFor(async () => {
      await gateway.settleConnectionHistory();
      const events = await listMatchConnectionEvents(handle.db, match.matchId);
      const detached = events.filter((event) => event.kind === "detached");
      expect(detached).toHaveLength(1);
      expect(detached[0]).toMatchObject({
        actorId: match.light.guestId,
        reason: "client namespace disconnect",
      });
    });
  });

  it("counts a socket that comes back to a match it had left as a reconnection", async () => {
    const match = await seatedMatch();
    match.lightClient.close();
    await vi.waitFor(() => {
      expect(gateway.connectionCount()).toBe(1);
    });

    const returning = await authenticated(match.light);
    await returning.emit<MatchSyncAck>("match:sync", { matchId: match.matchId });

    expect(await metrics.expose()).toContain("gobblet_socket_reconnects_total 1");
  });

  it("does not count a first attachment as a reconnection", async () => {
    await seatedMatch();

    expect(await metrics.expose()).toContain("gobblet_socket_reconnects_total 0");
  });

  it("keeps serving when the history cannot be written, and reports it once", async () => {
    class BrokenHistory extends MatchRuntime {
      override recordConnectionEvent(): Promise<void> {
        return Promise.reject(new Error("the history table is unreachable"));
      }
    }

    await attachTo(new BrokenHistory({ db: handle.db, now: clock.now, telemetry }));

    expect(reported).toHaveLength(1);
    expect(reported[0]).toMatchObject({
      error: { message: "the history table is unreachable" },
      context: { route: "socket:connection-history", origin: "server" },
    });
  });

  it("reports a failure that kept no stack", async () => {
    class Stackless extends MatchRuntime {
      override recordConnectionEvent(): Promise<void> {
        const error = new Error("the write was refused");
        delete error.stack;
        return Promise.reject(error);
      }
    }

    await attachTo(new Stackless({ db: handle.db, now: clock.now, telemetry }));

    expect(reported[0]?.error).toEqual({ name: "Error", message: "the write was refused" });
  });

  it("reports a failure that was not thrown as an error", async () => {
    class OddFailure extends MatchRuntime {
      override recordConnectionEvent(): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a driver can reject with a string, which the gateway has to survive
        return Promise.reject("the pool is closed");
      }
    }

    await attachTo(new OddFailure({ db: handle.db, now: clock.now, telemetry }));

    expect(reported[0]?.error).toEqual({ name: "Error", message: "the pool is closed" });
  });
});

describe("the analytics events a match produces", () => {
  it("reports the queue, the pairing and the start once for each seat", async () => {
    const light = await guests.createGuest("light-player");
    const dark = await guests.createGuest("dark-player");
    const lightClient = await authenticated(light);
    const darkClient = await authenticated(dark);
    captured = [];

    await lightClient.emit<QueueJoinAck>("queue:join", {
      mode: "casual",
      timeControlSeconds: 300,
    });
    clock.advance(2_000);
    await darkClient.emit<QueueJoinAck>("queue:join", {
      mode: "casual",
      timeControlSeconds: 300,
    });

    expect(eventNames()).toEqual([
      "queue-joined",
      "queue-joined",
      "match-found",
      "match-started",
      "match-found",
      "match-started",
    ]);
    expect(captured[2]?.event).toEqual({
      name: "match-found",
      mode: "casual",
      timeControlSeconds: 300,
      waitMs: 2_000,
    });
    expect(await metrics.expose()).toContain(
      'gobblet_matchmaking_wait_seconds_count{mode="casual"} 1',
    );
  });

  it("reports a refused queue entry as a rejection rather than an event", async () => {
    const light = await guests.createGuest("light-player");
    const lightClient = await authenticated(light);
    await lightClient.emit<QueueJoinAck>("queue:join", {
      mode: "ranked",
      timeControlSeconds: 300,
    });

    expect(eventNames()).toEqual(["guest-created"]);
    expect(await metrics.expose()).toContain(
      'gobblet_command_rejections_total{command="queue",reason="ineligible"} 1',
    );
  });

  it("reports the completion of a match once for each seat", async () => {
    const match = await seatedMatch();
    captured = [];
    clock.advance(30_000);

    const ack = await match.lightClient.emit<CommandAck>("match:resign", {
      ...envelope(match.matchId, 0),
      payload: {},
    });
    expect(ack.ok).toBe(true);

    expect(eventNames()).toEqual(["match-completed", "match-completed"]);
    expect(captured[0]?.event).toEqual({
      name: "match-completed",
      mode: "casual",
      timeControlSeconds: 300,
      result: "dark",
      endReason: "resignation",
      moveCount: 1,
      durationMs: 30_000,
    });
    expect(await metrics.expose()).toContain(
      'gobblet_matches_completed_total{mode="casual",reason="resignation"} 1',
    );
  });

  it("times a match that never started from when it was created", async () => {
    const light = await guests.createGuest("light-player");
    const dark = await guests.createGuest("dark-player");
    const snapshot = await runtime.createMatch({
      mode: "casual",
      timeControlSeconds: 300,
      light: { actorType: "guest", actorId: light.guestId, displayName: light.displayName },
      dark: { actorType: "guest", actorId: dark.guestId, displayName: dark.displayName },
    });
    await clearMatchStart(handle.db, snapshot.matchId);
    captured = [];
    clock.advance(45_000);

    await runtime.applyResignCommand(
      { actorType: "guest", actorId: light.guestId },
      envelope(snapshot.matchId, 0),
    );

    expect(captured[0]?.event).toMatchObject({ name: "match-completed", durationMs: 45_000 });
  });

  it("reports a rematch that was offered and accepted", async () => {
    const match = await seatedMatch();
    await match.lightClient.emit<CommandAck>("match:resign", {
      ...envelope(match.matchId, 0),
      payload: {},
    });
    captured = [];

    await match.lightClient.emit("match:rematch-request", { matchId: match.matchId });
    await match.darkClient.emit("match:rematch-respond", { matchId: match.matchId, accept: true });

    expect(eventNames()).toEqual([
      "rematch-requested",
      "rematch-accepted",
      "match-found",
      "match-started",
      "match-found",
      "match-started",
    ]);
    expect(captured[0]?.event).toEqual({ name: "rematch-requested", mode: "casual" });
  });

  it("reports a clock that ran out as a timeout", async () => {
    const match = await seatedMatch();
    clock.advance(300_001);

    await gateway.tick();

    expect(await metrics.expose()).toContain("gobblet_clock_timeouts_total 1");
    expect(eventNames()).toContain("match-completed");
    expect(match.matchId).toBeDefined();
  });
});
