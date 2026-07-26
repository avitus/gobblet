import type { Server as HttpServer } from "node:http";
import type { ServerConfig } from "@gobblet/config";
import type { Player } from "@gobblet/game-core";
import {
  CLIENT_TO_SERVER_EVENTS,
  SERVER_TO_CLIENT_EVENTS,
  commandEnvelopeHeaderSchema,
  httpErrorDetails,
  matchMoveCommandSchema,
  matchResignCommandSchema,
  matchSyncRequestSchema,
  muteStateRequestSchema,
  presetMessageRequestSchema,
  queueJoinRequestSchema,
  queueLeaveRequestSchema,
  reactionRequestSchema,
  rematchRequestSchema,
  rematchRespondSchema,
  sessionAuthenticateSchema,
} from "@gobblet/protocol";
import type {
  CommandAck,
  CommunicationAck,
  FatalError,
  MatchSnapshot,
  MatchSyncAck,
  QueueJoinAck,
  QueueLeaveAck,
  RecoverableError,
  RematchAck,
  SessionAuthenticateAck,
  SessionReady,
} from "@gobblet/protocol";
import { Server } from "socket.io";
import type { Socket } from "socket.io";
import { isSuspended, resolveIdentity, toActor } from "../identity/resolve";
import type { IdentityResolvers } from "../identity/resolve";
import type { RematchBroadcast, RematchResult, RematchService } from "../matchmaking/rematch";
import type { MatchmakingQueue, SeatedMatch } from "../matchmaking/service";
import type { CommandResult, MatchRuntime } from "../match/runtime";
import type { Actor } from "../match/snapshot";
import { ClockBroadcaster, TICK_INTERVAL_MS } from "./clock-broadcaster";
import { ChannelMutes } from "./communication";
import type { CommunicationChannel } from "./communication";

export type GatewayLogger = Readonly<{
  info: (context: Readonly<Record<string, unknown>>, message: string) => void;
  error: (context: Readonly<Record<string, unknown>>, message: string) => void;
}>;

export type GatewayOptions = Readonly<{
  httpServer: HttpServer;
  config: ServerConfig;
  runtime: MatchRuntime;
  resolvers: IdentityResolvers;
  matchmaking: MatchmakingQueue;
  rematch: RematchService;
  log: GatewayLogger;
  /** Required, not defaulted: every caller of the gateway already has a clock. */
  now: () => number;
  /** Left off in tests so the cadence can be driven by hand. */
  startTicking?: boolean;
}>;

type SocketSession = Readonly<{
  actor: Actor;
  displayName: string;
}>;

/** Where a piece of communication came from, and who it is delivered to. */
type ParticipantSeat = Readonly<{
  side: Player;
  actorIds: readonly [string, string];
}>;

type CommunicationOrigin = Readonly<{
  matchId: string;
  from: Player;
  actorId: string;
  sentAt: number;
}>;

/**
 * A drained queue is told to the client rather than silently forgotten: section 7.5
 * forbids requeueing a stale session, so the client must ask again itself.
 */
const QUEUE_CLOSED_ERROR: RecoverableError = Object.freeze({
  code: "queue_closed",
  message: "The server stopped accepting queue entries",
  retryable: true,
});

const SUSPENDED_ERROR: FatalError = Object.freeze({
  code: "account_suspended",
  message: "This account is suspended",
  action: "contact-support",
});

type Acknowledge<T> = ((response: T) => void) | undefined;

const IN = CLIENT_TO_SERVER_EVENTS;
const OUT = SERVER_TO_CLIENT_EVENTS;

export function matchRoom(matchId: string): string {
  return `match:${matchId}`;
}

type Version = Readonly<{ major: number; minor: number; patch: number }>;

const VERSION_PATTERN = /^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)$/;

function parseVersion(value: string): Version | null {
  const groups = VERSION_PATTERN.exec(value)?.groups;
  if (!groups) {
    return null;
  }
  return {
    major: Number(groups.major),
    minor: Number(groups.minor),
    patch: Number(groups.patch),
  };
}

/**
 * Compares dotted numeric versions. A version that cannot be parsed counts as
 * unsupported, because an unparsable version is a broken client.
 */
export function isClientVersionSupported(clientVersion: string, minimum: string): boolean {
  const client = parseVersion(clientVersion);
  const floor = parseVersion(minimum);
  if (!client || !floor) {
    return false;
  }

  if (client.major !== floor.major) {
    return client.major > floor.major;
  }
  if (client.minor !== floor.minor) {
    return client.minor > floor.minor;
  }
  return client.patch >= floor.patch;
}

/**
 * The real-time surface. It owns no rules and no clock arithmetic: it validates
 * payloads, resolves the actor, delegates to the match runtime and publishes what
 * the runtime already committed (docs/adr/0007).
 */
export class MatchGateway {
  readonly io: Server;

  private readonly config: ServerConfig;

  private readonly runtime: MatchRuntime;

  private readonly resolvers: IdentityResolvers;

  private readonly matchmaking: MatchmakingQueue;

  private readonly rematch: RematchService;

  private readonly log: GatewayLogger;

  private readonly clock: () => number;

  private readonly sessions = new WeakMap<Socket, SocketSession>();

  /** Per connection, seeded from the profile and changed by `match:mute-state`. */
  private readonly mutes = new ChannelMutes<Socket>();

  /** Sockets by actor, so a pairing can be published to the two players it seated. */
  private readonly socketsByActor = new Map<string, Set<Socket>>();

  private readonly clocks = new ClockBroadcaster();

  private ticker: NodeJS.Timeout | undefined;

  constructor(options: GatewayOptions) {
    this.config = options.config;
    this.runtime = options.runtime;
    this.resolvers = options.resolvers;
    this.matchmaking = options.matchmaking;
    this.rematch = options.rematch;
    this.log = options.log;
    this.clock = options.now;

    this.io = new Server(options.httpServer, {
      cors: { origin: [...this.config.corsOrigins], credentials: true },
      serveClient: false,
    });

    this.io.on("connection", (socket) => {
      this.registerHandlers(socket);
    });

    if (options.startTicking ?? true) {
      this.startTicking();
    }
  }

  startTicking(): void {
    this.ticker ??= setInterval(() => {
      void this.tick();
    }, TICK_INTERVAL_MS).unref();
  }

  async close(): Promise<void> {
    if (this.ticker) {
      clearInterval(this.ticker);
      this.ticker = undefined;
    }
    await this.io.close();
  }

  /**
   * One cadence step: broadcast the clocks that are due and settle matches whose
   * clock ran out. This is the only path that ends a match on time when neither
   * player sends anything.
   */
  async tick(): Promise<void> {
    const now = this.clock();
    await this.tickMatchmaking();
    for (const broadcast of this.rematch.sweep()) {
      this.publishRematch(broadcast);
    }
    const { sync, expired } = this.clocks.tick(now);

    for (const event of sync) {
      this.io.to(matchRoom(event.matchId)).emit(OUT.matchClockSync, event);
    }

    for (const matchId of expired) {
      try {
        const settled = await this.runtime.settleExpiredClock(matchId);
        if (!settled) {
          continue;
        }
        this.clocks.track(settled.snapshot, now);
        this.publishSnapshot(settled.snapshot);
        if (settled.ended) {
          this.io.to(matchRoom(matchId)).emit(OUT.matchEnded, settled.ended);
        }
      } catch (error) {
        this.log.error({ error, matchId }, "failed to settle an expired clock");
      }
    }
  }

  /**
   * Pairs whoever has become compatible while waiting, and refreshes the status of
   * the players still searching (spec section 9.2).
   */
  private async tickMatchmaking(): Promise<void> {
    try {
      const { seated, statuses } = await this.matchmaking.tick();
      for (const match of seated) {
        this.publishPairing(match);
      }
      for (const { actorId, status } of statuses) {
        this.emitToActor(actorId, OUT.queueStatus, status);
      }
    } catch (error) {
      this.log.error({ error }, "failed to pair waiting players");
    }
  }

  private registerHandlers(socket: Socket): void {
    socket.on(
      IN.sessionAuthenticate,
      (payload: unknown, ack: Acknowledge<SessionAuthenticateAck>) => {
        void this.handleAuthenticate(socket, payload, ack);
      },
    );

    socket.on(IN.queueJoin, (payload: unknown, ack: Acknowledge<QueueJoinAck>) => {
      void this.handleQueueJoin(socket, payload, ack);
    });

    socket.on(IN.queueLeave, (payload: unknown, ack: Acknowledge<QueueLeaveAck>) => {
      this.handleQueueLeave(socket, payload, ack);
    });

    socket.on("disconnect", () => {
      this.forgetSocket(socket);
    });

    socket.on(IN.matchSync, (payload: unknown, ack: Acknowledge<MatchSyncAck>) => {
      void this.handleSync(socket, payload, ack);
    });

    socket.on(IN.matchMove, (payload: unknown, ack: Acknowledge<CommandAck>) => {
      void this.handleMove(socket, payload, ack);
    });

    socket.on(IN.matchResign, (payload: unknown, ack: Acknowledge<CommandAck>) => {
      void this.handleResign(socket, payload, ack);
    });

    socket.on(IN.matchRematchRequest, (payload: unknown, ack: Acknowledge<RematchAck>) => {
      void this.handleRematchRequest(socket, payload, ack);
    });

    socket.on(IN.matchRematchRespond, (payload: unknown, ack: Acknowledge<RematchAck>) => {
      void this.handleRematchRespond(socket, payload, ack);
    });

    socket.on(IN.matchPresetMessage, (payload: unknown, ack: Acknowledge<CommunicationAck>) => {
      void this.handlePresetMessage(socket, payload, ack);
    });

    socket.on(IN.matchReaction, (payload: unknown, ack: Acknowledge<CommunicationAck>) => {
      void this.handleReaction(socket, payload, ack);
    });

    socket.on(IN.matchMuteState, (payload: unknown, ack: Acknowledge<CommunicationAck>) => {
      void this.handleMuteState(socket, payload, ack);
    });
  }

  private async handleAuthenticate(
    socket: Socket,
    payload: unknown,
    ack: Acknowledge<SessionAuthenticateAck>,
  ): Promise<void> {
    const parsed = sessionAuthenticateSchema.safeParse(payload);
    if (!parsed.success) {
      this.rejectHandshake(socket, ack, {
        code: "invalid_handshake",
        message: "The handshake payload is not valid",
        action: "update-client",
      });
      return;
    }

    const { clientVersion, appEnv, sessionToken } = parsed.data;
    if (!isClientVersionSupported(clientVersion, this.config.minSupportedClientVersion)) {
      this.rejectHandshake(socket, ack, {
        code: "unsupported_client",
        message: `This client is older than the supported minimum ${this.config.minSupportedClientVersion}`,
        action: "update-client",
      });
      return;
    }

    // A client pointed at the wrong deployment would otherwise play against
    // opponents it can never see again.
    if (appEnv !== this.config.appEnv) {
      this.rejectHandshake(socket, ack, {
        code: "environment_mismatch",
        message: "This client is configured for a different environment",
        action: "update-client",
      });
      return;
    }

    const identity =
      sessionToken === undefined ? null : await resolveIdentity(this.resolvers, sessionToken);
    if (!identity) {
      this.rejectHandshake(socket, ack, {
        code: "unauthenticated",
        message: "A valid session token is required",
        action: "reauthenticate",
      });
      return;
    }

    if (isSuspended(identity)) {
      this.rejectHandshake(socket, ack, SUSPENDED_ERROR);
      return;
    }

    const actor = toActor(identity);
    this.sessions.set(socket, { actor, displayName: identity.displayName });
    const seeded =
      actor.actorType === "user"
        ? await this.resolvers.identity.communicationMutes(actor.actorId)
        : null;
    if (seeded) {
      this.mutes.set(socket, seeded);
    }
    this.rememberSocket(actor.actorId, socket);

    const ready: SessionReady = {
      actorId: actor.actorId,
      actorType: actor.actorType,
      displayName: identity.displayName,
      isGuest: actor.actorType === "guest",
      serverTime: this.clock(),
      features: [],
    };
    socket.emit(OUT.sessionReady, ready);
    ack?.({ ok: true, session: ready });
  }

  /**
   * Joining answers with the queue the player is now in, or with the match if an
   * opponent was already waiting. A refusal names its reason so the client can say
   * why rather than spin (spec section 8.1).
   */
  private async handleQueueJoin(
    socket: Socket,
    payload: unknown,
    ack: Acknowledge<QueueJoinAck>,
  ): Promise<void> {
    const session = this.sessions.get(socket);
    if (!session) {
      ack?.({ state: "refused", reason: "not-authorized" });
      return;
    }

    const parsed = queueJoinRequestSchema.safeParse(payload);
    if (!parsed.success) {
      this.emitRecoverable(socket, "The queue request is not valid", parsed.error);
      ack?.({ state: "refused", reason: "not-authorized" });
      return;
    }

    const result = await this.matchmaking.join(session, parsed.data);
    if (result.outcome === "refused") {
      ack?.({ state: "refused", reason: result.reason });
      return;
    }

    if (result.outcome === "seated") {
      this.publishPairing(result.seated);
      ack?.({ state: "matched", matchId: result.seated.snapshot.matchId });
      return;
    }

    ack?.({ state: "queued", status: result.status });
  }

  private handleQueueLeave(
    socket: Socket,
    payload: unknown,
    ack: Acknowledge<QueueLeaveAck>,
  ): void {
    const session = this.sessions.get(socket);
    if (!session) {
      ack?.({ ok: false, reason: "not-authorized" });
      return;
    }

    const parsed = queueLeaveRequestSchema.safeParse(payload);
    if (!parsed.success) {
      this.emitRecoverable(socket, "The queue request is not valid", parsed.error);
      ack?.({ ok: false, reason: "not-queued" });
      return;
    }

    ack?.(
      this.matchmaking.leave(session.actor.actorId)
        ? { ok: true }
        : { ok: false, reason: "not-queued" },
    );
  }

  private async handleRematchRequest(
    socket: Socket,
    payload: unknown,
    ack: Acknowledge<RematchAck>,
  ): Promise<void> {
    const session = this.sessions.get(socket);
    if (!session) {
      ack?.({ ok: false, reason: "not-authorized" });
      return;
    }

    const parsed = rematchRequestSchema.safeParse(payload);
    if (!parsed.success) {
      this.emitRecoverable(socket, "The rematch request is not valid", parsed.error);
      ack?.({ ok: false, reason: "not-authorized" });
      return;
    }

    const result = await this.rematch.request(session.actor, parsed.data.matchId);
    this.answerRematch(result, ack);
  }

  private async handleRematchRespond(
    socket: Socket,
    payload: unknown,
    ack: Acknowledge<RematchAck>,
  ): Promise<void> {
    const session = this.sessions.get(socket);
    if (!session) {
      ack?.({ ok: false, reason: "not-authorized" });
      return;
    }

    const parsed = rematchRespondSchema.safeParse(payload);
    if (!parsed.success) {
      this.emitRecoverable(socket, "The rematch answer is not valid", parsed.error);
      ack?.({ ok: false, reason: "not-authorized" });
      return;
    }

    const result = await this.rematch.respond(
      session.actor,
      parsed.data.matchId,
      parsed.data.accept,
    );
    this.answerRematch(result, ack);
  }

  private async handlePresetMessage(
    socket: Socket,
    payload: unknown,
    ack: Acknowledge<CommunicationAck>,
  ): Promise<void> {
    const parsed = presetMessageRequestSchema.safeParse(payload);
    if (!parsed.success) {
      this.emitRecoverable(socket, "The message payload is not valid", parsed.error);
      ack?.({ ok: false, reason: "invalid-payload" });
      return;
    }

    const relayed = await this.relay(socket, "preset-messages", parsed.data.matchId, (origin) => ({
      event: OUT.matchPresetMessage,
      payload: { ...origin, messageKey: parsed.data.messageKey },
    }));
    ack?.(relayed);
  }

  private async handleReaction(
    socket: Socket,
    payload: unknown,
    ack: Acknowledge<CommunicationAck>,
  ): Promise<void> {
    const parsed = reactionRequestSchema.safeParse(payload);
    if (!parsed.success) {
      this.emitRecoverable(socket, "The reaction payload is not valid", parsed.error);
      ack?.({ ok: false, reason: "invalid-payload" });
      return;
    }

    const relayed = await this.relay(socket, "reactions", parsed.data.matchId, (origin) => ({
      event: OUT.matchReaction,
      payload: { ...origin, reactionKey: parsed.data.reactionKey },
    }));
    ack?.(relayed);
  }

  /**
   * Mute lives on the connection for as long as it lasts (appendix P6.2). It is not
   * written to the profile: a change made during a match is a choice about this
   * match, and the profile default is set on the account page.
   */
  private async handleMuteState(
    socket: Socket,
    payload: unknown,
    ack: Acknowledge<CommunicationAck>,
  ): Promise<void> {
    const parsed = muteStateRequestSchema.safeParse(payload);
    if (!parsed.success) {
      this.emitRecoverable(socket, "The mute payload is not valid", parsed.error);
      ack?.({ ok: false, reason: "invalid-payload" });
      return;
    }

    const session = this.sessions.get(socket);
    if (!session) {
      ack?.({ ok: false, reason: "not-authorized" });
      return;
    }
    if (!(await this.participantSeat(session.actor, parsed.data.matchId))) {
      ack?.({ ok: false, reason: "not-participant" });
      return;
    }

    this.mutes.set(socket, {
      presetMessagesMuted: parsed.data.presetMessagesMuted,
      reactionsMuted: parsed.data.reactionsMuted,
    });
    ack?.({ ok: true });
  }

  /**
   * Relays one piece of communication to the two seats of the match and to nobody
   * else. Nothing is written: the event is the whole of it (ADR-0026). A recipient
   * who has muted the channel is not sent the event at all, while the sender always
   * hears their own, which is how their client shows what it sent.
   */
  private async relay(
    socket: Socket,
    channel: CommunicationChannel,
    matchId: string,
    build: (origin: CommunicationOrigin) => Readonly<{ event: string; payload: unknown }>,
  ): Promise<CommunicationAck> {
    const session = this.sessions.get(socket);
    if (!session) {
      return { ok: false, reason: "not-authorized" };
    }

    const seat = await this.participantSeat(session.actor, matchId);
    if (!seat) {
      return { ok: false, reason: "not-participant" };
    }

    const { event, payload } = build({
      matchId,
      from: seat.side,
      actorId: session.actor.actorId,
      sentAt: this.clock(),
    });

    for (const actorId of seat.actorIds) {
      const isSender = actorId === session.actor.actorId;
      for (const recipient of this.socketsByActor.get(actorId) ?? []) {
        if (isSender || !this.mutes.withholds(recipient, channel)) {
          recipient.emit(event, payload);
        }
      }
    }

    return { ok: true };
  }

  /** The seat the actor holds in the match, and both seats to deliver to. */
  private async participantSeat(actor: Actor, matchId: string): Promise<ParticipantSeat | null> {
    const snapshot = await this.runtime.getSnapshotForActor(matchId, actor);
    if (!snapshot) {
      return null;
    }
    return {
      side: snapshot.players.light.actorId === actor.actorId ? "light" : "dark",
      actorIds: [snapshot.players.light.actorId, snapshot.players.dark.actorId],
    };
  }

  /**
   * Every participant hears the same status, including the player who spoke, so a
   * client never has to infer the offer's state from its own acknowledgement.
   */
  private answerRematch(result: RematchResult, ack: Acknowledge<RematchAck>): void {
    if (!result.ok) {
      ack?.({ ok: false, reason: result.reason });
      return;
    }
    this.publishRematch(result.broadcast);
    ack?.({ ok: true, status: result.broadcast.status });
  }

  private publishRematch(broadcast: RematchBroadcast): void {
    for (const actorId of broadcast.actorIds) {
      this.emitToActor(actorId, OUT.matchRematchStatus, broadcast.status);
    }
    if (broadcast.next) {
      this.publishSeatedMatch(broadcast.next);
    }
  }

  private rejectHandshake(
    socket: Socket,
    ack: Acknowledge<SessionAuthenticateAck>,
    error: FatalError,
  ): void {
    socket.emit(OUT.errorFatal, error);
    ack?.({ ok: false, error });
    socket.disconnect(true);
  }

  private async handleSync(
    socket: Socket,
    payload: unknown,
    ack: Acknowledge<MatchSyncAck>,
  ): Promise<void> {
    const session = this.sessions.get(socket);
    if (!session) {
      ack?.({ ok: false, reason: "not-authorized" });
      return;
    }

    const parsed = matchSyncRequestSchema.safeParse(payload);
    if (!parsed.success) {
      this.emitRecoverable(socket, "The sync request is not valid", parsed.error);
      ack?.({ ok: false, reason: "not-authorized" });
      return;
    }

    const snapshot = await this.runtime.getSnapshotForActor(parsed.data.matchId, session.actor);
    if (!snapshot) {
      ack?.({ ok: false, reason: "not-authorized" });
      return;
    }

    await socket.join(matchRoom(snapshot.matchId));
    this.clocks.track(snapshot, this.clock());
    socket.emit(OUT.matchSnapshot, snapshot);
    ack?.({ ok: true, snapshot });
  }

  private async handleMove(
    socket: Socket,
    payload: unknown,
    ack: Acknowledge<CommandAck>,
  ): Promise<void> {
    const session = this.authorizeCommand(socket, payload, ack);
    if (!session) {
      return;
    }

    const command = matchMoveCommandSchema.safeParse(payload);
    if (!command.success) {
      this.emitRecoverable(socket, "The move payload is not valid", command.error);
      ack?.({ ok: false, commandId: session.commandId, reason: "illegal-move" });
      return;
    }

    if (await this.refuseSuspended(socket, session, ack)) {
      return;
    }

    this.settle(await this.runtime.applyMoveCommand(session.actor, command.data), ack);
  }

  private async handleResign(
    socket: Socket,
    payload: unknown,
    ack: Acknowledge<CommandAck>,
  ): Promise<void> {
    const session = this.authorizeCommand(socket, payload, ack);
    if (!session) {
      return;
    }

    const command = matchResignCommandSchema.safeParse(payload);
    if (!command.success) {
      this.emitRecoverable(socket, "The resign payload is not valid", command.error);
      ack?.({ ok: false, commandId: session.commandId, reason: "illegal-move" });
      return;
    }

    if (await this.refuseSuspended(socket, session, ack)) {
      return;
    }

    this.settle(await this.runtime.applyResignCommand(session.actor, command.data), ack);
  }

  /**
   * Validates the envelope metadata and the session. A payload with no usable
   * `commandId` cannot be acknowledged in the documented shape, so the client is
   * told through the error channel instead (spec section 7.2).
   */
  private authorizeCommand(
    socket: Socket,
    payload: unknown,
    ack: Acknowledge<CommandAck>,
  ): (SocketSession & Readonly<{ commandId: string }>) | null {
    const metadata = commandEnvelopeHeaderSchema.safeParse(payload);
    if (!metadata.success) {
      this.emitRecoverable(socket, "The command envelope is not valid", metadata.error);
      return null;
    }

    const session = this.sessions.get(socket);
    if (!session) {
      ack?.({ ok: false, commandId: metadata.data.commandId, reason: "not-authorized" });
      return null;
    }

    return { ...session, commandId: metadata.data.commandId };
  }

  /**
   * Suspension is read per command, because a suspension applied mid-match must
   * stop the next move rather than the next sign-in (spec section 19.3). It ends
   * the socket, so a suspended player is not left believing the game continues.
   */
  private async refuseSuspended(
    socket: Socket,
    session: SocketSession & Readonly<{ commandId: string }>,
    ack: Acknowledge<CommandAck>,
  ): Promise<boolean> {
    if (session.actor.actorType !== "user") {
      return false;
    }
    const flags = await this.resolvers.identity.accountFlags(session.actor.actorId);
    if (flags?.status !== "suspended") {
      return false;
    }

    ack?.({ ok: false, commandId: session.commandId, reason: "not-authorized" });
    socket.emit(OUT.errorFatal, SUSPENDED_ERROR);
    socket.disconnect(true);
    return true;
  }

  private settle(result: CommandResult, ack: Acknowledge<CommandAck>): void {
    const now = this.clock();

    if (result.snapshot) {
      this.clocks.track(result.snapshot, now);
    }

    if (result.moveCommitted) {
      this.io
        .to(matchRoom(result.moveCommitted.matchId))
        .emit(OUT.matchMoveCommitted, result.moveCommitted);
    } else if (result.ack.ok && result.snapshot) {
      // A resignation has no move to publish, so the room learns from the snapshot.
      this.publishSnapshot(result.snapshot);
    }

    if (result.ended) {
      this.clocks.forget(result.ended.matchId);
      this.io.to(matchRoom(result.ended.matchId)).emit(OUT.matchEnded, result.ended);
    }

    ack?.(result.ack);
  }

  private publishSnapshot(snapshot: MatchSnapshot): void {
    this.io.to(matchRoom(snapshot.matchId)).emit(OUT.matchSnapshot, snapshot);
  }

  /**
   * Both players join the room and are told their own colour before any clock
   * broadcast, so neither can receive a tick for a match it has not been told about.
   */
  /**
   * Draining releases everyone waiting and ends every open offer, and tells them so
   * (spec sections 7.5 and 7.6). Active matches are untouched: they are persisted.
   */
  drain(): void {
    for (const actorId of this.matchmaking.stopAcceptingEntries()) {
      this.emitToActor(actorId, OUT.errorRecoverable, QUEUE_CLOSED_ERROR);
    }
    for (const broadcast of this.rematch.forgetAll()) {
      this.publishRematch(broadcast);
    }
  }

  /**
   * A pairing is the one matchmaking fact worth keeping: how long the players
   * waited, and how deep the queues still are (spec section 17.1, appendix P4.9).
   */
  private publishPairing(match: SeatedMatch): void {
    this.log.info(
      {
        matchId: match.snapshot.matchId,
        mode: match.snapshot.mode,
        timeControlSeconds: match.snapshot.timeControlSeconds,
        waitedMs: match.waitedMs,
        depths: this.matchmaking.depths(),
      },
      "paired two waiting players",
    );
    this.publishSeatedMatch(match);
  }

  private publishSeatedMatch(match: SeatedMatch): void {
    for (const { actorId, event } of match.events) {
      for (const socket of this.socketsByActor.get(actorId) ?? []) {
        void socket.join(matchRoom(event.matchId));
        socket.emit(OUT.matchFound, event);
      }
    }
    this.clocks.track(match.snapshot, this.clock());
  }

  private rememberSocket(actorId: string, socket: Socket): void {
    const sockets = this.socketsByActor.get(actorId) ?? new Set<Socket>();
    sockets.add(socket);
    this.socketsByActor.set(actorId, sockets);
  }

  /**
   * A disconnected player must not be paired: the opponent would meet an empty seat
   * on a running clock (ADR-0018).
   */
  private forgetSocket(socket: Socket): void {
    const session = this.sessions.get(socket);
    if (!session) {
      return;
    }
    const sockets = this.socketsByActor.get(session.actor.actorId);
    sockets?.delete(socket);
    if (sockets && sockets.size === 0) {
      this.socketsByActor.delete(session.actor.actorId);
      this.matchmaking.leave(session.actor.actorId);
      for (const broadcast of this.rematch.cancelFor(session.actor.actorId)) {
        this.publishRematch(broadcast);
      }
    }
  }

  private emitToActor(actorId: string, event: string, payload: unknown): void {
    for (const socket of this.socketsByActor.get(actorId) ?? []) {
      socket.emit(event, payload);
    }
  }

  private emitRecoverable(
    socket: Socket,
    message: string,
    error: Parameters<typeof httpErrorDetails>[0],
  ): void {
    socket.emit(OUT.errorRecoverable, {
      code: "validation_failed",
      message,
      retryable: true,
      context: { details: httpErrorDetails(error) },
    });
  }
}
