import { loadServerConfig } from "@gobblet/config";
import { listMatchEvents } from "@gobblet/db";
import type { DatabaseHandle } from "@gobblet/db";
import { matchEndedEventSchema, matchSnapshotSchema } from "@gobblet/protocol";
import type {
  CommandAck,
  CreateGuestResponse,
  MatchSnapshot,
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
 * The Phase 2 exit criteria of spec section 20.5, proved end to end against a
 * real database and real sockets: a full match through the server, a restart in
 * the middle of a match, duplicate commands, and a terminal outcome that is
 * committed exactly once.
 */

const env = {
  APP_ENV: "local" as const,
  APP_VERSION: "9.9.9",
  GIT_SHA: "testsha",
  LOG_LEVEL: "fatal" as const,
  DATABASE_URL: TEST_DATABASE_URL,
};

const CLIENT_VERSION = "0.1.0";

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

async function createGuest(server: BootstrappedServer): Promise<CreateGuestResponse> {
  const response = await server.app.inject({ method: "POST", url: "/v1/guests", payload: {} });
  expect(response.statusCode).toBe(201);
  return response.json<CreateGuestResponse>();
}

async function createMatch(
  server: BootstrappedServer,
  light: CreateGuestResponse,
  dark: CreateGuestResponse,
): Promise<string> {
  const response = await server.app.inject({
    method: "POST",
    url: "/v1/dev/matches",
    payload: {
      mode: "casual",
      timeControlSeconds: 300,
      light: { actorType: "guest", actorId: light.guestId, displayName: light.displayName },
      dark: { actorType: "guest", actorId: dark.guestId, displayName: dark.displayName },
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ matchId: string }>().matchId;
}

/** Connects, authenticates with a persisted guest token and joins the match room. */
async function join(
  url: string,
  guest: CreateGuestResponse,
  matchId: string,
): Promise<{ client: TestClient; snapshot: MatchSnapshot }> {
  const client = new TestClient(url);
  clients.push(client);
  await client.connect();

  const handshake = await client.emit<SessionAuthenticateAck>("session:authenticate", {
    clientVersion: CLIENT_VERSION,
    appEnv: "local",
    sessionToken: guest.sessionToken,
  });
  expect(handshake.ok).toBe(true);

  const sync = await client.emit<MatchSyncAck>("match:sync", { matchId });
  if (!sync.ok) {
    throw new Error(`could not join the match: ${sync.reason}`);
  }
  client.drain("match:snapshot");
  return { client, snapshot: matchSnapshotSchema.parse(sync.snapshot) };
}

async function play(
  client: TestClient,
  matchId: string,
  moveIndex: number,
  expectedVersion: number,
): Promise<CommandAck> {
  return client.emit<CommandAck>("match:move", {
    ...envelope(matchId, expectedVersion),
    payload: { move: WINNING_SCRIPT[moveIndex] },
  });
}

describe("two clients complete a match through the server", () => {
  it("commits every move and the terminal outcome once", async () => {
    const { server, url } = await boot();
    const light = await createGuest(server);
    const dark = await createGuest(server);
    const matchId = await createMatch(server, light, dark);
    const lightSeat = await join(url, light, matchId);
    const darkSeat = await join(url, dark, matchId);

    for (const [index] of WINNING_SCRIPT.entries()) {
      const seat = index % 2 === 0 ? lightSeat : darkSeat;
      const ack = await play(seat.client, matchId, index, index);
      expect(ack.ok).toBe(true);
    }

    const ended = matchEndedEventSchema.parse(await lightSeat.client.next("match:ended"));
    expect(ended).toMatchObject({ result: "light", reason: "line" });

    const events = await listMatchEvents(handle.db, matchId);
    expect(events.map((event) => event.type)).toEqual([
      "match-created",
      ...WINNING_SCRIPT.map(() => "move"),
    ]);
    expect(events.map((event) => event.sequence)).toEqual(events.map((_event, index) => index));
    expect(darkSeat.client.seen("match:ended")).toHaveLength(1);
  });
});

describe("a restart in the middle of a match", () => {
  it("recovers the state, the clocks and the guest sessions", async () => {
    const first = await boot();
    const light = await createGuest(first.server);
    const dark = await createGuest(first.server);
    const matchId = await createMatch(first.server, light, dark);
    const lightSeat = await join(first.url, light, matchId);
    const darkSeat = await join(first.url, dark, matchId);
    await play(lightSeat.client, matchId, 0, 0);
    await play(darkSeat.client, matchId, 1, 1);
    const before = matchSnapshotSchema.parse(
      (
        (await lightSeat.client.emit<MatchSyncAck>("match:sync", { matchId })) as {
          ok: true;
          snapshot: MatchSnapshot;
        }
      ).snapshot,
    );

    await first.server.close();
    servers = servers.filter((server) => server !== first.server);
    await lightSeat.client.waitForDisconnect();

    // A different process, the same database and the same guest tokens.
    const second = await boot();
    expect(second.server.settledOnBoot).toBe(0);
    const resumedLight = await join(second.url, light, matchId);
    const resumedDark = await join(second.url, dark, matchId);

    expect(resumedLight.snapshot.version).toBe(2);
    expect(resumedLight.snapshot.status).toBe("active");
    expect(resumedLight.snapshot.state).toEqual(before.state);
    expect(resumedLight.snapshot.lastMove).toEqual(before.lastMove);
    expect(resumedLight.snapshot.players.light.actorId).toBe(light.guestId);
    expect(resumedDark.snapshot.players.dark.actorId).toBe(dark.guestId);
    // Both sides moved once, so both clocks were charged and both survived the restart.
    expect(resumedLight.snapshot.clocks.lightRemainingMs).toBe(before.clocks.lightRemainingMs);
    expect(resumedLight.snapshot.clocks.darkRemainingMs).toBe(before.clocks.darkRemainingMs);
    expect(resumedLight.snapshot.clocks.lightRemainingMs).toBeLessThan(300_000);
    expect(resumedLight.snapshot.clocks.darkRemainingMs).toBeLessThan(300_000);
    expect(resumedLight.snapshot.clocks.turnStartedAt).toBe(before.clocks.turnStartedAt);

    for (let index = 2; index < WINNING_SCRIPT.length; index += 1) {
      const seat = index % 2 === 0 ? resumedLight : resumedDark;
      expect((await play(seat.client, matchId, index, index)).ok).toBe(true);
    }

    expect(matchEndedEventSchema.parse(await resumedDark.client.next("match:ended"))).toMatchObject(
      { result: "light", reason: "line" },
    );
  });
});

describe("duplicate and racing commands", () => {
  it("applies one move when the same command arrives twice at once", async () => {
    const { server, url } = await boot();
    const light = await createGuest(server);
    const dark = await createGuest(server);
    const matchId = await createMatch(server, light, dark);
    const lightSeat = await join(url, light, matchId);
    await join(url, dark, matchId);
    const command = { ...envelope(matchId, 0), payload: { move: WINNING_SCRIPT[0] } };

    const acks = await Promise.all([
      lightSeat.client.emit<CommandAck>("match:move", command),
      lightSeat.client.emit<CommandAck>("match:move", command),
    ]);

    expect(acks.filter((ack) => ack.ok)).toHaveLength(1);
    expect(acks.filter((ack) => !ack.ok && ack.reason === "duplicate-command")).toHaveLength(1);
    const events = await listMatchEvents(handle.db, matchId);
    expect(events.filter((event) => event.type === "move")).toHaveLength(1);
  });

  it("accepts one of two different commands that claim the same version", async () => {
    const { server, url } = await boot();
    const light = await createGuest(server);
    const dark = await createGuest(server);
    const matchId = await createMatch(server, light, dark);
    const lightSeat = await join(url, light, matchId);
    await join(url, dark, matchId);

    const acks = await Promise.all([
      play(lightSeat.client, matchId, 0, 0),
      play(lightSeat.client, matchId, 2, 0),
    ]);

    expect(acks.filter((ack) => ack.ok)).toHaveLength(1);
    expect(acks.filter((ack) => !ack.ok && ack.reason === "stale-version")).toHaveLength(1);
    const events = await listMatchEvents(handle.db, matchId);
    expect(events.filter((event) => event.type === "move")).toHaveLength(1);
  });
});

describe("the terminal outcome", () => {
  it("is committed once and refuses every later command", async () => {
    const { server, url } = await boot();
    const light = await createGuest(server);
    const dark = await createGuest(server);
    const matchId = await createMatch(server, light, dark);
    const lightSeat = await join(url, light, matchId);
    const darkSeat = await join(url, dark, matchId);
    const resign = { ...envelope(matchId, 0), payload: {} };

    const first = await darkSeat.client.emit<CommandAck>("match:resign", resign);
    const retried = await darkSeat.client.emit<CommandAck>("match:resign", resign);
    const again = await darkSeat.client.emit<CommandAck>("match:resign", {
      ...envelope(matchId, 1),
      payload: {},
    });
    const move = await play(lightSeat.client, matchId, 0, 1);

    expect(first).toMatchObject({ ok: true, newVersion: 1 });
    expect(retried).toMatchObject({ ok: false, reason: "duplicate-command" });
    expect(again).toMatchObject({ ok: false, reason: "match-ended" });
    expect(move).toMatchObject({ ok: false, reason: "match-ended" });

    const events = await listMatchEvents(handle.db, matchId);
    expect(events.filter((event) => event.type === "resignation")).toHaveLength(1);
    expect(lightSeat.client.seen("match:ended")).toHaveLength(1);

    const summary = await server.runtime.getSummaryForActor(matchId, {
      actorType: "guest",
      actorId: light.guestId,
    });
    expect(summary).toMatchObject({
      status: "completed",
      result: { outcome: "light", reason: "resignation" },
    });
  });
});
