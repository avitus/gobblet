import {
  findEventByCommandId,
  findLatestMoveEvent,
  findMatchById,
  findUnfinishedMatchForActor,
  insertMatch,
  insertMatchConnectionEvent,
  insertMatchEvent,
  listUnfinishedMatches,
  lockMatchForUpdate,
  updateMatchState,
} from "@gobblet/db";
import type {
  Database,
  DatabaseExecutor,
  MatchRow,
  MatchStatePatch,
  Transaction,
} from "@gobblet/db";
import { applyMove, createInitialGame } from "@gobblet/game-core";
import type { GameState, LegalMoveEvaluation, Move, Player } from "@gobblet/game-core";
import type {
  ColorAssignment,
  CommandEnvelopeMetadata,
  CommandRejectionReason,
  MatchClockSyncEvent,
  MatchEndedEvent,
  MatchMoveCommittedEvent,
  MatchSnapshot,
  MatchSummary,
  MovePayload,
  PlayerMatchSummary,
  TimeControl,
} from "@gobblet/protocol";
import { awardAchievementsForCompletion } from "../achievements/service";
import { winningLineIds } from "../achievements/lines";
import { createSilentTelemetry } from "../observability/telemetry";
import type { TelemetryService } from "../observability/telemetry";
import { applyRatingsForCompletion, readSeatRatings } from "../rating/service";
import { chargeActiveSide, clockAnomaly, readClocks, zeroActiveSide } from "./clock";
import type { CommittedClocks } from "./clock";
import { listPlayerHistory } from "./history";
import { matchClocks, participantSide, toSnapshot, toSummary } from "./snapshot";
import type { Actor, LastMove } from "./snapshot";
import { gameStateHash, opponentOutcome, outcomeOfGameState, writeGameState } from "./state";
import type { RulesOutcome } from "./state";
import { readGameState } from "./state";

export type CreateMatchInput = Readonly<{
  mode: MatchRow["mode"];
  timeControlSeconds: TimeControl;
  light: Actor & Readonly<{ displayName: string }>;
  dark: Actor & Readonly<{ displayName: string }>;
  firstPlayer?: Player;
  /** How the seats were decided, recorded for the audit of spec section 9.4. */
  colorAssignment?: ColorAssignment;
  /** The match a rematch alternates colours from (spec section 4.5). */
  rematchOfMatchId?: string;
  /**
   * How long the pairing waited, when a queue made it. Persisted so the average of
   * section 16 is a fact about a window rather than about this process (P7.6).
   */
  pairingWaitMs?: number;
}>;

/** One socket arriving at or leaving a match, as recorded for section 16. */
export type MatchConnectionEventInput = Readonly<{
  matchId: string;
  kind: "attached" | "detached";
  actor: Actor;
  socketId: string;
  reason?: string | undefined;
}>;

/**
 * Everything the gateway needs from one command: the acknowledgement for the
 * caller and the broadcasts for both participants. Broadcasts are returned
 * rather than emitted so nothing is published before the transaction commits
 * (spec section 7.4).
 */
export type CommandResult = Readonly<{
  ack:
    | Readonly<{ ok: true; commandId: string; newVersion: number }>
    | Readonly<{
        ok: false;
        commandId: string;
        reason: CommandRejectionReason;
        snapshot?: MatchSnapshot;
      }>;
  snapshot: MatchSnapshot | null;
  moveCommitted: MatchMoveCommittedEvent | null;
  ended: MatchEndedEvent | null;
}>;

export type SettleResult = Readonly<{
  snapshot: MatchSnapshot;
  ended: MatchEndedEvent | null;
}>;

export type MatchRuntimeOptions = Readonly<{
  db: Database;
  /** Injected so tests can drive time without sleeping (docs/adr/0009). */
  now?: () => number;
  /** Absent in a unit test, which then records nothing anywhere (ADR-0030). */
  telemetry?: TelemetryService;
}>;

type CommandContext = Readonly<{
  tx: DatabaseExecutor;
  row: MatchRow;
  state: GameState;
  side: Player;
  now: number;
  envelope: CommandEnvelopeMetadata;
}>;

export class MatchRuntime {
  private readonly db: Database;

  private readonly clock: () => number;

  private readonly telemetry: TelemetryService;

  constructor(options: MatchRuntimeOptions) {
    this.db = options.db;
    this.clock = options.now ?? ((): number => Date.now());
    this.telemetry = options.telemetry ?? createSilentTelemetry();
  }

  now(): number {
    return this.clock();
  }

  /**
   * Every match transaction runs through here, so a rollback is counted once and in
   * one place. The count is what section 17.4 alerts on: a match transaction that
   * fails is not a rejected command, it is a defect.
   */
  private async transact<T>(
    operation: string,
    action: (tx: Transaction) => Promise<T>,
  ): Promise<T> {
    const startedAt = this.clock();
    const observe = (): void => {
      this.telemetry.metrics.observeDatabaseLatency(operation, (this.clock() - startedAt) / 1000);
    };
    try {
      const result = await this.db.transaction(action);
      observe();
      return result;
    } catch (error) {
      this.telemetry.metrics.recordMatchTransactionFailure(operation);
      observe();
      throw error;
    }
  }

  /** Counts a stored clock that cannot be true, and carries on with the command. */
  private watchClock(row: MatchRow, now: number): void {
    const anomaly = clockAnomaly(row, now);
    if (anomaly !== null) {
      this.telemetry.metrics.recordClockAnomaly(anomaly);
    }
  }

  async createMatch(input: CreateMatchInput): Promise<MatchSnapshot> {
    const now = this.now();
    const startedAt = new Date(now);
    const firstPlayer = input.firstPlayer ?? "light";
    const state = createInitialGame(firstPlayer);
    const remainingMs = input.timeControlSeconds * 1000;

    return this.transact("create-match", async (tx) => {
      const row = await insertMatch(tx, {
        mode: input.mode,
        timeControlSeconds: input.timeControlSeconds,
        status: "active",
        lightPlayerType: input.light.actorType,
        lightPlayerId: input.light.actorId,
        lightDisplayName: input.light.displayName,
        darkPlayerType: input.dark.actorType,
        darkPlayerId: input.dark.actorId,
        darkDisplayName: input.dark.displayName,
        colorAssignment: input.colorAssignment ?? "random",
        ...(input.rematchOfMatchId ? { rematchOfMatchId: input.rematchOfMatchId } : {}),
        ...(input.pairingWaitMs === undefined ? {} : { pairingWaitMs: input.pairingWaitMs }),
        gameState: writeGameState(state),
        stateVersion: 0,
        lightRemainingMs: remainingMs,
        darkRemainingMs: remainingMs,
        activePlayer: firstPlayer,
        turnStartedAt: startedAt,
        lastClockCommitAt: startedAt,
        createdAt: startedAt,
        startedAt,
      });

      await insertMatchEvent(tx, {
        matchId: row.id,
        sequence: 0,
        commandId: null,
        type: "match-created",
        actorType: null,
        actorId: null,
        payload: { mode: input.mode, timeControlSeconds: input.timeControlSeconds, firstPlayer },
        stateHash: gameStateHash(state),
        createdAt: startedAt,
      });

      return toSnapshot(row, now, null, await readSeatRatings(tx, row));
    });
  }

  /**
   * Reads are actor scoped: a caller that is not a participant gets null, so no
   * endpoint can leak that a match exists (spec section 14.3).
   */
  async getSnapshotForActor(matchId: string, actor: Actor): Promise<MatchSnapshot | null> {
    const row = await findMatchById(this.db, matchId);
    if (!row || participantSide(row, actor) === null) {
      return null;
    }
    return this.snapshotOf(this.db, row, this.now());
  }

  async getSummaryForActor(matchId: string, actor: Actor): Promise<MatchSummary | null> {
    const row = await findMatchById(this.db, matchId);
    if (!row || participantSide(row, actor) === null) {
      return null;
    }
    return toSummary(row);
  }

  /**
   * Own match history, newest first, as the actor read it. Summaries never carry
   * the move event log, which stays administrative (spec section 11.2).
   */
  async listPlayerSummariesForActor(actor: Actor, limit: number): Promise<PlayerMatchSummary[]> {
    return listPlayerHistory(this.db, actor, limit);
  }

  /** Whether the actor already holds a clock, which bars it from a queue (spec section 9.2). */
  async hasUnfinishedMatch(actor: Actor): Promise<boolean> {
    return (await findUnfinishedMatchForActor(this.db, actor)) !== undefined;
  }

  /** Backs the periodic `match:clock-sync` broadcast (spec section 8.3). */
  async getClockSync(matchId: string): Promise<MatchClockSyncEvent | null> {
    const row = await findMatchById(this.db, matchId);
    if (!row || row.status !== "active") {
      return null;
    }
    const now = this.now();
    const reading = readClocks(row, now);
    return {
      matchId: row.id,
      version: row.stateVersion,
      activePlayer: row.activePlayer,
      lightRemainingMs: reading.lightRemainingMs,
      darkRemainingMs: reading.darkRemainingMs,
      serverTime: now,
    };
  }

  async applyMoveCommand(
    actor: Actor,
    envelope: CommandEnvelopeMetadata & Readonly<{ payload: MovePayload }>,
  ): Promise<CommandResult> {
    const startedAt = this.clock();
    const result = await this.runCommand(actor, envelope, { requireTurn: true }, async (context) =>
      this.commitMove(context, actor, envelope.payload.move),
    );
    this.telemetry.metrics.observeMoveLatency((this.clock() - startedAt) / 1000);
    return result;
  }

  /**
   * A socket attaching to or leaving a match (section 16). It is not a match event:
   * an event consumes the sequence number that is the match version, and a socket
   * changes no game state (appendix P7.5).
   */
  async recordConnectionEvent(input: MatchConnectionEventInput): Promise<void> {
    await insertMatchConnectionEvent(this.db, {
      matchId: input.matchId,
      kind: input.kind,
      actorType: input.actor.actorType,
      actorId: input.actor.actorId,
      socketId: input.socketId,
      reason: input.reason ?? null,
      createdAt: new Date(this.now()),
    });
  }

  /** Resigning is legal off turn, so the turn check is skipped (spec section 7.6). */
  async applyResignCommand(
    actor: Actor,
    envelope: CommandEnvelopeMetadata,
  ): Promise<CommandResult> {
    return this.runCommand(actor, envelope, { requireTurn: false }, async (context) =>
      this.commitResignation(context, actor),
    );
  }

  /**
   * Settles a match whose active clock ran out. Safe to call from anywhere: the
   * row lock plus the status check make the terminal write happen exactly once
   * (spec section 20.4).
   */
  async settleExpiredClock(matchId: string): Promise<SettleResult | null> {
    return this.transact("settle-clock", async (tx) => {
      const now = this.now();
      const row = await lockMatchForUpdate(tx, matchId);
      if (!row) {
        return null;
      }
      if (row.status !== "active" || !readClocks(row, now).expired) {
        return { snapshot: await this.snapshotOf(tx, row, now), ended: null };
      }
      return this.commitTimeout(tx, row, now);
    });
  }

  /**
   * Restart recovery. No in-memory state survives a restart, so matches whose
   * clock ran out while the process was down are settled on boot
   * (spec section 7.5).
   */
  async recoverUnfinishedMatches(): Promise<MatchEndedEvent[]> {
    const rows = await listUnfinishedMatches(this.db);
    const settled: MatchEndedEvent[] = [];
    for (const row of rows) {
      const result = await this.settleExpiredClock(row.id);
      if (result?.ended) {
        settled.push(result.ended);
      }
    }
    return settled;
  }

  private async runCommand(
    actor: Actor,
    envelope: CommandEnvelopeMetadata,
    options: Readonly<{ requireTurn: boolean }>,
    commit: (context: CommandContext) => Promise<CommandResult>,
  ): Promise<CommandResult> {
    return this.transact("command", async (tx) => {
      const now = this.now();
      const row = await lockMatchForUpdate(tx, envelope.matchId);
      if (!row) {
        return rejection(envelope, "not-authorized", null);
      }
      this.watchClock(row, now);

      const side = participantSide(row, actor);
      if (side === null) {
        return rejection(envelope, "not-authorized", null);
      }

      // Idempotency precedes every other check so a retried command reports the
      // same rejection even after the state has moved on (docs/adr/0010).
      const replayed = await findEventByCommandId(tx, envelope.matchId, envelope.commandId);
      if (replayed) {
        return rejection(envelope, "duplicate-command", await this.snapshotOf(tx, row, now));
      }

      if (row.status !== "active") {
        return rejection(envelope, "match-ended", await this.snapshotOf(tx, row, now));
      }

      if (readClocks(row, now).expired) {
        const settled = await this.commitTimeout(tx, row, now);
        return {
          ...rejection(envelope, "clock-expired", settled.snapshot),
          ended: settled.ended,
        };
      }

      if (envelope.expectedVersion !== row.stateVersion) {
        return rejection(envelope, "stale-version", await this.snapshotOf(tx, row, now));
      }

      if (options.requireTurn && row.activePlayer !== side) {
        return rejection(envelope, "not-your-turn", await this.snapshotOf(tx, row, now));
      }

      return commit({ tx, row, state: readGameState(row.gameState), side, now, envelope });
    });
  }

  private async commitMove(
    context: CommandContext,
    actor: Actor,
    move: Move,
  ): Promise<CommandResult> {
    const { tx, row, now, envelope, side } = context;
    const result = applyMove(context.state, move);
    if (!result.ok) {
      return rejection(envelope, "illegal-move", await this.snapshotOf(tx, row, now));
    }

    const nextState = result.state;
    const evaluation = result.evaluation;
    const outcome = outcomeOfGameState(nextState);
    const version = row.stateVersion + 1;

    await insertMatchEvent(tx, {
      matchId: row.id,
      sequence: version,
      commandId: envelope.commandId,
      type: "move",
      actorType: actor.actorType,
      actorId: actor.actorId,
      payload: outcome ? { move, outcome } : { move },
      stateHash: gameStateHash(nextState),
      // Recorded where the engine computed it, because the resulting board no
      // longer shows that a line was uncovered and closed again (appendix P6.5).
      revealedAndBlocked: revealedAndBlocked(evaluation),
      createdAt: new Date(now),
    });

    const updated = await updateMatchState(
      tx,
      row.id,
      this.patch({
        row,
        now,
        version,
        state: nextState,
        activePlayer: nextState.activePlayer,
        clocks: chargeActiveSide(row, now),
        moveCount: row.moveCount + 1,
        outcome,
        winningLineIds: winningLineIds(evaluation.resultingWinningLines),
      }),
    );

    const ended = await this.settle(tx, updated, version, outcome);
    const snapshot = toSnapshot(
      updated,
      now,
      { move, version },
      await readSeatRatings(tx, updated),
    );
    return {
      ack: { ok: true, commandId: envelope.commandId, newVersion: version },
      snapshot,
      moveCommitted: {
        matchId: updated.id,
        version,
        move,
        activePlayer: updated.activePlayer,
        clocks: matchClocks(updated, now),
        actor: side,
      },
      ended,
    };
  }

  private async commitResignation(context: CommandContext, actor: Actor): Promise<CommandResult> {
    const { tx, row, now, envelope, side, state } = context;
    const outcome: RulesOutcome = { outcome: opponentOutcome(side), reason: "resignation" };
    const version = row.stateVersion + 1;

    await insertMatchEvent(tx, {
      matchId: row.id,
      sequence: version,
      commandId: envelope.commandId,
      type: "resignation",
      actorType: actor.actorType,
      actorId: actor.actorId,
      payload: { side, outcome },
      stateHash: gameStateHash(state),
      createdAt: new Date(now),
    });

    const updated = await updateMatchState(
      tx,
      row.id,
      this.patch({
        row,
        now,
        version,
        state,
        activePlayer: row.activePlayer,
        clocks: chargeActiveSide(row, now),
        moveCount: row.moveCount,
        outcome,
      }),
    );

    const ended = await this.settle(tx, updated, version, outcome);
    return {
      ack: { ok: true, commandId: envelope.commandId, newVersion: version },
      snapshot: await this.snapshotOf(tx, updated, now),
      moveCommitted: null,
      ended,
    };
  }

  private async commitTimeout(
    tx: DatabaseExecutor,
    row: MatchRow,
    now: number,
  ): Promise<SettleResult> {
    const state = readGameState(row.gameState);
    const outcome: RulesOutcome = { outcome: opponentOutcome(row.activePlayer), reason: "timeout" };
    const version = row.stateVersion + 1;

    await insertMatchEvent(tx, {
      matchId: row.id,
      sequence: version,
      commandId: null,
      type: "timeout",
      actorType: null,
      actorId: null,
      payload: { side: row.activePlayer, outcome },
      stateHash: gameStateHash(state),
      createdAt: new Date(now),
    });

    const updated = await updateMatchState(
      tx,
      row.id,
      this.patch({
        row,
        now,
        version,
        state,
        activePlayer: row.activePlayer,
        clocks: zeroActiveSide(row),
        moveCount: row.moveCount,
        outcome,
      }),
    );

    const ended = await this.settle(tx, updated, version, outcome);
    return {
      snapshot: await this.snapshotOf(tx, updated, now),
      ended,
    };
  }

  /**
   * The terminal write. Ratings move here rather than in a follow-up job, so a
   * completed ranked match and the ratings it produced share one transaction
   * (docs/adr/0019-elo-in-the-completion-transaction.md).
   */
  private async settle(
    tx: DatabaseExecutor,
    row: MatchRow,
    version: number,
    outcome: RulesOutcome | null,
  ): Promise<MatchEndedEvent | null> {
    if (!outcome) {
      return null;
    }
    const ratings = await applyRatingsForCompletion(tx, row);
    // After the ratings, because "Contender" and "On a Roll" read the aggregate
    // this completion has just moved.
    await awardAchievementsForCompletion(tx, row);
    this.telemetry.metrics.recordCompletedMatch(row.mode, outcome.reason);
    if (outcome.reason === "timeout") {
      this.telemetry.metrics.recordClockTimeout();
    }
    this.announceCompletion(row, version, outcome);
    const ended: MatchEndedEvent = {
      matchId: row.id,
      version,
      result: outcome.outcome,
      reason: outcome.reason,
    };
    return ratings ? { ...ended, ratings } : ended;
  }

  /**
   * The completion event of section 17.1, once per seat. It happens here rather than
   * in the gateway because this is where the row is, and the row is what knows when
   * the match started and how many moves it took.
   */
  private announceCompletion(row: MatchRow, version: number, outcome: RulesOutcome): void {
    const startedAt = (row.startedAt ?? row.createdAt).getTime();
    const durationMs = Math.max(0, this.now() - startedAt);
    for (const seat of [
      { actorType: row.lightPlayerType, actorId: row.lightPlayerId },
      { actorType: row.darkPlayerType, actorId: row.darkPlayerId },
    ]) {
      this.telemetry.capture(seat, {
        name: "match-completed",
        mode: row.mode,
        timeControlSeconds: row.timeControlSeconds as TimeControl,
        result: outcome.outcome,
        endReason: outcome.reason,
        moveCount: version,
        durationMs,
      });
    }
  }

  private patch(
    input: Readonly<{
      row: MatchRow;
      now: number;
      version: number;
      state: GameState;
      activePlayer: Player;
      clocks: CommittedClocks;
      moveCount: number;
      outcome: RulesOutcome | null;
      winningLineIds?: readonly string[];
    }>,
  ): MatchStatePatch {
    const committedAt = new Date(input.now);
    const base = {
      gameState: writeGameState(input.state),
      stateVersion: input.version,
      activePlayer: input.activePlayer,
      lightRemainingMs: input.clocks.lightRemainingMs,
      darkRemainingMs: input.clocks.darkRemainingMs,
      lastClockCommitAt: committedAt,
      moveCount: input.moveCount,
    };

    if (!input.outcome) {
      return { ...base, turnStartedAt: committedAt, status: "active" };
    }

    const lines = input.winningLineIds ?? [];
    return {
      ...base,
      turnStartedAt: null,
      status: "completed",
      result: input.outcome.outcome,
      endReason: input.outcome.reason,
      ...(lines.length > 0 ? { winningLineIds: [...lines] } : {}),
      endedAt: committedAt,
    };
  }

  private async snapshotOf(
    executor: DatabaseExecutor,
    row: MatchRow,
    now: number,
  ): Promise<MatchSnapshot> {
    return toSnapshot(
      row,
      now,
      await this.readLastMove(executor, row),
      await readSeatRatings(executor, row),
    );
  }

  private async readLastMove(executor: DatabaseExecutor, row: MatchRow): Promise<LastMove | null> {
    const event = await findLatestMoveEvent(executor, row.id);
    if (!event) {
      return null;
    }
    const payload = event.payload as Readonly<{ move: Move }>;
    return { move: payload.move, version: event.sequence };
  }
}

/**
 * A revealing move is only legal when the placement closes every line it exposed;
 * an unclosed reveal loses at once (docs/rules.md section 9), so this is the whole
 * of what "Uncovered" describes.
 */
function revealedAndBlocked(evaluation: LegalMoveEvaluation): boolean {
  return (
    evaluation.revealedOpponentLines.length > 0 &&
    evaluation.blockedOpponentLines.length === evaluation.revealedOpponentLines.length
  );
}

function rejection(
  envelope: CommandEnvelopeMetadata,
  reason: CommandRejectionReason,
  snapshot: MatchSnapshot | null,
): CommandResult {
  return {
    ack: snapshot
      ? { ok: false, commandId: envelope.commandId, reason, snapshot }
      : { ok: false, commandId: envelope.commandId, reason },
    snapshot,
    moveCommitted: null,
    ended: null,
  };
}
