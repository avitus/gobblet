import { loadServerConfig } from "@gobblet/config";
import type { DatabaseHandle } from "@gobblet/db";
import {
  authResponseSchema,
  matchEndedEventSchema,
  matchHistoryResponseSchema,
  publicProfileSchema,
} from "@gobblet/protocol";
import type {
  AuthResponse,
  ClaimGuestResponse,
  CommandAck,
  CreateGuestResponse,
  MatchSyncAck,
  SessionAuthenticateAck,
} from "@gobblet/protocol";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bootstrapServer } from "../src/bootstrap";
import type { BootstrappedServer } from "../src/bootstrap";
import { WINNING_SCRIPT, envelope } from "./helpers/match-fixtures";
import { TestClient } from "./helpers/socket-client";
import { TEST_DATABASE_URL, setupTestDatabase, truncateAll } from "./helpers/test-database";

/**
 * The Phase 3 exit criteria of spec section 20.5, as amended by appendix P3,
 * proved end to end against a real database and real sockets: the delivered
 * credential works, a guest claims its play, racing claims of one username
 * produce one account, and a suspended account cannot reach a match.
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

let handle: DatabaseHandle;
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

/** Reads a `count(*)::int` result without asserting a shape onto the driver row. */
function countOf(rows: readonly Record<string, unknown>[]): number {
  return Number(rows[0]?.count ?? -1);
}

type RunningServer = Readonly<{ server: BootstrappedServer; url: string }>;

async function boot(): Promise<RunningServer> {
  const server = await bootstrapServer({ config: loadServerConfig(env) });
  servers.push(server);
  await server.app.listen({ host: "127.0.0.1", port: 0 });

  const address = server.app.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected a TCP address");
  }
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function registerAccount(
  server: BootstrappedServer,
  username: string,
): Promise<AuthResponse> {
  const response = await server.app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: { email: `${username}@example.com`, password: PASSWORD, username },
  });
  expect(response.statusCode).toBe(201);
  return authResponseSchema.parse(response.json());
}

async function signIn(server: BootstrappedServer, username: string): Promise<AuthResponse> {
  const response = await server.app.inject({
    method: "POST",
    url: "/v1/auth/sign-in",
    payload: { email: `${username}@example.com`, password: PASSWORD },
  });
  expect(response.statusCode).toBe(200);
  return authResponseSchema.parse(response.json());
}

async function createGuest(server: BootstrappedServer): Promise<CreateGuestResponse> {
  const response = await server.app.inject({ method: "POST", url: "/v1/guests", payload: {} });
  expect(response.statusCode).toBe(201);
  return response.json<CreateGuestResponse>();
}

type Seat = Readonly<{ actorType: "user" | "guest"; actorId: string; displayName: string }>;

function accountSeat(auth: AuthResponse): Seat {
  return { actorType: "user", actorId: auth.account.userId, displayName: auth.account.username };
}

function guestSeat(guest: CreateGuestResponse): Seat {
  return { actorType: "guest", actorId: guest.guestId, displayName: guest.displayName };
}

async function createMatch(
  server: BootstrappedServer,
  light: Seat,
  dark: Seat,
  mode: "casual" | "ranked" = "casual",
): Promise<{ status: number; matchId: string | null }> {
  const response = await server.app.inject({
    method: "POST",
    url: "/v1/dev/matches",
    payload: { mode, timeControlSeconds: 300, light, dark },
  });
  return {
    status: response.statusCode,
    matchId: response.statusCode === 201 ? response.json<{ matchId: string }>().matchId : null,
  };
}

async function join(url: string, sessionToken: string, matchId: string): Promise<TestClient> {
  const client = new TestClient(url);
  clients.push(client);
  await client.connect();

  const handshake = await client.emit<SessionAuthenticateAck>("session:authenticate", {
    clientVersion: CLIENT_VERSION,
    appEnv: "local",
    sessionToken,
  });
  expect(handshake.ok).toBe(true);
  const sync = await client.emit<MatchSyncAck>("match:sync", { matchId });
  if (!sync.ok) {
    throw new Error(`could not join the match: ${sync.reason}`);
  }
  client.drain("match:snapshot");
  return client;
}

describe("the delivered authentication method", () => {
  it("carries an account from sign-up through a completed match", async () => {
    const { server, url } = await boot();
    const registered = await registerAccount(server, "ada");
    const opponent = await registerAccount(server, "grace");

    // The session issued at sign-up is not the one that plays: signing out and
    // back in is the flow a returning player uses.
    const signedOut = await server.app.inject({
      method: "POST",
      url: "/v1/auth/sign-out",
      headers: { authorization: `Bearer ${registered.session.sessionToken}` },
    });
    expect(signedOut.statusCode).toBe(204);
    const returning = await signIn(server, "ada");

    const created = await createMatch(server, accountSeat(returning), accountSeat(opponent));
    expect(created.status).toBe(201);
    const matchId = created.matchId ?? "";
    const lightClient = await join(url, returning.session.sessionToken, matchId);
    const darkClient = await join(url, opponent.session.sessionToken, matchId);

    for (const [index] of WINNING_SCRIPT.entries()) {
      const client = index % 2 === 0 ? lightClient : darkClient;
      const ack = await client.emit<CommandAck>("match:move", {
        ...envelope(matchId, index),
        payload: { move: WINNING_SCRIPT[index] },
      });
      expect(ack.ok).toBe(true);
    }

    expect(matchEndedEventSchema.parse(await lightClient.next("match:ended"))).toMatchObject({
      result: "light",
      reason: "line",
    });
    const profile = await server.app.inject({ method: "GET", url: "/v1/profiles/ada" });
    expect(publicProfileSchema.parse(profile.json()).casual).toMatchObject({ wins: 1, played: 1 });
  });
});

describe("a guest claiming its play", () => {
  it("moves the guest's match to the new account", async () => {
    const { server, url } = await boot();
    const guest = await createGuest(server);
    const opponent = await createGuest(server);
    const created = await createMatch(server, guestSeat(guest), guestSeat(opponent));
    const matchId = created.matchId ?? "";
    const guestClient = await join(url, guest.sessionToken, matchId);
    await join(url, opponent.sessionToken, matchId);
    await guestClient.emit<CommandAck>("match:move", {
      ...envelope(matchId, 0),
      payload: { move: WINNING_SCRIPT[0] },
    });

    const claim = await server.app.inject({
      method: "POST",
      url: "/v1/guests/claim",
      headers: { authorization: `Bearer ${guest.sessionToken}` },
      payload: { email: "ada@example.com", password: PASSWORD, username: "ada" },
    });

    expect(claim.statusCode).toBe(201);
    const claimed = claim.json<ClaimGuestResponse>();
    expect(claimed.claimedMatches).toBe(1);
    const history = await server.app.inject({
      method: "GET",
      url: "/v1/me/matches",
      headers: { authorization: `Bearer ${claimed.session.sessionToken}` },
    });
    const matches = matchHistoryResponseSchema.parse(history.json()).matches;
    expect(matches.map((match) => match.matchId)).toEqual([matchId]);
    expect(matches[0]?.players.light).toMatchObject({
      actorId: claimed.account.userId,
      actorType: "user",
      displayName: guest.displayName,
    });
    // The claimed session token still belongs to the guest, which now points at
    // the account: the player is not thrown out of the match they were playing.
    const resumed = await join(url, guest.sessionToken, matchId);
    expect(resumed.seen("session:ready")).toHaveLength(1);
  });
});

describe("racing claims of one username", () => {
  it("creates exactly one account and refuses the rest", async () => {
    const { server } = await boot();

    const attempts = await Promise.all(
      [0, 1, 2, 3].map(async (index) =>
        server.app.inject({
          method: "POST",
          url: "/v1/auth/register",
          payload: { email: `player${index}@example.com`, password: PASSWORD, username: "ada" },
        }),
      ),
    );

    expect(attempts.filter((response) => response.statusCode === 201)).toHaveLength(1);
    expect(attempts.filter((response) => response.statusCode === 409)).toHaveLength(3);
    const rows = await handle.db.execute("select count(*)::int as count from users");
    expect(countOf(rows.rows)).toBe(1);
  });
});

describe("a suspended account", () => {
  it("cannot be seated in a match and cannot act in one it is already in", async () => {
    const { server, url } = await boot();
    const suspect = await registerAccount(server, "ada");
    const opponent = await registerAccount(server, "grace");
    const created = await createMatch(server, accountSeat(suspect), accountSeat(opponent));
    const matchId = created.matchId ?? "";
    const suspectClient = await join(url, suspect.session.sessionToken, matchId);

    await server.identity.suspend(suspect.account.userId, "abuse");

    const move = await suspectClient.emit<CommandAck>("match:move", {
      ...envelope(matchId, 0),
      payload: { move: WINNING_SCRIPT[0] },
    });
    expect(move).toMatchObject({ ok: false, reason: "not-authorized" });
    await suspectClient.waitForDisconnect();

    const reseated = await createMatch(server, accountSeat(suspect), accountSeat(opponent));
    expect(reseated.status).toBe(403);

    // The revoked session cannot be used to reach a match either.
    const rejoin = new TestClient(url);
    clients.push(rejoin);
    await rejoin.connect();
    const handshake = await rejoin.emit<SessionAuthenticateAck>("session:authenticate", {
      clientVersion: CLIENT_VERSION,
      appEnv: "local",
      sessionToken: suspect.session.sessionToken,
    });
    expect(handshake.ok).toBe(false);
  });
});
