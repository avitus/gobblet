import {
  CLIENT_TO_SERVER_EVENTS,
  SERVER_TO_CLIENT_EVENTS,
  commandAckSchema,
  fatalErrorSchema,
  matchClockSyncEventSchema,
  matchEndedEventSchema,
  matchFoundEventSchema,
  matchMoveCommittedEventSchema,
  matchSnapshotSchema,
  matchSyncAckSchema,
  queueJoinAckSchema,
  queueLeaveAckSchema,
  queueStatusSchema,
  recoverableErrorSchema,
  rematchAckSchema,
  rematchStatusEventSchema,
  sessionAuthenticateAckSchema,
  sessionReadySchema,
} from "@gobblet/protocol";
import type {
  AppEnvironment,
  CommandAck,
  FatalError,
  MatchClockSyncEvent,
  MatchEndedEvent,
  MatchFoundEvent,
  MatchMoveCommittedEvent,
  MatchSnapshot,
  MatchSyncAck,
  Move,
  QueueJoinAck,
  QueueKey,
  QueueLeaveAck,
  QueueStatus,
  RecoverableError,
  RematchAck,
  RematchStatusEvent,
  SessionReady,
} from "@gobblet/protocol";
import { io } from "socket.io-client";
import type { z } from "zod";

/**
 * The slice of a Socket.IO socket this client uses. Naming it keeps the transport
 * swappable in tests without a server, and documents that nothing else is used.
 */
export type SocketTransport = {
  connected: boolean;
  connect: () => void;
  disconnect: () => void;
  on: (event: string, listener: (...args: unknown[]) => void) => unknown;
  emit: (event: string, ...args: unknown[]) => unknown;
};

export type MatchSocketEvent =
  | Readonly<{ type: "session-ready"; payload: SessionReady }>
  | Readonly<{ type: "queue-status"; payload: QueueStatus }>
  | Readonly<{ type: "match-found"; payload: MatchFoundEvent }>
  | Readonly<{ type: "match-snapshot"; payload: MatchSnapshot }>
  | Readonly<{ type: "match-move-committed"; payload: MatchMoveCommittedEvent }>
  | Readonly<{ type: "match-clock-sync"; payload: MatchClockSyncEvent }>
  | Readonly<{ type: "match-ended"; payload: MatchEndedEvent }>
  | Readonly<{ type: "rematch-status"; payload: RematchStatusEvent }>
  | Readonly<{ type: "recoverable-error"; payload: RecoverableError }>
  | Readonly<{ type: "fatal-error"; payload: FatalError }>
  | Readonly<{ type: "connected" }>
  | Readonly<{ type: "reconnecting"; attempt: number }>
  | Readonly<{ type: "disconnected"; reason: string }>
  | Readonly<{ type: "invalid-payload"; event: string }>;

export type MatchSocketOptions = Readonly<{
  url: string;
  clientVersion: string;
  appEnv: AppEnvironment;
  sessionToken: () => string | null;
  transport?: SocketTransport;
  now?: () => number;
}>;

const IN = SERVER_TO_CLIENT_EVENTS;
const OUT = CLIENT_TO_SERVER_EVENTS;

type InboundParser = (raw: unknown) => MatchSocketEvent | null;

/**
 * Pairs each server event with its schema and the shape the client publishes. A
 * payload that does not validate produces `null`, which the caller reports rather
 * than passing on (docs/adr/0020).
 */
function inbound<TSchema extends z.ZodType>(
  schema: TSchema,
  type: MatchSocketEvent["type"],
): InboundParser {
  return (raw) => {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      return null;
    }
    return { type, payload: parsed.data } as MatchSocketEvent;
  };
}

const INBOUND: Readonly<Record<string, InboundParser>> = Object.freeze({
  [IN.sessionReady]: inbound(sessionReadySchema, "session-ready"),
  [IN.queueStatus]: inbound(queueStatusSchema, "queue-status"),
  [IN.matchFound]: inbound(matchFoundEventSchema, "match-found"),
  [IN.matchSnapshot]: inbound(matchSnapshotSchema, "match-snapshot"),
  [IN.matchMoveCommitted]: inbound(matchMoveCommittedEventSchema, "match-move-committed"),
  [IN.matchClockSync]: inbound(matchClockSyncEventSchema, "match-clock-sync"),
  [IN.matchEnded]: inbound(matchEndedEventSchema, "match-ended"),
  [IN.matchRematchStatus]: inbound(rematchStatusEventSchema, "rematch-status"),
  [IN.errorRecoverable]: inbound(recoverableErrorSchema, "recoverable-error"),
  [IN.errorFatal]: inbound(fatalErrorSchema, "fatal-error"),
});

export type MatchSocketListener = (event: MatchSocketEvent) => void;

/** Rejects an acknowledgement the client cannot trust, rather than coercing it. */
export class ProtocolViolationError extends Error {
  readonly event: string;

  constructor(event: string) {
    super(`The server answered ${event} with a payload the client cannot read`);
    this.name = "ProtocolViolationError";
    this.event = event;
  }
}

/**
 * The real-time client. It validates every inbound payload with the protocol
 * schema before publishing it, re-authenticates on every reconnect and never
 * interprets game rules (docs/adr/0020).
 */
export class MatchSocket {
  private readonly transport: SocketTransport;

  private readonly options: MatchSocketOptions;

  private readonly listeners = new Set<MatchSocketListener>();

  private handshake: Promise<SessionReady> | null = null;

  constructor(options: MatchSocketOptions) {
    this.options = options;
    this.transport =
      options.transport ??
      io(options.url, {
        autoConnect: false,
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionDelay: 500,
        reconnectionDelayMax: 8000,
        randomizationFactor: 0.4,
      });

    this.registerHandlers();
  }

  subscribe(listener: MatchSocketListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  connect(): void {
    if (!this.transport.connected) {
      this.transport.connect();
    }
  }

  isConnected(): boolean {
    return this.transport.connected;
  }

  close(): void {
    this.handshake = null;
    this.transport.disconnect();
  }

  /**
   * Authenticates the socket, reusing an in-flight handshake so two views cannot
   * race two handshakes on the same connection.
   */
  authenticate(): Promise<SessionReady> {
    this.handshake ??= this.request(
      OUT.sessionAuthenticate,
      {
        clientVersion: this.options.clientVersion,
        appEnv: this.options.appEnv,
        ...(this.options.sessionToken() === null
          ? {}
          : { sessionToken: this.options.sessionToken() }),
      },
      sessionAuthenticateAckSchema,
    ).then((ack) => {
      if (!ack.ok) {
        this.handshake = null;
        throw new HandshakeRejectedError(ack.error);
      }
      return ack.session;
    });

    return this.handshake;
  }

  joinQueue(key: QueueKey): Promise<QueueJoinAck> {
    return this.request(OUT.queueJoin, key, queueJoinAckSchema);
  }

  leaveQueue(): Promise<QueueLeaveAck> {
    return this.request(OUT.queueLeave, {}, queueLeaveAckSchema);
  }

  sync(matchId: string): Promise<MatchSyncAck> {
    return this.request(OUT.matchSync, { matchId }, matchSyncAckSchema);
  }

  requestRematch(matchId: string): Promise<RematchAck> {
    return this.request(OUT.matchRematchRequest, { matchId }, rematchAckSchema);
  }

  respondToRematch(matchId: string, accept: boolean): Promise<RematchAck> {
    return this.request(OUT.matchRematchRespond, { matchId, accept }, rematchAckSchema);
  }

  submitMove(
    envelope: Readonly<{ commandId: string; matchId: string; expectedVersion: number; move: Move }>,
  ): Promise<CommandAck> {
    return this.request(
      OUT.matchMove,
      {
        commandId: envelope.commandId,
        matchId: envelope.matchId,
        expectedVersion: envelope.expectedVersion,
        sentAtClient: this.clock(),
        payload: { move: envelope.move },
      },
      commandAckSchema,
    );
  }

  resign(
    envelope: Readonly<{ commandId: string; matchId: string; expectedVersion: number }>,
  ): Promise<CommandAck> {
    return this.request(
      OUT.matchResign,
      {
        commandId: envelope.commandId,
        matchId: envelope.matchId,
        expectedVersion: envelope.expectedVersion,
        sentAtClient: this.clock(),
        payload: {},
      },
      commandAckSchema,
    );
  }

  private clock(): number {
    return (this.options.now ?? Date.now)();
  }

  private request<TSchema extends z.ZodType>(
    event: string,
    payload: unknown,
    schema: TSchema,
  ): Promise<z.output<TSchema>> {
    return new Promise((resolve, reject) => {
      this.transport.emit(event, payload, (raw: unknown) => {
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
          this.publish({ type: "invalid-payload", event });
          reject(new ProtocolViolationError(event));
          return;
        }
        resolve(parsed.data);
      });
    });
  }

  private registerHandlers(): void {
    for (const [event, parse] of Object.entries(INBOUND)) {
      this.transport.on(event, (...args: unknown[]) => {
        const parsed = parse(args[0]);
        if (!parsed) {
          this.publish({ type: "invalid-payload", event });
          return;
        }
        this.publish(parsed);
      });
    }

    this.transport.on("connect", () => {
      this.handshake = null;
      this.publish({ type: "connected" });
    });

    this.transport.on("disconnect", (...args: unknown[]) => {
      this.handshake = null;
      const [reason] = args;
      this.publish({
        type: "disconnected",
        reason: typeof reason === "string" ? reason : "unknown",
      });
    });

    this.transport.on("reconnect_attempt", (...args: unknown[]) => {
      const [attempt] = args;
      this.publish({ type: "reconnecting", attempt: typeof attempt === "number" ? attempt : 0 });
    });
  }

  private publish(event: MatchSocketEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

/** A refused handshake is fatal: the client must act on it, not retry it. */
export class HandshakeRejectedError extends Error {
  readonly detail: FatalError;

  constructor(detail: FatalError) {
    super(detail.message);
    this.name = "HandshakeRejectedError";
    this.detail = detail;
  }
}
