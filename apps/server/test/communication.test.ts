import { randomUUID } from "node:crypto";
import { loadServerConfig } from "@gobblet/config";
import type { ServerConfig } from "@gobblet/config";
import type { DatabaseHandle } from "@gobblet/db";
import {
  presetMessageEventSchema,
  reactionEventSchema,
  recoverableErrorSchema,
} from "@gobblet/protocol";
import type {
  CommunicationAck,
  CreateGuestResponse,
  MatchSyncAck,
  PresetMessageEvent,
  ReactionEvent,
  SessionAuthenticateAck,
} from "@gobblet/protocol";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { GuestService } from "../src/guests/service";
import { IdentityService } from "../src/identity/service";
import { LeaderboardService } from "../src/leaderboard/service";
import { RematchService } from "../src/matchmaking/rematch";
import { MatchmakingService } from "../src/matchmaking/service";
import { MatchRuntime } from "../src/match/runtime";
import { MatchGateway } from "../src/socket/gateway";
import { ChannelMutes } from "../src/socket/communication";
import { createSilentTelemetry } from "../src/observability/telemetry";
import { adminServiceFixture, releaseServiceFixture } from "./helpers/admin-service";
import { TestClock, envelope } from "./helpers/match-fixtures";
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
  app = await buildApp({
    config,
    services: {
      runtime,
      guests,
      identity,
      leaderboards: new LeaderboardService({ db: handle.db, now: clock.now }),
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
    matchmaking: new MatchmakingService({ runtime, identity, now: clock.now }),
    rematch: new RematchService({ runtime, identity, now: clock.now }),
    log: { info: () => undefined, error: () => undefined },
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
  await gateway.close();
  await app.close();
});

async function authenticate(sessionToken: string): Promise<TestClient> {
  const client = new TestClient(url);
  clients.push(client);
  await client.connect();
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

async function seatedMatch(): Promise<Table> {
  const light = await guests.createGuest("light-player");
  const dark = await guests.createGuest("dark-player");
  const snapshot = await runtime.createMatch({
    mode: "casual",
    timeControlSeconds: 300,
    light: { actorType: "guest", actorId: light.guestId, displayName: light.displayName },
    dark: { actorType: "guest", actorId: dark.guestId, displayName: dark.displayName },
  });

  const lightClient = await authenticate(light.sessionToken);
  const darkClient = await authenticate(dark.sessionToken);
  await lightClient.emit<MatchSyncAck>("match:sync", { matchId: snapshot.matchId });
  await darkClient.emit<MatchSyncAck>("match:sync", { matchId: snapshot.matchId });

  return { matchId: snapshot.matchId, light, dark, lightClient, darkClient };
}

/** Nothing arrives, proved by a short wait that is expected to time out. */
async function receivesNothing(client: TestClient, event: string): Promise<void> {
  await expect(client.next(event, 150)).rejects.toThrow(/timed out/);
}

describe("ChannelMutes", () => {
  it("withholds only the channel that was muted, and forgets it when unmuted", () => {
    const mutes = new ChannelMutes<object>();
    const connection = {};

    expect(mutes.withholds(connection, "preset-messages")).toBe(false);
    expect(mutes.withholds(connection, "reactions")).toBe(false);

    mutes.set(connection, { presetMessagesMuted: true, reactionsMuted: false });
    expect(mutes.withholds(connection, "preset-messages")).toBe(true);
    expect(mutes.withholds(connection, "reactions")).toBe(false);

    mutes.set(connection, { presetMessagesMuted: false, reactionsMuted: true });
    expect(mutes.withholds(connection, "preset-messages")).toBe(false);
    expect(mutes.withholds(connection, "reactions")).toBe(true);
  });

  it("keeps connections apart", () => {
    const mutes = new ChannelMutes<object>();
    const muted = {};
    const listening = {};

    mutes.set(muted, { presetMessagesMuted: true, reactionsMuted: true });

    expect(mutes.withholds(muted, "reactions")).toBe(true);
    expect(mutes.withholds(listening, "reactions")).toBe(false);
  });
});

describe("match:preset-message", () => {
  it("relays a phrase to the opponent and echoes it to the sender", async () => {
    const table = await seatedMatch();

    const ack = await table.lightClient.emit<CommunicationAck>("match:preset-message", {
      matchId: table.matchId,
      messageKey: "good-luck",
    });

    expect(ack).toEqual({ ok: true });
    const delivered = presetMessageEventSchema.parse(
      await table.darkClient.next<PresetMessageEvent>("match:preset-message"),
    );
    expect(delivered).toEqual({
      matchId: table.matchId,
      from: "light",
      actorId: table.light.guestId,
      sentAt: clock.now(),
      messageKey: "good-luck",
    });
    expect(await table.lightClient.next<PresetMessageEvent>("match:preset-message")).toEqual(
      delivered,
    );
  });

  it("refuses a key that is not in the closed set, and relays nothing", async () => {
    const table = await seatedMatch();

    const ack = await table.lightClient.emit<CommunicationAck>("match:preset-message", {
      matchId: table.matchId,
      messageKey: "you-are-terrible",
    });

    expect(ack).toEqual({ ok: false, reason: "invalid-payload" });
    expect(
      recoverableErrorSchema.parse(await table.lightClient.next("error:recoverable")).code,
    ).toBe("validation_failed");
    await receivesNothing(table.darkClient, "match:preset-message");
  });

  it("accepts a phrase whose recipient is not connected, and delivers it to nobody", async () => {
    const light = await guests.createGuest("light-player");
    const dark = await guests.createGuest("dark-player");
    const snapshot = await runtime.createMatch({
      mode: "casual",
      timeControlSeconds: 300,
      light: { actorType: "guest", actorId: light.guestId, displayName: light.displayName },
      dark: { actorType: "guest", actorId: dark.guestId, displayName: dark.displayName },
    });
    const lightClient = await authenticate(light.sessionToken);

    const ack = await lightClient.emit<CommunicationAck>("match:preset-message", {
      matchId: snapshot.matchId,
      messageKey: "good-luck",
    });

    expect(ack).toEqual({ ok: true });
    expect((await lightClient.next<PresetMessageEvent>("match:preset-message")).messageKey).toBe(
      "good-luck",
    );
  });

  it("refuses a sender who is not a participant of the match", async () => {
    const table = await seatedMatch();
    const stranger = await guests.createGuest("stranger");
    const strangerClient = await authenticate(stranger.sessionToken);

    const ack = await strangerClient.emit<CommunicationAck>("match:preset-message", {
      matchId: table.matchId,
      messageKey: "good-luck",
    });

    expect(ack).toEqual({ ok: false, reason: "not-participant" });
    await receivesNothing(table.darkClient, "match:preset-message");
  });

  it("refuses a connection that never authenticated", async () => {
    const table = await seatedMatch();
    const anonymous = new TestClient(url);
    clients.push(anonymous);
    await anonymous.connect();

    const ack = await anonymous.emit<CommunicationAck>("match:preset-message", {
      matchId: table.matchId,
      messageKey: "good-luck",
    });

    expect(ack).toEqual({ ok: false, reason: "not-authorized" });
  });

  it("still relays after the match has ended, so a closing phrase can be sent", async () => {
    const table = await seatedMatch();
    await runtime.applyResignCommand(
      { actorType: "guest", actorId: table.light.guestId },
      envelope(table.matchId, 0),
    );

    const ack = await table.darkClient.emit<CommunicationAck>("match:preset-message", {
      matchId: table.matchId,
      messageKey: "good-game",
    });

    expect(ack).toEqual({ ok: true });
    expect(
      (await table.lightClient.next<PresetMessageEvent>("match:preset-message")).messageKey,
    ).toBe("good-game");
  });
});

describe("match:reaction", () => {
  it("relays a reaction with the seat that sent it", async () => {
    const table = await seatedMatch();

    const ack = await table.darkClient.emit<CommunicationAck>("match:reaction", {
      matchId: table.matchId,
      reactionKey: "tap",
    });

    expect(ack).toEqual({ ok: true });
    expect(
      reactionEventSchema.parse(await table.lightClient.next<ReactionEvent>("match:reaction")),
    ).toMatchObject({ from: "dark", reactionKey: "tap" });
  });

  it("refuses a reaction key outside the set", async () => {
    const table = await seatedMatch();

    expect(
      await table.lightClient.emit<CommunicationAck>("match:reaction", {
        matchId: table.matchId,
        reactionKey: "rude-gesture",
      }),
    ).toEqual({ ok: false, reason: "invalid-payload" });
  });
});

describe("match:mute-state", () => {
  it("withholds the muted channel from the recipient and leaves the other alone", async () => {
    const table = await seatedMatch();

    expect(
      await table.darkClient.emit<CommunicationAck>("match:mute-state", {
        matchId: table.matchId,
        presetMessagesMuted: true,
        reactionsMuted: false,
      }),
    ).toEqual({ ok: true });
    await table.lightClient.emit<CommunicationAck>("match:preset-message", {
      matchId: table.matchId,
      messageKey: "good-luck",
    });
    await table.lightClient.emit<CommunicationAck>("match:reaction", {
      matchId: table.matchId,
      reactionKey: "smile",
    });

    await receivesNothing(table.darkClient, "match:preset-message");
    expect((await table.darkClient.next<ReactionEvent>("match:reaction")).reactionKey).toBe(
      "smile",
    );
  });

  it("still echoes to a sender who has muted the channel themselves", async () => {
    const table = await seatedMatch();
    await table.lightClient.emit<CommunicationAck>("match:mute-state", {
      matchId: table.matchId,
      presetMessagesMuted: true,
      reactionsMuted: true,
    });

    await table.lightClient.emit<CommunicationAck>("match:preset-message", {
      matchId: table.matchId,
      messageKey: "well-played",
    });

    expect(
      (await table.lightClient.next<PresetMessageEvent>("match:preset-message")).messageKey,
    ).toBe("well-played");
  });

  it("unmutes again, which delivers the next message", async () => {
    const table = await seatedMatch();
    await table.darkClient.emit<CommunicationAck>("match:mute-state", {
      matchId: table.matchId,
      presetMessagesMuted: true,
      reactionsMuted: true,
    });
    await table.darkClient.emit<CommunicationAck>("match:mute-state", {
      matchId: table.matchId,
      presetMessagesMuted: false,
      reactionsMuted: false,
    });

    await table.lightClient.emit<CommunicationAck>("match:preset-message", {
      matchId: table.matchId,
      messageKey: "good-luck",
    });

    expect(
      (await table.darkClient.next<PresetMessageEvent>("match:preset-message")).messageKey,
    ).toBe("good-luck");
  });

  it("refuses a mute change from a non-participant, an unauthenticated socket or a bad payload", async () => {
    const table = await seatedMatch();
    const stranger = await guests.createGuest("stranger");
    const strangerClient = await authenticate(stranger.sessionToken);
    const anonymous = new TestClient(url);
    clients.push(anonymous);
    await anonymous.connect();

    expect(
      await strangerClient.emit<CommunicationAck>("match:mute-state", {
        matchId: table.matchId,
        presetMessagesMuted: true,
        reactionsMuted: true,
      }),
    ).toEqual({ ok: false, reason: "not-participant" });
    expect(
      await anonymous.emit<CommunicationAck>("match:mute-state", {
        matchId: table.matchId,
        presetMessagesMuted: true,
        reactionsMuted: true,
      }),
    ).toEqual({ ok: false, reason: "not-authorized" });
    expect(
      await table.lightClient.emit<CommunicationAck>("match:mute-state", {
        matchId: table.matchId,
        presetMessagesMuted: "yes",
        reactionsMuted: true,
      }),
    ).toEqual({ ok: false, reason: "invalid-payload" });
  });

  it("starts a connection from the mute settings on the account's profile", async () => {
    const registered = await identity.register({
      email: "ada@example.com",
      password: "correct-horse-7",
      username: "ada",
    });
    if (!registered.ok) {
      throw new Error("expected registration to succeed");
    }
    await identity.updateProfile(registered.value.account.userId, { presetMessagesMuted: true });
    const guest = await guests.createGuest("guest-player");
    const snapshot = await runtime.createMatch({
      mode: "casual",
      timeControlSeconds: 300,
      light: { actorType: "guest", actorId: guest.guestId, displayName: guest.displayName },
      dark: { actorType: "user", actorId: registered.value.account.userId, displayName: "ada" },
    });
    const guestClient = await authenticate(guest.sessionToken);
    const accountClient = await authenticate(registered.value.session.sessionToken);
    await accountClient.emit<MatchSyncAck>("match:sync", { matchId: snapshot.matchId });

    await guestClient.emit<CommunicationAck>("match:preset-message", {
      matchId: snapshot.matchId,
      messageKey: "good-luck",
    });
    await guestClient.emit<CommunicationAck>("match:reaction", {
      matchId: snapshot.matchId,
      reactionKey: "applause",
    });

    await receivesNothing(accountClient, "match:preset-message");
    expect((await accountClient.next<ReactionEvent>("match:reaction")).reactionKey).toBe(
      "applause",
    );
  });

  it("has nothing to seed from for an account with no profile", async () => {
    expect(await identity.communicationMutes(randomUUID())).toBeNull();
  });
});
