import { randomUUID } from "node:crypto";
import { loadServerConfig } from "@gobblet/config";
import type { ServerConfig } from "@gobblet/config";
import type { DatabaseHandle } from "@gobblet/db";
import {
  fatalErrorSchema,
  matchClockSyncEventSchema,
  matchEndedEventSchema,
  matchMoveCommittedEventSchema,
  matchSnapshotSchema,
  recoverableErrorSchema,
  sessionReadySchema,
} from "@gobblet/protocol";
import type {
  CommandAck,
  CreateGuestResponse,
  MatchSyncAck,
  SessionAuthenticateAck,
} from "@gobblet/protocol";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { GuestService } from "../src/guests/service";
import { IdentityService } from "../src/identity/service";
import { MatchRuntime } from "../src/match/runtime";
import { MatchGateway, isClientVersionSupported } from "../src/socket/gateway";
import type { GatewayLogger } from "../src/socket/gateway";
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
  runtime = new MatchRuntime({ db: handle.db, now: clock.now });
  guests = new GuestService({ db: handle.db, config, now: clock.now });
  identity = new IdentityService({ db: handle.db, config, now: clock.now });
  app = await buildApp({ config, services: { runtime, guests, identity }, now: clock.now });
  await app.listen({ host: "127.0.0.1", port: 0 });
  gateway = new MatchGateway({
    httpServer: app.server,
    config,
    runtime,
    resolvers: { identity, guests },
    log: { error: () => undefined },
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
  log: GatewayLogger = { error: () => undefined },
): Promise<{ gateway: MatchGateway; url: string }> {
  const localApp = await buildApp({
    config,
    services: { runtime: gatewayRuntime, guests, identity },
    now: clock.now,
  });
  await localApp.listen({ host: "127.0.0.1", port: 0 });
  const localGateway = new MatchGateway({
    httpServer: localApp.server,
    config,
    runtime: gatewayRuntime,
    resolvers: { identity, guests },
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

describe("isClientVersionSupported", () => {
  it.each([
    ["0.1.0", "0.1.0", true],
    ["1.0.0", "0.1.0", true],
    ["0.2.0", "0.1.9", true],
    ["0.1.1", "0.1.0", true],
    ["0.0.9", "0.1.0", false],
    ["0.1.0", "0.1.1", false],
    ["0.1", "0.1.0", false],
    ["banana", "0.1.0", false],
    ["0.1.0", "not-a-version", false],
  ])("compares %s against %s", (client, minimum, expected) => {
    expect(isClientVersionSupported(client, minimum)).toBe(expected);
  });
});

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
