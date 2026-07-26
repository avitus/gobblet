import { describe, expect, it } from "vitest";
import { HandshakeRejectedError, MatchSocket, ProtocolViolationError } from "../src/match/socket";
import type { MatchSocketEvent } from "../src/match/socket";
import { LIGHT_ACTOR_ID, MATCH_ID, SERVER_TIME, makeSnapshot } from "./helpers/match";
import { FakeTransport } from "./helpers/transport";

const READY = {
  actorId: LIGHT_ACTOR_ID,
  actorType: "user",
  displayName: "ada",
  isGuest: false,
  serverTime: SERVER_TIME,
  features: [],
};

function connect(token: string | null = "session-token") {
  const transport = new FakeTransport();
  const events: MatchSocketEvent[] = [];
  const socket = new MatchSocket({
    url: "http://localhost:4000",
    clientVersion: "1.0.0",
    appEnv: "local",
    sessionToken: () => token,
    transport,
    now: () => SERVER_TIME,
  });
  socket.subscribe((event) => events.push(event));
  return { transport, socket, events };
}

describe("MatchSocket", () => {
  it("authenticates with the session it was given and reuses one handshake", async () => {
    const { transport, socket } = connect();

    socket.connect();
    const first = socket.authenticate();
    const second = socket.authenticate();
    transport.answer("session:authenticate", { ok: true, session: READY });

    expect(await first).toEqual(READY);
    expect(await second).toEqual(READY);
    expect(transport.payloadsFor("session:authenticate")).toEqual([
      { clientVersion: "1.0.0", appEnv: "local", sessionToken: "session-token" },
    ]);
  });

  it("omits the token when there is no session", async () => {
    const { transport, socket } = connect(null);

    const handshake = socket.authenticate();
    transport.answer("session:authenticate", { ok: true, session: READY });
    await handshake;

    expect(transport.payloadsFor("session:authenticate")).toEqual([
      { clientVersion: "1.0.0", appEnv: "local" },
    ]);
  });

  it("reports a refused handshake as a fatal answer the player must act on", async () => {
    const { transport, socket } = connect();

    const handshake = socket.authenticate();
    transport.answer("session:authenticate", {
      ok: false,
      error: { code: "unsupported_client", message: "Too old", action: "update-client" },
    });

    await expect(handshake).rejects.toBeInstanceOf(HandshakeRejectedError);
    const retry = socket.authenticate();
    transport.answer("session:authenticate", { ok: true, session: READY });
    await expect(retry).resolves.toEqual(READY);
  });

  it("refuses an acknowledgement the protocol does not allow", async () => {
    const { transport, socket, events } = connect();

    const sync = socket.sync(MATCH_ID);
    transport.answer("match:sync", { ok: true });

    await expect(sync).rejects.toBeInstanceOf(ProtocolViolationError);
    expect(events).toEqual([{ type: "invalid-payload", event: "match:sync" }]);
  });

  it("publishes every validated server event", () => {
    const { transport, events } = connect();
    const snapshot = makeSnapshot();

    transport.fire("session:ready", READY);
    transport.fire("queue:status", {
      mode: "casual",
      timeControlSeconds: 300,
      rating: 1200,
      waitingMs: 1200,
      ratingWindow: null,
      depth: 2,
      serverTime: SERVER_TIME,
    });
    transport.fire("match:found", {
      matchId: MATCH_ID,
      mode: "casual",
      timeControlSeconds: 300,
      yourColor: "light",
      opponent: { actorType: "guest", displayName: "Guest 1234", rating: null },
      waitedMs: 900,
      snapshot,
    });
    transport.fire("match:snapshot", snapshot);
    transport.fire("match:clock-sync", {
      matchId: MATCH_ID,
      version: 0,
      activePlayer: "light",
      lightRemainingMs: 299_000,
      darkRemainingMs: 300_000,
      serverTime: SERVER_TIME + 1000,
    });
    transport.fire("match:ended", {
      matchId: MATCH_ID,
      version: 1,
      result: "light",
      reason: "resignation",
    });
    transport.fire("match:rematch-status", {
      matchId: MATCH_ID,
      state: "offered",
      requestedBy: LIGHT_ACTOR_ID,
      expiresAt: SERVER_TIME + 30_000,
      nextMatchId: null,
    });
    transport.fire("error:recoverable", {
      code: "validation_failed",
      message: "no",
      retryable: true,
    });
    transport.fire("error:fatal", {
      code: "account_suspended",
      message: "suspended",
      action: "contact-support",
    });

    expect(events.map((event) => event.type)).toEqual([
      "session-ready",
      "queue-status",
      "match-found",
      "match-snapshot",
      "match-clock-sync",
      "match-ended",
      "rematch-status",
      "recoverable-error",
      "fatal-error",
    ]);
  });

  it("discards an event it cannot validate instead of guessing", () => {
    const { transport, events } = connect();

    transport.fire("match:snapshot", { matchId: MATCH_ID });

    expect(events).toEqual([{ type: "invalid-payload", event: "match:snapshot" }]);
  });

  it("announces the transport's own lifecycle", () => {
    const { transport, socket, events } = connect();

    socket.connect();
    socket.connect();
    transport.fire("reconnect_attempt", 2);
    socket.close();

    expect(events).toEqual([
      { type: "connected" },
      { type: "reconnecting", attempt: 2 },
      { type: "disconnected", reason: "io client disconnect" },
    ]);
  });

  it("names a lifecycle the transport described poorly", () => {
    const { transport, events } = connect();

    transport.fire("disconnect");
    transport.fire("reconnect_attempt");

    expect(events).toEqual([
      { type: "disconnected", reason: "unknown" },
      { type: "reconnecting", attempt: 0 },
    ]);
  });

  it("stops publishing to a listener that unsubscribed", () => {
    const { transport, socket } = connect();
    const seen: MatchSocketEvent[] = [];
    const unsubscribe = socket.subscribe((event) => seen.push(event));

    unsubscribe();
    transport.fire("session:ready", READY);

    expect(seen).toEqual([]);
  });

  it("sends the queue, rematch and command envelopes the protocol defines", async () => {
    const { transport, socket } = connect();

    const joined = socket.joinQueue({ mode: "ranked", timeControlSeconds: 600 });
    transport.answer("queue:join", {
      state: "queued",
      status: {
        mode: "ranked",
        timeControlSeconds: 600,
        rating: 1200,
        waitingMs: 0,
        ratingWindow: { minimum: 1150, maximum: 1250 },
        depth: 1,
        serverTime: SERVER_TIME,
      },
    });
    expect((await joined).state).toBe("queued");

    const left = socket.leaveQueue();
    transport.answer("queue:leave", { ok: true });
    expect(await left).toEqual({ ok: true });

    const requested = socket.requestRematch(MATCH_ID);
    transport.answer("match:rematch-request", {
      ok: true,
      status: {
        matchId: MATCH_ID,
        state: "offered",
        requestedBy: LIGHT_ACTOR_ID,
        expiresAt: SERVER_TIME + 30_000,
        nextMatchId: null,
      },
    });
    expect((await requested).ok).toBe(true);

    const answered = socket.respondToRematch(MATCH_ID, false);
    transport.answer("match:rematch-respond", { ok: false, reason: "no-offer" });
    expect(await answered).toEqual({ ok: false, reason: "no-offer" });

    const move = socket.submitMove({
      commandId: "44444444-4444-4444-8444-444444444444",
      matchId: MATCH_ID,
      expectedVersion: 0,
      move: { kind: "reserve", reserveStack: 0, to: "r1c1" },
    });
    transport.answer("match:move", {
      ok: true,
      commandId: "44444444-4444-4444-8444-444444444444",
      newVersion: 1,
    });
    expect(await move).toEqual({
      ok: true,
      commandId: "44444444-4444-4444-8444-444444444444",
      newVersion: 1,
    });
    expect(transport.payloadsFor("match:move")).toEqual([
      {
        commandId: "44444444-4444-4444-8444-444444444444",
        matchId: MATCH_ID,
        expectedVersion: 0,
        sentAtClient: SERVER_TIME,
        payload: { move: { kind: "reserve", reserveStack: 0, to: "r1c1" } },
      },
    ]);

    const resigned = socket.resign({
      commandId: "55555555-5555-4555-8555-555555555555",
      matchId: MATCH_ID,
      expectedVersion: 3,
    });
    transport.answer("match:resign", {
      ok: true,
      commandId: "55555555-5555-4555-8555-555555555555",
      newVersion: 4,
    });
    expect((await resigned).ok).toBe(true);
    expect(transport.payloadsFor("match:resign")).toEqual([
      {
        commandId: "55555555-5555-4555-8555-555555555555",
        matchId: MATCH_ID,
        expectedVersion: 3,
        sentAtClient: SERVER_TIME,
        payload: {},
      },
    ]);
  });

  it("reads the clock through the injected source and defaults to the wall clock", async () => {
    const transport = new FakeTransport();
    const socket = new MatchSocket({
      url: "http://localhost:4000",
      clientVersion: "1.0.0",
      appEnv: "local",
      sessionToken: () => null,
      transport,
    });

    const move = socket.submitMove({
      commandId: "44444444-4444-4444-8444-444444444444",
      matchId: MATCH_ID,
      expectedVersion: 0,
      move: { kind: "reserve", reserveStack: 0, to: "r1c1" },
    });
    transport.answer("match:move", {
      ok: true,
      commandId: "44444444-4444-4444-8444-444444444444",
      newVersion: 1,
    });
    await move;

    const [payload] = transport.payloadsFor("match:move") as [{ sentAtClient: number }];
    expect(payload.sentAtClient).toBeGreaterThan(1_700_000_000_000);
  });
});
