import { loadServerConfig } from "@gobblet/config";
import { listRatingChangesForMatch, upsertRating } from "@gobblet/db";
import type { DatabaseHandle } from "@gobblet/db";
import {
  ELO_K_FACTOR,
  REMATCH_OFFER_MS,
  STARTING_RATING,
  authResponseSchema,
  matchEndedEventSchema,
  matchFoundEventSchema,
  queueJoinAckSchema,
  queueStatusSchema,
  recoverableErrorSchema,
  rematchStatusEventSchema,
} from "@gobblet/protocol";
import type {
  AuthResponse,
  CommandAck,
  CreateGuestResponse,
  MatchFoundEvent,
  QueueJoinAck,
  RematchAck,
  SessionAuthenticateAck,
} from "@gobblet/protocol";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bootstrapServer } from "../src/bootstrap";
import type { BootstrappedServer } from "../src/bootstrap";
import { TestClock, WINNING_SCRIPT, envelope } from "./helpers/match-fixtures";
import { TestClient } from "./helpers/socket-client";
import { TEST_DATABASE_URL, setupTestDatabase, truncateAll } from "./helpers/test-database";

/**
 * The Phase 4 exit criteria of spec section 20.5, as amended by appendix P4, proved
 * end to end against a real database and real sockets: two guests find each other in
 * a casual queue, two verified accounts find each other in a ranked one, the ratings
 * a completed ranked match writes match the reference vectors, a rematch alternates
 * the colours, and a restart leaves no queue entry and no offer behind.
 */

const env = {
  APP_ENV: "local" as const,
  APP_VERSION: "9.9.9",
  GIT_SHA: "testsha",
  LOG_LEVEL: "fatal" as const,
  DATABASE_URL: TEST_DATABASE_URL,
};

const CLIENT_VERSION = "0.1.0";
const PASSWORD = "correct-horse-7";
const CASUAL = { mode: "casual", timeControlSeconds: 300 } as const;
const RANKED = { mode: "ranked", timeControlSeconds: 300 } as const;

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
  // The server's own cadence runs, but its clock is the test's, so waiting is a
  // matter of moving the clock rather than of sleeping (ADR-0018).
  const server = await bootstrapServer({ config: loadServerConfig(env), now: clock.now });
  servers.push(server);
  await server.app.listen({ host: "127.0.0.1", port: 0 });

  const address = server.app.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected a TCP address");
  }
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function createGuest(server: BootstrappedServer): Promise<CreateGuestResponse> {
  const response = await server.app.inject({ method: "POST", url: "/v1/guests", payload: {} });
  expect(response.statusCode).toBe(201);
  return response.json<CreateGuestResponse>();
}

/** A registered account with a verified email, which a ranked seat requires. */
async function verifiedAccount(
  server: BootstrappedServer,
  username: string,
): Promise<AuthResponse> {
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

type Pairing = Readonly<{
  matchId: string;
  first: MatchFoundEvent;
  second: MatchFoundEvent;
  firstClient: TestClient;
  secondClient: TestClient;
}>;

/** Puts two connected clients in the same queue and waits for the match. */
async function queueTogether(
  firstClient: TestClient,
  secondClient: TestClient,
  key: typeof CASUAL | typeof RANKED,
): Promise<Pairing> {
  const queued = queueJoinAckSchema.parse(await firstClient.emit<QueueJoinAck>("queue:join", key));
  expect(queued.state).toBe("queued");
  const matched = queueJoinAckSchema.parse(
    await secondClient.emit<QueueJoinAck>("queue:join", key),
  );
  if (matched.state !== "matched") {
    throw new Error(`expected the second player to be seated, got ${matched.state}`);
  }

  const first = matchFoundEventSchema.parse(await firstClient.next("match:found"));
  const second = matchFoundEventSchema.parse(await secondClient.next("match:found"));
  return { matchId: matched.matchId, first, second, firstClient, secondClient };
}

/** Plays the winning script to its end, light moving first. */
async function playToLightWin(pairing: Pairing): Promise<void> {
  const lightClient =
    pairing.first.yourColor === "light" ? pairing.firstClient : pairing.secondClient;
  const darkClient =
    pairing.first.yourColor === "light" ? pairing.secondClient : pairing.firstClient;

  for (const [index, move] of WINNING_SCRIPT.entries()) {
    const client = index % 2 === 0 ? lightClient : darkClient;
    const ack = await client.emit<CommandAck>("match:move", {
      ...envelope(pairing.matchId, index),
      payload: { move },
    });
    expect(ack).toMatchObject({ ok: true });
  }
}

describe("guest casual matching", () => {
  it("pairs two guests who never registered, and lets them play at once", async () => {
    const { server, url } = await boot();
    const one = await createGuest(server);
    const two = await createGuest(server);
    const firstClient = await connected(url, one.sessionToken);
    const secondClient = await connected(url, two.sessionToken);

    const pairing = await queueTogether(firstClient, secondClient, CASUAL);

    expect(pairing.first).toMatchObject({ mode: "casual", timeControlSeconds: 300 });
    expect([pairing.first.yourColor, pairing.second.yourColor].sort()).toEqual(["dark", "light"]);
    expect(pairing.first.opponent).toMatchObject({ actorType: "guest", rating: null });
    expect(server.matchmaking.depths()).toEqual([]);

    await playToLightWin(pairing);

    const ended = matchEndedEventSchema.parse(await firstClient.next("match:ended"));
    expect(ended).toMatchObject({ result: "light", reason: "line" });
    // A casual match is never rated, so the event carries no ratings at all.
    expect(ended.ratings).toBeUndefined();
    expect(await listRatingChangesForMatch(handle.db, pairing.matchId)).toEqual([]);
  });

  it("tells a waiting guest what it is waiting for, and lets it leave", async () => {
    const { server, url } = await boot();
    const guest = await createGuest(server);
    const client = await connected(url, guest.sessionToken);

    const ack = queueJoinAckSchema.parse(await client.emit<QueueJoinAck>("queue:join", CASUAL));
    if (ack.state !== "queued") {
      throw new Error(`expected the guest to wait, got ${ack.state}`);
    }

    expect(queueStatusSchema.parse(ack.status)).toMatchObject({
      ...CASUAL,
      depth: 1,
      waitingMs: 0,
      ratingWindow: null,
    });
    expect(await client.emit("queue:leave", {})).toEqual({ ok: true });
    expect(server.matchmaking.depths()).toEqual([]);
  });
});

describe("registered ranked matching", () => {
  it("pairs two verified accounts and rates the match they play", async () => {
    const { server, url } = await boot();
    const ada = await verifiedAccount(server, "ada");
    const grace = await verifiedAccount(server, "grace");
    const adaClient = await connected(url, ada.session.sessionToken);
    const graceClient = await connected(url, grace.session.sessionToken);

    const pairing = await queueTogether(adaClient, graceClient, RANKED);

    expect(pairing.first).toMatchObject({ mode: "ranked" });
    expect(pairing.first.opponent.rating).toBeNull();

    await playToLightWin(pairing);

    const ended = matchEndedEventSchema.parse(await adaClient.next("match:ended"));
    expect(ended.ratings).toEqual({
      light: {
        before: STARTING_RATING,
        after: STARTING_RATING + ELO_K_FACTOR / 2,
        delta: ELO_K_FACTOR / 2,
        opponentBefore: STARTING_RATING,
        outcome: "win",
        formulaVersion: 1,
      },
      dark: {
        before: STARTING_RATING,
        after: STARTING_RATING - ELO_K_FACTOR / 2,
        delta: -ELO_K_FACTOR / 2,
        opponentBefore: STARTING_RATING,
        outcome: "loss",
        formulaVersion: 1,
      },
    });
    const stored = await listRatingChangesForMatch(handle.db, pairing.matchId);
    expect(stored).toHaveLength(2);
    const winner = pairing.first.yourColor === "light" ? "ada" : "grace";
    const profile = await server.app.inject({ method: "GET", url: `/v1/profiles/${winner}` });
    expect(profile.json<{ ranked: { rating: number; wins: number } }>().ranked).toMatchObject({
      rating: 1216,
      wins: 1,
    });
  });

  it("refuses a ranked queue to a guest and to an unverified account", async () => {
    const { server, url } = await boot();
    const guest = await createGuest(server);
    const registered = await server.app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email: "unverified@example.com", password: PASSWORD, username: "unverified" },
    });
    const unverified = authResponseSchema.parse(registered.json());

    for (const token of [guest.sessionToken, unverified.session.sessionToken]) {
      const client = await connected(url, token);
      expect(await client.emit<QueueJoinAck>("queue:join", RANKED)).toEqual({
        state: "refused",
        reason: "ineligible",
      });
    }
    expect(server.matchmaking.depths()).toEqual([]);
  });

  it("widens the rating window until two distant accounts can meet", async () => {
    const { server, url } = await boot();
    const ada = await verifiedAccount(server, "ada");
    const grace = await verifiedAccount(server, "grace");
    await upsertRating(handle.db, ada.account.userId, ratingOf(1000));
    await upsertRating(handle.db, grace.account.userId, ratingOf(1900));
    const adaClient = await connected(url, ada.session.sessionToken);
    const graceClient = await connected(url, grace.session.sessionToken);

    expect(
      queueJoinAckSchema.parse(await adaClient.emit<QueueJoinAck>("queue:join", RANKED)).state,
    ).toBe("queued");
    expect(
      queueJoinAckSchema.parse(await graceClient.emit<QueueJoinAck>("queue:join", RANKED)).state,
    ).toBe("queued");
    expect(server.matchmaking.depths()).toEqual([{ ...RANKED, depth: 2 }]);

    // 900 points apart is outside every window, so only the rule that removes the
    // window after 60 seconds can pair them.
    clock.advance(59_000);
    expect(server.matchmaking.depths()).toEqual([{ ...RANKED, depth: 2 }]);
    clock.advance(1_000);
    await waitForPairing(adaClient, graceClient);

    expect(server.matchmaking.depths()).toEqual([]);
  });
});

describe("Elo reference vectors", () => {
  it("moves a 1000 who beats an 1800 by the full K factor, and the 1800 by the same", async () => {
    const { server, url } = await boot();
    const ada = await verifiedAccount(server, "ada");
    const grace = await verifiedAccount(server, "grace");
    await upsertRating(handle.db, ada.account.userId, ratingOf(1000));
    await upsertRating(handle.db, grace.account.userId, ratingOf(1800));
    const adaClient = await connected(url, ada.session.sessionToken);
    const graceClient = await connected(url, grace.session.sessionToken);
    await adaClient.emit<QueueJoinAck>("queue:join", RANKED);
    await graceClient.emit<QueueJoinAck>("queue:join", RANKED);
    clock.advance(60_000);
    const pairing = await waitForPairing(adaClient, graceClient);

    // The favourite resigns, so the underdog wins whichever colour it drew.
    const resigned = await graceClient.emit<CommandAck>("match:resign", {
      ...envelope(pairing.matchId, 0),
      payload: {},
    });
    expect(resigned).toMatchObject({ ok: true });

    const ended = matchEndedEventSchema.parse(await adaClient.next("match:ended"));
    const underdog = pairing.first.yourColor;
    const favourite = underdog === "light" ? "dark" : "light";
    expect(ended.ratings?.[underdog]).toEqual({
      before: 1000,
      after: 1032,
      delta: 32,
      opponentBefore: 1800,
      outcome: "win",
      formulaVersion: 1,
    });
    expect(ended.ratings?.[favourite]).toEqual({
      before: 1800,
      after: 1768,
      delta: -32,
      opponentBefore: 1000,
      outcome: "loss",
      formulaVersion: 1,
    });
    expect(await listRatingChangesForMatch(handle.db, pairing.matchId)).toHaveLength(2);
    expect(server.matchmaking.depths()).toEqual([]);
  });
});

describe("rematches", () => {
  it("alternates the colours and records the match it followed", async () => {
    const { server, url } = await boot();
    const one = await createGuest(server);
    const two = await createGuest(server);
    const firstClient = await connected(url, one.sessionToken);
    const secondClient = await connected(url, two.sessionToken);
    const pairing = await queueTogether(firstClient, secondClient, CASUAL);
    await playToLightWin(pairing);
    await firstClient.next("match:ended");
    await secondClient.next("match:ended");

    const offered = await firstClient.emit<RematchAck>("match:rematch-request", {
      matchId: pairing.matchId,
    });
    expect(offered).toMatchObject({ ok: true, status: { state: "offered" } });
    expect(
      rematchStatusEventSchema.parse(await secondClient.next("match:rematch-status")),
    ).toMatchObject({ state: "offered", requestedBy: expect.any(String) });
    const accepted = await secondClient.emit<RematchAck>("match:rematch-respond", {
      matchId: pairing.matchId,
      accept: true,
    });

    expect(accepted).toMatchObject({ ok: true, status: { state: "accepted" } });
    const again = matchFoundEventSchema.parse(await firstClient.next("match:found"));
    const opponentAgain = matchFoundEventSchema.parse(await secondClient.next("match:found"));
    expect(again.matchId).toBe(opponentAgain.matchId);
    expect(again.matchId).not.toBe(pairing.matchId);
    expect(again.yourColor).not.toBe(pairing.first.yourColor);
    expect(opponentAgain.yourColor).not.toBe(pairing.second.yourColor);
    expect(again).toMatchObject({ mode: "casual", timeControlSeconds: 300 });

    const summary = await server.app.inject({
      method: "GET",
      url: `/v1/matches/${again.matchId}`,
      headers: { authorization: `Bearer ${one.sessionToken}` },
    });
    expect(summary.statusCode).toBe(200);
  });

  it("returns both players to the post-match state when nobody answers", async () => {
    const { url, server } = await boot();
    const one = await createGuest(server);
    const two = await createGuest(server);
    const firstClient = await connected(url, one.sessionToken);
    const secondClient = await connected(url, two.sessionToken);
    const pairing = await queueTogether(firstClient, secondClient, CASUAL);
    await playToLightWin(pairing);
    await firstClient.next("match:ended");

    await firstClient.emit<RematchAck>("match:rematch-request", { matchId: pairing.matchId });
    await firstClient.next("match:rematch-status");
    await secondClient.next("match:rematch-status");

    clock.advance(REMATCH_OFFER_MS);
    const expired = rematchStatusEventSchema.parse(await secondClient.next("match:rematch-status"));
    expect(expired).toMatchObject({ state: "expired", nextMatchId: null });
    expect(
      await secondClient.emit<RematchAck>("match:rematch-respond", {
        matchId: pairing.matchId,
        accept: true,
      }),
    ).toEqual({ ok: false, reason: "no-offer" });
  });
});

describe("queue behaviour across a restart", () => {
  it("releases waiting players when the process drains, and starts the next one empty", async () => {
    const first = await boot();
    const guest = await createGuest(first.server);
    const client = await connected(first.url, guest.sessionToken);
    expect(
      queueJoinAckSchema.parse(await client.emit<QueueJoinAck>("queue:join", CASUAL)).state,
    ).toBe("queued");

    first.server.gateway.drain();

    expect(recoverableErrorSchema.parse(await client.next("error:recoverable"))).toMatchObject({
      code: "queue_closed",
      retryable: true,
    });
    expect(first.server.matchmaking.depths()).toEqual([]);
    expect(await client.emit<QueueJoinAck>("queue:join", CASUAL)).toEqual({
      state: "refused",
      reason: "queue-closed",
    });

    // The next process starts with nothing: no entry rejoins on a player's behalf.
    const second = await boot();
    expect(second.server.matchmaking.depths()).toEqual([]);
    const returning = await connected(second.url, guest.sessionToken);
    expect(
      queueJoinAckSchema.parse(await returning.emit<QueueJoinAck>("queue:join", CASUAL)).state,
    ).toBe("queued");
    expect(second.server.matchmaking.depths()).toEqual([{ ...CASUAL, depth: 1 }]);
  });

  it("keeps the match a restart interrupted, but not the offer that followed it", async () => {
    const first = await boot();
    const one = await createGuest(first.server);
    const two = await createGuest(first.server);
    const firstClient = await connected(first.url, one.sessionToken);
    const secondClient = await connected(first.url, two.sessionToken);
    const pairing = await queueTogether(firstClient, secondClient, CASUAL);
    await playToLightWin(pairing);
    await firstClient.next("match:ended");
    await firstClient.emit<RematchAck>("match:rematch-request", { matchId: pairing.matchId });
    await secondClient.next("match:rematch-status");

    first.server.gateway.drain();

    expect(
      rematchStatusEventSchema.parse(await secondClient.next("match:rematch-status")),
    ).toMatchObject({ state: "cancelled" });
    const second = await boot();
    const returning = await connected(second.url, two.sessionToken);
    expect(
      await returning.emit<RematchAck>("match:rematch-respond", {
        matchId: pairing.matchId,
        accept: true,
      }),
    ).toEqual({ ok: false, reason: "no-offer" });
    // The match itself survived, because it is persisted.
    const summary = await second.server.app.inject({
      method: "GET",
      url: `/v1/matches/${pairing.matchId}`,
      headers: { authorization: `Bearer ${two.sessionToken}` },
    });
    expect(summary.json<{ status: string }>().status).toBe("completed");
  });
});

function ratingOf(rating: number): Parameters<typeof upsertRating>[2] {
  return {
    rating,
    gamesPlayed: 10,
    wins: 5,
    losses: 5,
    draws: 0,
    currentStreak: 0,
    bestStreak: 3,
  };
}

/**
 * Waits for the pairing that only waiting can produce: the window is removed after
 * 60 seconds, and the server's own cadence is what notices (spec section 9.2).
 */
async function waitForPairing(firstClient: TestClient, secondClient: TestClient): Promise<Pairing> {
  const first = matchFoundEventSchema.parse(await firstClient.next("match:found", 5_000));
  const second = matchFoundEventSchema.parse(await secondClient.next("match:found", 5_000));
  return { matchId: first.matchId, first, second, firstClient, secondClient };
}
