import { loadServerConfig } from "@gobblet/config";
import { findMatchById, listAchievementProgress, listMatchEvents, upsertRating } from "@gobblet/db";
import type { DatabaseHandle } from "@gobblet/db";
import {
  LEADERBOARD_PERIODS,
  achievementsResponseSchema,
  authResponseSchema,
  decodeLeaderboardCursor,
  leaderboardResponseSchema,
  matchEndedEventSchema,
  matchFoundEventSchema,
  matchSummarySchema,
  presetMessageEventSchema,
  queueJoinAckSchema,
  reactionEventSchema,
} from "@gobblet/protocol";
import type {
  AuthResponse,
  CommandAck,
  CommunicationAck,
  MatchFoundEvent,
  MatchSnapshot,
  QueueJoinAck,
  SessionAuthenticateAck,
} from "@gobblet/protocol";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { awardAchievementsForCompletion } from "../src/achievements/service";
import { bootstrapServer } from "../src/bootstrap";
import type { BootstrappedServer } from "../src/bootstrap";
import { TestClock, WINNING_SCRIPT, envelope } from "./helpers/match-fixtures";
import { TestClient } from "./helpers/socket-client";
import { TEST_DATABASE_URL, setupTestDatabase, truncateAll } from "./helpers/test-database";

/**
 * The Phase 6 exit criteria of spec section 20.7, proved against a real database and
 * real sockets: communication is relayed and respects a mute, an achievement is
 * awarded once however often the evaluation runs, a board read while ratings move
 * describes one consistent order, and no endpoint hands a player a replay.
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
  const server = await bootstrapServer({ config: loadServerConfig(env), now: clock.now });
  servers.push(server);
  await server.app.listen({ host: "127.0.0.1", port: 0 });

  const address = server.app.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected a TCP address");
  }
  return { server, url: `http://127.0.0.1:${address.port}` };
}

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

type Seated = Readonly<{
  matchId: string;
  lightClient: TestClient;
  darkClient: TestClient;
  light: AuthResponse;
  dark: AuthResponse;
}>;

/** Two verified accounts paired in a ranked queue, seats read back from the server. */
async function rankedPair(running: RunningServer): Promise<Seated> {
  const ada = await verifiedAccount(running.server, "ada");
  const grace = await verifiedAccount(running.server, "grace");
  const adaClient = await connected(running.url, ada.session.sessionToken);
  const graceClient = await connected(running.url, grace.session.sessionToken);

  expect(
    queueJoinAckSchema.parse(await adaClient.emit<QueueJoinAck>("queue:join", RANKED)).state,
  ).toBe("queued");
  const matched = queueJoinAckSchema.parse(
    await graceClient.emit<QueueJoinAck>("queue:join", RANKED),
  );
  if (matched.state !== "matched") {
    throw new Error(`expected the second account to be seated, got ${matched.state}`);
  }
  const found: MatchFoundEvent = matchFoundEventSchema.parse(await adaClient.next("match:found"));
  matchFoundEventSchema.parse(await graceClient.next("match:found"));

  const adaIsLight = found.yourColor === "light";
  return {
    matchId: matched.matchId,
    lightClient: adaIsLight ? adaClient : graceClient,
    darkClient: adaIsLight ? graceClient : adaClient,
    light: adaIsLight ? ada : grace,
    dark: adaIsLight ? grace : ada,
  };
}

async function playToLightWin(seated: Seated): Promise<void> {
  for (const [index, move] of WINNING_SCRIPT.entries()) {
    const client = index % 2 === 0 ? seated.lightClient : seated.darkClient;
    const ack = await client.emit<CommandAck>("match:move", {
      ...envelope(seated.matchId, index),
      payload: { move },
    });
    expect(ack).toMatchObject({ ok: true });
  }
  matchEndedEventSchema.parse(await seated.lightClient.next("match:ended"));
}

/** Nothing arrives, proved by a short wait that is expected to time out. */
async function receivesNothing(client: TestClient, event: string): Promise<void> {
  await expect(client.next(event, 150)).rejects.toThrow(/timed out/);
}

describe("communication works and respects mute", () => {
  it("relays both channels, withholds the muted one and keeps no record of either", async () => {
    const running = await boot();
    const seated = await rankedPair(running);

    await seated.lightClient.emit<CommunicationAck>("match:preset-message", {
      matchId: seated.matchId,
      messageKey: "good-luck",
    });
    expect(
      presetMessageEventSchema.parse(await seated.darkClient.next("match:preset-message")),
    ).toMatchObject({ from: "light", messageKey: "good-luck" });
    expect(
      presetMessageEventSchema.parse(await seated.lightClient.next("match:preset-message"))
        .messageKey,
    ).toBe("good-luck");

    expect(
      await seated.darkClient.emit<CommunicationAck>("match:mute-state", {
        matchId: seated.matchId,
        presetMessagesMuted: true,
        reactionsMuted: false,
      }),
    ).toEqual({ ok: true });

    await seated.lightClient.emit<CommunicationAck>("match:preset-message", {
      matchId: seated.matchId,
      messageKey: "nice-move",
    });
    await seated.lightClient.emit<CommunicationAck>("match:reaction", {
      matchId: seated.matchId,
      reactionKey: "applause",
    });

    // The phrase is withheld while the reaction, muted separately, still arrives.
    await receivesNothing(seated.darkClient, "match:preset-message");
    expect(reactionEventSchema.parse(await seated.darkClient.next("match:reaction"))).toMatchObject(
      { from: "light", reactionKey: "applause" },
    );
    // The sender always hears their own, whatever the recipient asked for.
    expect(
      presetMessageEventSchema.parse(await seated.lightClient.next("match:preset-message"))
        .messageKey,
    ).toBe("nice-move");

    // Nothing said is stored: the match wrote only its own creation, and no row
    // anywhere mentions a phrase or a reaction (ADR-0026).
    const events = await listMatchEvents(handle.db, seated.matchId);
    expect(events.map((event) => event.type)).toEqual(["match-created"]);
    expect(JSON.stringify(events)).not.toMatch(/good-luck|nice-move|applause/);
  });
});

describe("achievement evaluation is idempotent", () => {
  it("awards the first victory once, however often the evaluation runs", async () => {
    const running = await boot();
    const seated = await rankedPair(running);
    await playToLightWin(seated);

    const winner = seated.light.account.userId;
    const awarded = await listAchievementProgress(handle.db, winner);
    const earned = awarded.filter((row) => row.earnedAt !== null);
    expect(earned.map((row) => row.code)).toEqual(["first-victory"]);
    const earnedAt = earned[0]?.earnedAt;

    const row = await findMatchById(handle.db, seated.matchId);
    if (row === undefined || row === null) {
      throw new Error("expected the completed match to be stored");
    }
    // The same completion, evaluated twice more: the codes are already held, so
    // nothing is written and the first award keeps its timestamp (ADR-0027).
    expect(await awardAchievementsForCompletion(handle.db, row)).toEqual({
      light: [],
      dark: [],
    });
    expect(await awardAchievementsForCompletion(handle.db, row)).toEqual({
      light: [],
      dark: [],
    });

    const after = await listAchievementProgress(handle.db, winner);
    expect(after.filter((entry) => entry.earnedAt !== null).map((entry) => entry.code)).toEqual([
      "first-victory",
    ]);
    expect(after.find((entry) => entry.code === "first-victory")?.earnedAt).toEqual(earnedAt);

    const response = await running.server.app.inject({
      method: "GET",
      url: "/v1/me/achievements",
      headers: { authorization: `Bearer ${seated.light.session.sessionToken}` },
    });
    const progress = achievementsResponseSchema.parse(response.json());
    expect(progress.achievements.filter((entry) => entry.earnedAt !== null)).toHaveLength(1);
  });
});

describe("leaderboards are correct under concurrent rating updates", () => {
  it("answers every read with one order, and pages it without a gap or a repeat", async () => {
    const running = await boot();
    const accounts = await Promise.all(
      Array.from({ length: 8 }, (_, index) => verifiedAccount(running.server, `player${index}`)),
    );

    // Every rating moves at once while the board is being read, which is the
    // interleaving a live board has to survive (ADR-0028).
    const reads = Array.from({ length: 4 }, () =>
      running.server.leaderboards.read({ period: "all-time" }),
    );
    const writes = accounts.map((account, index) =>
      upsertRating(handle.db, account.account.userId, {
        rating: 1300 - index * 10,
        gamesPlayed: 10,
        wins: 8 - index,
        losses: index,
        draws: 0,
        currentStreak: 0,
        bestStreak: 3,
      }),
    );
    const [boards] = await Promise.all([Promise.all(reads), Promise.all(writes)]);

    for (const board of boards) {
      expectConsistent(board.entries);
    }

    // Read again once the writes have settled: the order is the ratings' order.
    const settled = await running.server.leaderboards.read({ period: "all-time" });
    expectConsistent(settled.entries);
    expect(settled.entries.map((entry) => entry.username)).toEqual(
      accounts.map((account) => account.account.username),
    );

    // The same board, paged three at a time, is the same list without a gap.
    const paged: string[] = [];
    let cursor: string | null = null;
    do {
      const page: Awaited<ReturnType<typeof running.server.leaderboards.read>> =
        await running.server.leaderboards.read({
          period: "all-time",
          limit: 3,
          ...(cursor === null ? {} : { cursor: decodeLeaderboardCursor(cursor) }),
        });
      expectConsistent(page.entries);
      paged.push(...page.entries.map((entry) => entry.username));
      cursor = page.nextCursor;
    } while (cursor !== null);
    expect(paged).toEqual(settled.entries.map((entry) => entry.username));

    // Every period reads the same way, and the ranks in each are its own.
    for (const period of LEADERBOARD_PERIODS) {
      const board = leaderboardResponseSchema.parse(
        (
          await running.server.app.inject({
            method: "GET",
            url: `/v1/leaderboards?period=${period}`,
          })
        ).json(),
      );
      expect(board.period).toBe(period);
      expectConsistent(board.entries);
    }
  });
});

describe("no match replay is exposed to players", () => {
  it("hands a player a summary and a final position, and no list of moves", async () => {
    const running = await boot();
    const seated = await rankedPair(running);
    await playToLightWin(seated);
    const authorization = { authorization: `Bearer ${seated.light.session.sessionToken}` };

    const summary = await running.server.app.inject({
      method: "GET",
      url: `/v1/matches/${seated.matchId}`,
      headers: authorization,
    });
    const parsed = matchSummarySchema.parse(summary.json());
    expect(parsed).toMatchObject({ status: "completed", moveCount: WINNING_SCRIPT.length });
    expect(Object.keys(parsed)).not.toContain("moves");
    expect(JSON.stringify(summary.json())).not.toContain("from");

    const snapshot = await running.server.app.inject({
      method: "GET",
      url: `/v1/matches/${seated.matchId}/snapshot`,
      headers: authorization,
    });
    // A snapshot is one position, not a history: it carries no move list at all.
    expect(Object.keys(snapshot.json<MatchSnapshot>())).not.toContain("moves");

    // No endpoint offers the events the server stored for its own reckoning.
    for (const url of [
      `/v1/matches/${seated.matchId}/events`,
      `/v1/matches/${seated.matchId}/moves`,
      `/v1/matches/${seated.matchId}/replay`,
    ]) {
      expect(
        (await running.server.app.inject({ method: "GET", url, headers: authorization }))
          .statusCode,
      ).toBe(404);
    }

    // The socket has no such event either: asking for one is answered by nothing.
    await receivesNothing(seated.lightClient, "match:events");
  });
});

/** A page is consistent when its ranks ascend by one and its ratings never rise. */
function expectConsistent(
  entries: readonly Readonly<{ rank: number; rating: number; username: string }>[],
): void {
  const ranks = entries.map((entry) => entry.rank);
  expect(ranks).toEqual([...ranks].sort((left, right) => left - right));
  expect(new Set(ranks).size).toBe(ranks.length);
  expect(new Set(entries.map((entry) => entry.username)).size).toBe(entries.length);
  for (const [index, entry] of entries.entries()) {
    const previous = entries[index - 1];
    if (previous !== undefined) {
      expect(entry.rating).toBeLessThanOrEqual(previous.rating);
      expect(entry.rank).toBe(previous.rank + 1);
    }
  }
}
