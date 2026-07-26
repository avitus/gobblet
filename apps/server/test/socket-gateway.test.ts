import { randomUUID } from "node:crypto";
import { loadServerConfig } from "@gobblet/config";
import type { ServerConfig } from "@gobblet/config";
import { upsertRating } from "@gobblet/db";
import type { DatabaseHandle, RatingAggregatePatch } from "@gobblet/db";
import {
  REMATCH_OFFER_MS,
  fatalErrorSchema,
  matchClockSyncEventSchema,
  matchEndedEventSchema,
  matchFoundEventSchema,
  matchMoveCommittedEventSchema,
  matchSnapshotSchema,
  queueJoinAckSchema,
  queueLeaveAckSchema,
  queueStatusSchema,
  recoverableErrorSchema,
  rematchAckSchema,
  rematchStatusEventSchema,
  sessionReadySchema,
} from "@gobblet/protocol";
import type {
  CommandAck,
  CreateGuestResponse,
  MatchSyncAck,
  QueueJoinAck,
  QueueLeaveAck,
  RematchAck,
  SessionAuthenticateAck,
} from "@gobblet/protocol";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app";
import { GuestService } from "../src/guests/service";
import { IdentityService } from "../src/identity/service";
import { LeaderboardService } from "../src/leaderboard/service";
import { RematchService } from "../src/matchmaking/rematch";
import { MatchmakingService } from "../src/matchmaking/service";
import type { MatchmakingQueue } from "../src/matchmaking/service";
import { MatchRuntime } from "../src/match/runtime";
import { MatchGateway } from "../src/socket/gateway";
import type { GatewayLogger } from "../src/socket/gateway";
import { createSilentTelemetry } from "../src/observability/telemetry";
import { adminServiceFixture, releaseServiceFixture } from "./helpers/admin-service";
import { TestClock, WINNING_SCRIPT, envelope } from "./helpers/match-fixtures";
import { TestClient } from "./helpers/socket-client";
import { setupTestDatabase, truncateAll } from "./helpers/test-database";

const CLIENT_VERSION = "0.1.0";

const config: ServerConfig = loadServerConfig({
  APP_ENV: "local",
  APP_VERSION: "9.9.9",
  GIT_SHA: "testsha",
  LOG_LEVEL: "fatal",
});

let handle: DatabaseHandle;
let clock: TestClock;
let runtime: MatchRuntime;
let guests: GuestService;
let identity: IdentityService;
let leaderboards: LeaderboardService;
let matchmaking: MatchmakingService;
let rematch: RematchService;
let logs: Readonly<{ context: Readonly<Record<string, unknown>>; message: string }>[];
let app: FastifyInstance;
let gateway: MatchGateway;
let url: string;
let clients: TestClient[] = [];
let extras: (() => Promise<void>)[] = [];

beforeAll(async () => {
  handle = await setupTestDatabase();
});

afterAll(async () => {
  await handle.close();
});

beforeEach(async () => {
  await truncateAll(handle);
  clock = new TestClock();
  logs = [];
  runtime = new MatchRuntime({ db: handle.db, now: clock.now });
  guests = new GuestService({ db: handle.db, config, now: clock.now });
  identity = new IdentityService({ db: handle.db, config, now: clock.now });
  leaderboards = new LeaderboardService({ db: handle.db, now: clock.now });
  matchmaking = new MatchmakingService({ runtime, identity, now: clock.now });
  rematch = new RematchService({ runtime, identity, now: clock.now });
  app = await buildApp({
    config,
    services: {
      runtime,
      guests,
      identity,
      leaderboards,
      admin: adminServiceFixture({ db: handle.db, config, runtime, identity, now: clock.now }),
      releases: releaseServiceFixture({ db: handle.db, now: clock.now }),
      db: handle.db,
    },
    telemetry: createSilentTelemetry(),
    now: clock.now,
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  gateway = new MatchGateway({
    httpServer: app.server,
    config,
    runtime,
    resolvers: { identity, guests },
    matchmaking,
    rematch,
    log: {
      info: (context, message) => logs.push({ context, message }),
      error: () => undefined,
    },
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
  clients = [];
  for (const dispose of extras.reverse()) {
    await dispose();
  }
  extras = [];
  await gateway.close();
  await app.close();
});

async function connect(target = url): Promise<TestClient> {
  const client = new TestClient(target);
  clients.push(client);
  await client.connect();
  return client;
}

async function authenticated(
  guest: CreateGuestResponse,
  target = url,
): Promise<{ client: TestClient; ack: SessionAuthenticateAck }> {
  const client = await connect(target);
  const ack = await client.emit<SessionAuthenticateAck>("session:authenticate", {
    clientVersion: CLIENT_VERSION,
    appEnv: "local",
    sessionToken: guest.sessionToken,
  });
  return { client, ack };
}

/** A second server, for the cases that need a different runtime or logger. */
async function spawnGateway(
  gatewayRuntime: MatchRuntime,
  log: GatewayLogger = { info: () => undefined, error: () => undefined },
): Promise<{ gateway: MatchGateway; url: string }> {
  const localApp = await buildApp({
    config,
    services: {
      runtime: gatewayRuntime,
      guests,
      identity,
      leaderboards,
      admin: adminServiceFixture({
        db: handle.db,
        config,
        runtime: gatewayRuntime,
        identity,
        now: clock.now,
      }),
      releases: releaseServiceFixture({ db: handle.db, now: clock.now }),
      db: handle.db,
    },
    telemetry: createSilentTelemetry(),
    now: clock.now,
  });
  await localApp.listen({ host: "127.0.0.1", port: 0 });
  const localGateway = new MatchGateway({
    httpServer: localApp.server,
    config,
    runtime: gatewayRuntime,
    resolvers: { identity, guests },
    matchmaking: new MatchmakingService({ runtime: gatewayRuntime, identity, now: clock.now }),
    rematch: new RematchService({ runtime: gatewayRuntime, identity, now: clock.now }),
    log,
    now: clock.now,
    startTicking: false,
  });
  extras.push(async () => {
    await localGateway.close();
    await localApp.close();
  });

  const address = localApp.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected a TCP address");
  }
  return { gateway: localGateway, url: `http://127.0.0.1:${address.port}` };
}

function ratingFixture(rating: number): RatingAggregatePatch {
  return { rating, gamesPlayed: 1, wins: 1, losses: 0, draws: 0, currentStreak: 1, bestStreak: 1 };
}

/** A verified account, which a ranked queue requires (appendix P3). */
async function verifiedAccount(
  username: string,
): Promise<Readonly<{ userId: string; sessionToken: string }>> {
  const registered = await identity.register({
    email: `${username}@example.com`,
    password: "correct-horse-7",
    username,
  });
  if (!registered.ok) {
    throw new Error(`registration failed: ${registered.reason}`);
  }
  await identity.verifyEmail(registered.value.emailVerification?.token ?? "");
  return {
    userId: registered.value.account.userId,
    sessionToken: registered.value.session.sessionToken,
  };
}

async function authenticatedAccount(sessionToken: string): Promise<TestClient> {
  const client = await connect();
  await client.emit<SessionAuthenticateAck>("session:authenticate", {
    clientVersion: CLIENT_VERSION,
    appEnv: "local",
    sessionToken,
  });
  return client;
}

type Table = Readonly<{
  matchId: string;
  light: CreateGuestResponse;
  dark: CreateGuestResponse;
  lightClient: TestClient;
  darkClient: TestClient;
}>;

async function seatedMatch(timeControlSeconds: 180 | 300 = 300): Promise<Table> {
  const light = await guests.createGuest("light-player");
  const dark = await guests.createGuest("dark-player");
  const snapshot = await runtime.createMatch({
    mode: "casual",
    timeControlSeconds,
    light: { actorType: "guest", actorId: light.guestId, displayName: light.displayName },
    dark: { actorType: "guest", actorId: dark.guestId, displayName: dark.displayName },
  });

  const { client: lightClient } = await authenticated(light);
  const { client: darkClient } = await authenticated(dark);
  await lightClient.emit<MatchSyncAck>("match:sync", { matchId: snapshot.matchId });
  await darkClient.emit<MatchSyncAck>("match:sync", { matchId: snapshot.matchId });
  // The sync snapshots are setup, not assertions.
  lightClient.drain("match:snapshot");
  darkClient.drain("match:snapshot");

  return { matchId: snapshot.matchId, light, dark, lightClient, darkClient };
}

/** A seated match whose light seat is an account, so suspension can be applied. */
async function seatedAccountMatch(): Promise<
  Table & Readonly<{ userId: string; sessionToken: string }>
> {
  const registered = await identity.register({
    email: "ada@example.com",
    password: "correct-horse-7",
    username: "ada",
  });
  if (!registered.ok) {
    throw new Error("expected registration to succeed");
  }
  const dark = await guests.createGuest("dark-player");
  const snapshot = await runtime.createMatch({
    mode: "casual",
    timeControlSeconds: 300,
    light: { actorType: "user", actorId: registered.value.account.userId, displayName: "ada" },
    dark: { actorType: "guest", actorId: dark.guestId, displayName: dark.displayName },
  });

  const lightClient = await connect();
  await lightClient.emit<SessionAuthenticateAck>("session:authenticate", {
    clientVersion: CLIENT_VERSION,
    appEnv: "local",
    sessionToken: registered.value.session.sessionToken,
  });
  const { client: darkClient } = await authenticated(dark);
  await lightClient.emit<MatchSyncAck>("match:sync", { matchId: snapshot.matchId });
  await darkClient.emit<MatchSyncAck>("match:sync", { matchId: snapshot.matchId });
  lightClient.drain("match:snapshot");
  darkClient.drain("match:snapshot");

  return {
    matchId: snapshot.matchId,
    light: {
      guestId: registered.value.account.userId,
      displayName: "ada",
      sessionToken: registered.value.session.sessionToken,
      expiresAt: registered.value.session.expiresAt,
    },
    dark,
    lightClient,
    darkClient,
    userId: registered.value.account.userId,
    sessionToken: registered.value.session.sessionToken,
  };
}

describe("session:authenticate", () => {
  it("accepts an account session and reports the actor as an account", async () => {
    const registered = await identity.register({
      email: "ada@example.com",
      password: "correct-horse-7",
      username: "ada",
    });
    if (!registered.ok) {
      throw new Error("expected registration to succeed");
    }

    const client = await connect();
    const ack = await client.emit<SessionAuthenticateAck>("session:authenticate", {
      clientVersion: CLIENT_VERSION,
      appEnv: "local",
      sessionToken: registered.value.session.sessionToken,
    });

    if (!ack.ok) {
      throw new Error("expected the handshake to succeed");
    }
    expect(sessionReadySchema.parse(ack.session)).toMatchObject({
      actorId: registered.value.account.userId,
      actorType: "user",
      displayName: "ada",
      isGuest: false,
    });
  });

  it("refuses a suspended account at the handshake", async () => {
    const registered = await identity.register({
      email: "ada@example.com",
      password: "correct-horse-7",
      username: "ada",
    });
    if (!registered.ok) {
      throw new Error("expected registration to succeed");
    }
    // Suspension revokes the sessions it knows about, so this account signs in
    // again to hold a token that is live when the handshake is refused.
    await identity.suspend(registered.value.account.userId, "abuse");
    await handle.db.execute(
      `update user_sessions set revoked_at = null where user_id = '${registered.value.account.userId}'`,
    );

    const client = await connect();
    const ack = await client.emit<SessionAuthenticateAck>("session:authenticate", {
      clientVersion: CLIENT_VERSION,
      appEnv: "local",
      sessionToken: registered.value.session.sessionToken,
    });

    expect(ack).toEqual({
      ok: false,
      error: {
        code: "account_suspended",
        message: "This account is suspended",
        action: "contact-support",
      },
    });
    await client.waitForDisconnect();
  });

  it("returns the session identity and emits session:ready", async () => {
    const guest = await guests.createGuest("ada");
    const { client, ack } = await authenticated(guest);

    expect(ack.ok).toBe(true);
    if (!ack.ok) {
      throw new Error("expected the handshake to succeed");
    }
    expect(sessionReadySchema.parse(ack.session)).toEqual({
      actorId: guest.guestId,
      actorType: "guest",
      displayName: "ada",
      isGuest: true,
      serverTime: clock.now(),
      features: [],
    });
    expect(sessionReadySchema.parse(await client.next("session:ready")).actorId).toBe(
      guest.guestId,
    );
  });

  it("refuses an unknown token and closes the socket", async () => {
    const client = await connect();

    const ack = await client.emit<SessionAuthenticateAck>("session:authenticate", {
      clientVersion: CLIENT_VERSION,
      appEnv: "local",
      sessionToken: "not-a-real-token",
    });

    expect(ack).toEqual({
      ok: false,
      error: {
        code: "unauthenticated",
        message: "A valid session token is required",
        action: "reauthenticate",
      },
    });
    await client.waitForDisconnect();
    expect(client.connected).toBe(false);
  });

  it("refuses a handshake with no token", async () => {
    const client = await connect();

    const ack = await client.emit<SessionAuthenticateAck>("session:authenticate", {
      clientVersion: CLIENT_VERSION,
      appEnv: "local",
    });

    expect(ack.ok).toBe(false);
    if (ack.ok) {
      throw new Error("expected the handshake to fail");
    }
    expect(ack.error.code).toBe("unauthenticated");
  });

  it("refuses an outdated client and tells it to update", async () => {
    const guest = await guests.createGuest("ada");
    const client = await connect();

    const ack = await client.emit<SessionAuthenticateAck>("session:authenticate", {
      clientVersion: "0.0.9",
      appEnv: "local",
      sessionToken: guest.sessionToken,
    });

    expect(ack.ok).toBe(false);
    if (ack.ok) {
      throw new Error("expected the handshake to fail");
    }
    expect(fatalErrorSchema.parse(ack.error)).toMatchObject({
      code: "unsupported_client",
      action: "update-client",
    });
  });

  it("refuses a client built for another environment", async () => {
    const guest = await guests.createGuest("ada");
    const client = await connect();

    const ack = await client.emit<SessionAuthenticateAck>("session:authenticate", {
      clientVersion: CLIENT_VERSION,
      appEnv: "production",
      sessionToken: guest.sessionToken,
    });

    expect(ack.ok).toBe(false);
    if (ack.ok) {
      throw new Error("expected the handshake to fail");
    }
    expect(ack.error.code).toBe("environment_mismatch");
  });

  it("refuses a malformed handshake", async () => {
    const client = await connect();

    const ack = await client.emit<SessionAuthenticateAck>("session:authenticate", { hello: true });

    expect(ack.ok).toBe(false);
    if (ack.ok) {
      throw new Error("expected the handshake to fail");
    }
    expect(ack.error.code).toBe("invalid_handshake");
  });
});

describe("commands before the handshake", () => {
  it("rejects a move with not-authorized", async () => {
    const client = await connect();

    const ack = await client.emit<CommandAck>("match:move", {
      ...envelope(randomUUID(), 0),
      payload: { move: WINNING_SCRIPT[0] },
    });

    expect(ack).toMatchObject({ ok: false, reason: "not-authorized" });
  });

  it("rejects a sync with not-authorized", async () => {
    const client = await connect();

    const ack = await client.emit<MatchSyncAck>("match:sync", { matchId: randomUUID() });

    expect(ack).toEqual({ ok: false, reason: "not-authorized" });
  });

  it("rejects a resignation with not-authorized", async () => {
    const client = await connect();

    const ack = await client.emit<CommandAck>("match:resign", {
      ...envelope(randomUUID(), 0),
      payload: {},
    });

    expect(ack).toMatchObject({ ok: false, reason: "not-authorized" });
  });
});

describe("match:sync", () => {
  it("returns the authoritative snapshot to a participant", async () => {
    const table = await seatedMatch();

    const ack = await table.lightClient.emit<MatchSyncAck>("match:sync", {
      matchId: table.matchId,
    });

    expect(ack.ok).toBe(true);
    if (!ack.ok) {
      throw new Error("expected the sync to succeed");
    }
    expect(matchSnapshotSchema.parse(ack.snapshot).matchId).toBe(table.matchId);
  });

  it("refuses a match the actor does not play", async () => {
    const table = await seatedMatch();
    const stranger = await guests.createGuest("stranger");
    const { client } = await authenticated(stranger);

    const ack = await client.emit<MatchSyncAck>("match:sync", { matchId: table.matchId });

    expect(ack).toEqual({ ok: false, reason: "not-authorized" });
  });

  it("reports a malformed request on the error channel", async () => {
    const table = await seatedMatch();

    const ack = await table.lightClient.emit<MatchSyncAck>("match:sync", { matchId: "nope" });

    expect(ack).toEqual({ ok: false, reason: "not-authorized" });
    const error = recoverableErrorSchema.parse(await table.lightClient.next("error:recoverable"));
    expect(error).toMatchObject({ code: "validation_failed", retryable: true });
  });
});

describe("playing over the socket", () => {
  it("lets two clients complete a match through the server", async () => {
    const table = await seatedMatch();

    for (const [index, move] of WINNING_SCRIPT.entries()) {
      const mover = index % 2 === 0 ? table.lightClient : table.darkClient;
      clock.advance(1_000);

      const ack = await mover.emit<CommandAck>("match:move", {
        ...envelope(table.matchId, index),
        payload: { move },
      });

      expect(ack).toEqual({ ok: true, commandId: expect.any(String), newVersion: index + 1 });

      // Both seats see every committed move, including the player who made it.
      for (const client of [table.lightClient, table.darkClient]) {
        const committed = matchMoveCommittedEventSchema.parse(
          await client.next("match:move-committed"),
        );
        expect(committed.version).toBe(index + 1);
        expect(committed.actor).toBe(index % 2 === 0 ? "light" : "dark");
      }
    }

    const ended = matchEndedEventSchema.parse(await table.darkClient.next("match:ended"));
    expect(ended).toEqual({
      matchId: table.matchId,
      version: WINNING_SCRIPT.length,
      result: "light",
      reason: "line",
    });
  });

  it("acknowledges a duplicate command without moving twice", async () => {
    const table = await seatedMatch();
    const command = {
      ...envelope(table.matchId, 0),
      payload: { move: WINNING_SCRIPT[0] },
    };

    const first = await table.lightClient.emit<CommandAck>("match:move", command);
    const second = await table.lightClient.emit<CommandAck>("match:move", command);

    expect(first).toMatchObject({ ok: true, newVersion: 1 });
    expect(second).toMatchObject({ ok: false, reason: "duplicate-command" });
    if (second.ok) {
      throw new Error("expected a rejection");
    }
    expect(second.snapshot?.version).toBe(1);
  });

  it("rejects a stale version and returns the snapshot to correct the client", async () => {
    const table = await seatedMatch();
    await table.lightClient.emit<CommandAck>("match:move", {
      ...envelope(table.matchId, 0),
      payload: { move: WINNING_SCRIPT[0] },
    });

    const stale = await table.darkClient.emit<CommandAck>("match:move", {
      ...envelope(table.matchId, 0),
      payload: { move: WINNING_SCRIPT[1] },
    });

    expect(stale).toMatchObject({ ok: false, reason: "stale-version" });
    if (stale.ok) {
      throw new Error("expected a rejection");
    }
    expect(matchSnapshotSchema.parse(stale.snapshot).version).toBe(1);
  });

  it("reports a malformed move payload on both channels", async () => {
    const table = await seatedMatch();

    const ack = await table.lightClient.emit<CommandAck>("match:move", {
      ...envelope(table.matchId, 0),
      payload: { move: { kind: "teleport" } },
    });

    expect(ack).toMatchObject({ ok: false, reason: "illegal-move" });
    expect(
      recoverableErrorSchema.parse(await table.lightClient.next("error:recoverable")).code,
    ).toBe("validation_failed");
  });

  it("reports a malformed envelope without an acknowledgement", async () => {
    const table = await seatedMatch();

    table.lightClient.emitWithoutAck("match:move", { payload: { move: WINNING_SCRIPT[0] } });

    expect(
      recoverableErrorSchema.parse(await table.lightClient.next("error:recoverable")).message,
    ).toBe("The command envelope is not valid");
  });

  it("reports a malformed resign payload", async () => {
    const table = await seatedMatch();

    const ack = await table.lightClient.emit<CommandAck>("match:resign", {
      ...envelope(table.matchId, 0),
      payload: { reason: "bored" },
    });

    expect(ack).toMatchObject({ ok: false, reason: "illegal-move" });
    expect(
      recoverableErrorSchema.parse(await table.lightClient.next("error:recoverable")).message,
    ).toBe("The resign payload is not valid");
  });

  it("broadcasts a resignation as a snapshot and an ending", async () => {
    const table = await seatedMatch();

    const ack = await table.darkClient.emit<CommandAck>("match:resign", {
      ...envelope(table.matchId, 0),
      payload: {},
    });

    expect(ack).toMatchObject({ ok: true, newVersion: 1 });
    const snapshot = matchSnapshotSchema.parse(await table.lightClient.next("match:snapshot"));
    expect(snapshot.status).toBe("completed");
    expect(matchEndedEventSchema.parse(await table.lightClient.next("match:ended"))).toEqual({
      matchId: table.matchId,
      version: 1,
      result: "light",
      reason: "resignation",
    });
  });
});

describe("clock cadence", () => {
  it("broadcasts every two seconds in steady state", async () => {
    const table = await seatedMatch();

    clock.advance(1_000);
    await gateway.tick();
    expect(table.lightClient.seen("match:clock-sync")).toHaveLength(0);

    clock.advance(1_000);
    await gateway.tick();
    const sync = matchClockSyncEventSchema.parse(await table.lightClient.next("match:clock-sync"));
    expect(sync).toEqual({
      matchId: table.matchId,
      version: 0,
      activePlayer: "light",
      lightRemainingMs: 298_000,
      darkRemainingMs: 300_000,
      serverTime: clock.now(),
    });
  });

  it("broadcasts four times a second under ten seconds", async () => {
    const table = await seatedMatch(180);
    clock.advance(171_000);
    await gateway.tick();
    await table.lightClient.next("match:clock-sync");

    clock.advance(250);
    await gateway.tick();

    expect(
      matchClockSyncEventSchema.parse(await table.lightClient.next("match:clock-sync")).serverTime,
    ).toBe(clock.now());
  });

  it("ends the match on time with no command from either player", async () => {
    const table = await seatedMatch(180);
    clock.advance(180_001);

    await gateway.tick();

    const ended = matchEndedEventSchema.parse(await table.darkClient.next("match:ended"));
    expect(ended).toEqual({
      matchId: table.matchId,
      version: 1,
      result: "dark",
      reason: "timeout",
    });
    const snapshot = matchSnapshotSchema.parse(await table.lightClient.next("match:snapshot"));
    expect(snapshot.status).toBe("completed");
    expect(snapshot.clocks.lightRemainingMs).toBe(0);
  });

  it("stops tracking a finished match", async () => {
    const table = await seatedMatch(180);
    clock.advance(180_001);
    await gateway.tick();
    await table.darkClient.next("match:ended");

    clock.advance(10_000);
    await gateway.tick();

    expect(table.lightClient.seen("match:clock-sync")).toHaveLength(0);
  });

  it("corrects the room when the match already ended another way", async () => {
    const table = await seatedMatch(180);
    // Ended through the runtime, so this gateway never heard about it.
    await runtime.applyResignCommand(
      { actorType: "guest", actorId: table.dark.guestId },
      envelope(table.matchId, 0),
    );
    clock.advance(180_001);

    await gateway.tick();

    expect(matchSnapshotSchema.parse(await table.lightClient.next("match:snapshot"))).toMatchObject(
      {
        status: "completed",
        result: { outcome: "light", reason: "resignation" },
      },
    );
    clock.advance(10_000);
    await gateway.tick();
    await expect(table.lightClient.next("match:clock-sync", 100)).rejects.toThrow(/timed out/);
  });

  it("ignores a tracked match that no longer exists", async () => {
    const table = await seatedMatch(180);
    await truncateAll(handle);
    clock.advance(180_001);

    await gateway.tick();

    await expect(table.lightClient.next("match:snapshot", 100)).rejects.toThrow(/timed out/);
    await expect(table.lightClient.next("match:ended", 100)).rejects.toThrow(/timed out/);
  });

  it("logs and keeps serving when settling an expired clock fails", async () => {
    const messages: string[] = [];
    class BrokenRuntime extends MatchRuntime {
      override settleExpiredClock(): Promise<never> {
        return Promise.reject(new Error("the database is unreachable"));
      }
    }
    const broken = new BrokenRuntime({ db: handle.db, now: clock.now });
    const spawned = await spawnGateway(broken, {
      info: () => undefined,
      error: (_context, message) => {
        messages.push(message);
      },
    });
    const light = await guests.createGuest("light-player");
    const dark = await guests.createGuest("dark-player");
    const snapshot = await broken.createMatch({
      mode: "casual",
      timeControlSeconds: 180,
      light: { actorType: "guest", actorId: light.guestId, displayName: light.displayName },
      dark: { actorType: "guest", actorId: dark.guestId, displayName: dark.displayName },
    });
    const { client } = await authenticated(light, spawned.url);
    await client.emit<MatchSyncAck>("match:sync", { matchId: snapshot.matchId });
    clock.advance(180_001);

    await spawned.gateway.tick();

    expect(messages).toEqual(["failed to settle an expired clock"]);
    expect(client.connected).toBe(true);
  });

  it("runs the cadence on a real interval once started", async () => {
    const table = await seatedMatch(180);
    clock.advance(180_001);

    gateway.startTicking();
    gateway.startTicking();

    const ended = matchEndedEventSchema.parse(await table.lightClient.next("match:ended"));
    expect(ended.reason).toBe("timeout");
  });
});

describe("suspension during a match", () => {
  it("refuses the next move and ends the socket", async () => {
    const table = await seatedAccountMatch();
    await identity.suspend(table.userId, "abuse");

    const ack = await table.lightClient.emit<CommandAck>("match:move", {
      ...envelope(table.matchId, 0),
      payload: { move: WINNING_SCRIPT[0] },
    });

    expect(ack).toMatchObject({ ok: false, reason: "not-authorized" });
    expect(fatalErrorSchema.parse(await table.lightClient.next("error:fatal"))).toEqual({
      code: "account_suspended",
      message: "This account is suspended",
      action: "contact-support",
    });
    await table.lightClient.waitForDisconnect();
    const snapshot = await runtime.getSnapshotForActor(table.matchId, {
      actorType: "guest",
      actorId: table.dark.guestId,
    });
    expect(snapshot?.version).toBe(0);
  });

  it("refuses a resignation from a suspended account", async () => {
    const table = await seatedAccountMatch();
    await identity.suspend(table.userId, "abuse");

    const ack = await table.lightClient.emit<CommandAck>("match:resign", {
      ...envelope(table.matchId, 0),
      payload: {},
    });

    expect(ack).toMatchObject({ ok: false, reason: "not-authorized" });
    await table.lightClient.waitForDisconnect();
  });

  it("lets an account act again once it has been reinstated", async () => {
    const table = await seatedAccountMatch();
    await identity.suspend(table.userId, "abuse");
    await identity.reinstate(table.userId);

    const ack = await table.lightClient.emit<CommandAck>("match:move", {
      ...envelope(table.matchId, 0),
      payload: { move: WINNING_SCRIPT[0] },
    });

    expect(ack).toMatchObject({ ok: true, newVersion: 1 });
  });
});

describe("matchmaking over the socket", () => {
  it("reports the queue a guest is waiting in", async () => {
    const guest = await guests.createGuest("guest-one");
    const { client } = await authenticated(guest);

    const ack = await client.emit<QueueJoinAck>("queue:join", {
      mode: "casual",
      timeControlSeconds: 300,
    });

    expect(queueJoinAckSchema.parse(ack)).toMatchObject({
      state: "queued",
      status: { mode: "casual", timeControlSeconds: 300, depth: 1, ratingWindow: null },
    });
  });

  it("seats two waiting guests and tells each one its own colour", async () => {
    const one = await guests.createGuest("guest-one");
    const two = await guests.createGuest("guest-two");
    const { client: firstClient } = await authenticated(one);
    const { client: secondClient } = await authenticated(two);

    await firstClient.emit<QueueJoinAck>("queue:join", {
      mode: "casual",
      timeControlSeconds: 300,
    });
    const ack = await secondClient.emit<QueueJoinAck>("queue:join", {
      mode: "casual",
      timeControlSeconds: 300,
    });

    const parsed = queueJoinAckSchema.parse(ack);
    if (parsed.state !== "matched") {
      throw new Error(`expected a match, got ${parsed.state}`);
    }
    const firstFound = matchFoundEventSchema.parse(await firstClient.next("match:found"));
    const secondFound = matchFoundEventSchema.parse(await secondClient.next("match:found"));
    expect(firstFound.matchId).toBe(parsed.matchId);
    expect(secondFound.matchId).toBe(parsed.matchId);
    expect([firstFound.yourColor, secondFound.yourColor].sort()).toEqual(["dark", "light"]);
    expect(firstFound.opponent.displayName).toBe("guest-two");
    expect(firstFound.snapshot.status).toBe("active");
  });

  it("lets the paired players move at once, because both are already in the room", async () => {
    const one = await guests.createGuest("guest-one");
    const two = await guests.createGuest("guest-two");
    const { client: firstClient } = await authenticated(one);
    const { client: secondClient } = await authenticated(two);
    await firstClient.emit<QueueJoinAck>("queue:join", { mode: "casual", timeControlSeconds: 300 });
    await secondClient.emit<QueueJoinAck>("queue:join", {
      mode: "casual",
      timeControlSeconds: 300,
    });
    const found = matchFoundEventSchema.parse(await firstClient.next("match:found"));
    await secondClient.next("match:found");

    const mover = found.yourColor === "light" ? firstClient : secondClient;
    const watcher = found.yourColor === "light" ? secondClient : firstClient;
    const ack = await mover.emit<CommandAck>("match:move", {
      ...envelope(found.matchId, 0),
      payload: { move: WINNING_SCRIPT[0] },
    });

    expect(ack).toMatchObject({ ok: true, newVersion: 1 });
    expect(await watcher.next("match:move-committed")).toMatchObject({ version: 1 });
  });

  it("answers a leave, and refuses a second one", async () => {
    const guest = await guests.createGuest("guest-one");
    const { client } = await authenticated(guest);
    await client.emit<QueueJoinAck>("queue:join", { mode: "casual", timeControlSeconds: 300 });

    expect(queueLeaveAckSchema.parse(await client.emit<QueueLeaveAck>("queue:leave", {}))).toEqual({
      ok: true,
    });
    expect(await client.emit<QueueLeaveAck>("queue:leave", {})).toEqual({
      ok: false,
      reason: "not-queued",
    });
  });

  it("refuses queue commands from a socket that has not authenticated", async () => {
    const client = await connect();

    expect(
      await client.emit<QueueJoinAck>("queue:join", { mode: "casual", timeControlSeconds: 300 }),
    ).toEqual({ state: "refused", reason: "not-authorized" });
    expect(await client.emit<QueueLeaveAck>("queue:leave", {})).toEqual({
      ok: false,
      reason: "not-authorized",
    });
  });

  it("refuses a queue request that is not a queue the server runs", async () => {
    const guest = await guests.createGuest("guest-one");
    const { client } = await authenticated(guest);

    const ack = await client.emit<QueueJoinAck>("queue:join", {
      mode: "casual",
      timeControlSeconds: 45,
    });

    expect(ack).toEqual({ state: "refused", reason: "not-authorized" });
    expect(await client.next("error:recoverable")).toMatchObject({ code: "validation_failed" });
  });

  it("refuses a leave whose payload is not the documented shape", async () => {
    const guest = await guests.createGuest("guest-one");
    const { client } = await authenticated(guest);

    const ack = await client.emit<QueueLeaveAck>("queue:leave", { mode: "casual" });

    expect(ack).toEqual({ ok: false, reason: "not-queued" });
    expect(await client.next("error:recoverable")).toMatchObject({ code: "validation_failed" });
  });

  it("refuses a guest that asks for a ranked queue", async () => {
    const guest = await guests.createGuest("guest-one");
    const { client } = await authenticated(guest);

    const ack = await client.emit<QueueJoinAck>("queue:join", {
      mode: "ranked",
      timeControlSeconds: 300,
    });

    expect(ack).toEqual({ state: "refused", reason: "ineligible" });
  });

  it("takes a player out of the queue when their socket goes away", async () => {
    const guest = await guests.createGuest("guest-one");
    const { client } = await authenticated(guest);
    await client.emit<QueueJoinAck>("queue:join", { mode: "casual", timeControlSeconds: 300 });
    expect(matchmaking.depths()).toEqual([{ mode: "casual", timeControlSeconds: 300, depth: 1 }]);

    client.close();
    await vi.waitFor(() => {
      expect(matchmaking.depths()).toEqual([]);
    });
  });

  it("tells a waiting player how long it has waited, on the cadence", async () => {
    const guest = await guests.createGuest("guest-one");
    const { client } = await authenticated(guest);
    await client.emit<QueueJoinAck>("queue:join", { mode: "casual", timeControlSeconds: 300 });

    clock.advance(2_000);
    await gateway.tick();

    expect(queueStatusSchema.parse(await client.next("queue:status"))).toMatchObject({
      waitingMs: 2_000,
      depth: 1,
    });
  });

  it("pairs two players whose windows widened while they waited", async () => {
    const ada = await verifiedAccount("ada");
    const grace = await verifiedAccount("grace");
    await upsertRating(handle.db, ada.userId, ratingFixture(1200));
    await upsertRating(handle.db, grace.userId, ratingFixture(1800));
    const adaClient = await authenticatedAccount(ada.sessionToken);
    const graceClient = await authenticatedAccount(grace.sessionToken);
    await adaClient.emit<QueueJoinAck>("queue:join", { mode: "ranked", timeControlSeconds: 300 });
    await graceClient.emit<QueueJoinAck>("queue:join", { mode: "ranked", timeControlSeconds: 300 });
    expect(matchmaking.depths()).toEqual([{ mode: "ranked", timeControlSeconds: 300, depth: 2 }]);

    clock.advance(60_000);
    await gateway.tick();

    const found = matchFoundEventSchema.parse(await adaClient.next("match:found"));
    expect(found.mode).toBe("ranked");
    expect(found.waitedMs).toBe(60_000);
    expect(found.opponent.rating).toBe(1800);
  });

  it("publishes a pairing whose players have no socket without failing", async () => {
    const ada = await verifiedAccount("ada");
    const grace = await verifiedAccount("grace");
    await upsertRating(handle.db, ada.userId, ratingFixture(1200));
    await upsertRating(handle.db, grace.userId, ratingFixture(1800));
    const alone = await verifiedAccount("alone");
    const key = { mode: "ranked", timeControlSeconds: 300 } as const;
    for (const account of [ada, grace]) {
      await matchmaking.join(
        { actor: { actorType: "user", actorId: account.userId }, displayName: "player" },
        key,
      );
    }
    // A third player in another time control still has a status to receive, and no
    // socket to receive it on.
    await matchmaking.join(
      { actor: { actorType: "user", actorId: alone.userId }, displayName: "alone" },
      { mode: "ranked", timeControlSeconds: 600 },
    );

    clock.advance(60_000);
    await expect(gateway.tick()).resolves.toBeUndefined();

    expect(matchmaking.depths()).toEqual([{ mode: "ranked", timeControlSeconds: 600, depth: 1 }]);
    expect(await runtime.hasUnfinishedMatch({ actorType: "user", actorId: ada.userId })).toBe(true);
  });

  it("logs each pairing with the wait it ended and the queues left behind", async () => {
    const one = await guests.createGuest("guest-one");
    const two = await guests.createGuest("guest-two");
    const three = await guests.createGuest("guest-three");
    const { client: firstClient } = await authenticated(one);
    const { client: secondClient } = await authenticated(two);
    const { client: thirdClient } = await authenticated(three);
    await firstClient.emit<QueueJoinAck>("queue:join", { mode: "casual", timeControlSeconds: 300 });
    await thirdClient.emit<QueueJoinAck>("queue:join", { mode: "casual", timeControlSeconds: 180 });
    clock.advance(4_000);

    await secondClient.emit<QueueJoinAck>("queue:join", {
      mode: "casual",
      timeControlSeconds: 300,
    });

    expect(logs).toEqual([
      {
        message: "paired two waiting players",
        context: {
          matchId: expect.any(String),
          mode: "casual",
          timeControlSeconds: 300,
          waitedMs: 4_000,
          depths: [{ mode: "casual", timeControlSeconds: 180, depth: 1 }],
        },
      },
    ]);
  });

  it("does not log a rematch as a pairing", async () => {
    const table = await seatedMatch();
    await table.darkClient.emit<CommandAck>("match:resign", {
      ...envelope(table.matchId, 0),
      payload: {},
    });
    await table.lightClient.next("match:ended");
    await table.lightClient.emit<RematchAck>("match:rematch-request", { matchId: table.matchId });
    await table.darkClient.emit<RematchAck>("match:rematch-respond", {
      matchId: table.matchId,
      accept: true,
    });

    expect(logs).toEqual([]);
  });

  it("releases everyone waiting when the server drains, and refuses new entries", async () => {
    const guest = await guests.createGuest("guest-one");
    const { client } = await authenticated(guest);
    await client.emit<QueueJoinAck>("queue:join", { mode: "casual", timeControlSeconds: 300 });

    gateway.drain();

    expect(recoverableErrorSchema.parse(await client.next("error:recoverable"))).toEqual({
      code: "queue_closed",
      message: "The server stopped accepting queue entries",
      retryable: true,
    });
    expect(matchmaking.depths()).toEqual([]);
    expect(
      await client.emit<QueueJoinAck>("queue:join", { mode: "casual", timeControlSeconds: 300 }),
    ).toEqual({ state: "refused", reason: "queue-closed" });
  });

  it("ends every open rematch offer when the server drains", async () => {
    const table = await seatedMatch();
    await table.darkClient.emit<CommandAck>("match:resign", {
      ...envelope(table.matchId, 0),
      payload: {},
    });
    await table.lightClient.next("match:ended");
    await table.lightClient.emit<RematchAck>("match:rematch-request", { matchId: table.matchId });
    await table.lightClient.next("match:rematch-status");
    await table.darkClient.next("match:rematch-status");

    gateway.drain();

    for (const client of [table.lightClient, table.darkClient]) {
      expect(await client.next("match:rematch-status")).toMatchObject({ state: "cancelled" });
    }
  });

  it("reports a pairing failure through the logger instead of throwing", async () => {
    const errors: string[] = [];
    const { gateway: localGateway } = await spawnGateway(runtime, {
      info: () => undefined,
      error: (_context, message) => errors.push(message),
    });
    const broken: MatchmakingQueue = {
      join: () => Promise.resolve({ outcome: "refused", reason: "queue-closed" }),
      leave: () => false,
      statusOf: () => null,
      tick: () => Promise.reject(new Error("queue unavailable")),
      depths: () => [],
      stopAcceptingEntries: () => [],
    };
    Object.assign(localGateway, { matchmaking: broken });

    await localGateway.tick();

    expect(errors).toContain("failed to pair waiting players");
  });
});

describe("rematches over the socket", () => {
  /** Waits for the offer both players are told about, so later assertions see the answer. */
  async function awaitOffer(table: Table): Promise<void> {
    for (const client of [table.lightClient, table.darkClient]) {
      expect(await client.next("match:rematch-status")).toMatchObject({ state: "offered" });
    }
  }

  /** A seated match ended by the dark player resigning, which both clients see. */
  async function endedTable(): Promise<Table> {
    const table = await seatedMatch();
    await table.darkClient.emit<CommandAck>("match:resign", {
      ...envelope(table.matchId, 0),
      payload: {},
    });
    await table.lightClient.next("match:ended");
    await table.darkClient.next("match:ended");
    return table;
  }

  it("tells both players an offer is standing", async () => {
    const table = await endedTable();

    const ack = await table.lightClient.emit<RematchAck>("match:rematch-request", {
      matchId: table.matchId,
    });

    expect(rematchAckSchema.parse(ack)).toEqual({
      ok: true,
      status: {
        matchId: table.matchId,
        state: "offered",
        requestedBy: table.light.guestId,
        expiresAt: clock.now() + REMATCH_OFFER_MS,
        nextMatchId: null,
      },
    });
    for (const client of [table.lightClient, table.darkClient]) {
      expect(
        rematchStatusEventSchema.parse(await client.next("match:rematch-status")),
      ).toMatchObject({ state: "offered" });
    }
  });

  it("seats the next match with the colours alternated when the offer is accepted", async () => {
    const table = await endedTable();
    await table.lightClient.emit<RematchAck>("match:rematch-request", { matchId: table.matchId });

    const ack = await table.darkClient.emit<RematchAck>("match:rematch-respond", {
      matchId: table.matchId,
      accept: true,
    });

    const parsed = rematchAckSchema.parse(ack);
    if (!parsed.ok) {
      throw new Error(`expected an accepted offer, got ${parsed.reason}`);
    }
    const nextMatchId = parsed.status.nextMatchId;
    expect(nextMatchId).not.toBeNull();
    const forDark = matchFoundEventSchema.parse(await table.darkClient.next("match:found"));
    const forLight = matchFoundEventSchema.parse(await table.lightClient.next("match:found"));
    expect(forDark).toMatchObject({ matchId: nextMatchId, yourColor: "light", waitedMs: 0 });
    expect(forLight).toMatchObject({ matchId: nextMatchId, yourColor: "dark" });

    // Both are already in the new room, so the first move needs no sync.
    const moved = await table.darkClient.emit<CommandAck>("match:move", {
      ...envelope(forDark.matchId, 0),
      payload: { move: WINNING_SCRIPT[0] },
    });
    expect(moved).toMatchObject({ ok: true, newVersion: 1 });
    expect(await table.lightClient.next("match:move-committed")).toMatchObject({ version: 1 });
  });

  it("tells both players when an offer is declined", async () => {
    const table = await endedTable();
    await table.lightClient.emit<RematchAck>("match:rematch-request", { matchId: table.matchId });
    await awaitOffer(table);

    await table.darkClient.emit<RematchAck>("match:rematch-respond", {
      matchId: table.matchId,
      accept: false,
    });

    for (const client of [table.lightClient, table.darkClient]) {
      expect(await client.next("match:rematch-status")).toMatchObject({ state: "declined" });
    }
  });

  it("expires an unanswered offer on the cadence", async () => {
    const table = await endedTable();
    await table.lightClient.emit<RematchAck>("match:rematch-request", { matchId: table.matchId });
    await awaitOffer(table);

    clock.advance(REMATCH_OFFER_MS);
    await gateway.tick();

    for (const client of [table.lightClient, table.darkClient]) {
      expect(await client.next("match:rematch-status")).toMatchObject({
        state: "expired",
        nextMatchId: null,
      });
    }
  });

  it("ends an offer when the player who made it disconnects", async () => {
    const table = await endedTable();
    await table.lightClient.emit<RematchAck>("match:rematch-request", { matchId: table.matchId });
    await awaitOffer(table);

    table.lightClient.close();

    expect(await table.darkClient.next("match:rematch-status")).toMatchObject({
      state: "cancelled",
    });
  });

  it("refuses a rematch of a match the player did not play", async () => {
    const table = await endedTable();
    const stranger = await guests.createGuest("stranger");
    const { client } = await authenticated(stranger);

    const ack = await client.emit<RematchAck>("match:rematch-request", { matchId: table.matchId });

    expect(rematchAckSchema.parse(ack)).toEqual({ ok: false, reason: "not-participant" });
  });

  it("refuses rematch commands from a socket that has not authenticated", async () => {
    const client = await connect();

    expect(
      await client.emit<RematchAck>("match:rematch-request", { matchId: randomUUID() }),
    ).toEqual({ ok: false, reason: "not-authorized" });
    expect(
      await client.emit<RematchAck>("match:rematch-respond", {
        matchId: randomUUID(),
        accept: true,
      }),
    ).toEqual({ ok: false, reason: "not-authorized" });
  });

  it("refuses rematch payloads that are not the documented shape", async () => {
    const table = await endedTable();

    expect(
      await table.lightClient.emit<RematchAck>("match:rematch-request", { matchId: "not-a-uuid" }),
    ).toEqual({ ok: false, reason: "not-authorized" });
    expect(await table.lightClient.next("error:recoverable")).toMatchObject({
      code: "validation_failed",
    });
    expect(
      await table.lightClient.emit<RematchAck>("match:rematch-respond", {
        matchId: table.matchId,
      }),
    ).toEqual({ ok: false, reason: "not-authorized" });
    expect(await table.lightClient.next("error:recoverable")).toMatchObject({
      code: "validation_failed",
    });
  });
});
