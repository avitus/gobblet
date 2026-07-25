import {
  findEventByCommandId,
  findLatestMoveEvent,
  findMatchById,
  insertMatch,
  insertMatchEvent,
  listUnfinishedMatches,
  lockMatchForUpdate,
  updateMatchState,
} from "@gobblet/db";
import type { Database, DatabaseExecutor, MatchRow, MatchStatePatch } from "@gobblet/db";
import { applyMove, createInitialGame } from "@gobblet/game-core";
import type { GameState, Move, Player } from "@gobblet/game-core";
import type {
  CommandEnvelopeMetadata,
  CommandRejectionReason,
  MatchClockSyncEvent,
  MatchEndedEvent,
  MatchMoveCommittedEvent,
  MatchSnapshot,
  MatchSummary,
  MovePayload,
  TimeControl,
} from "@gobblet/protocol";
import { chargeActiveSide, readClocks, zeroActiveSide } from "./clock";
import type { CommittedClocks } from "./clock";
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

  constructor(options: MatchRuntimeOptions) {
    this.db = options.db;
    this.clock = options.now ?? ((): number => Date.now());
  }

  now(): number {
    return this.clock();
  }

  async createMatch(input: CreateMatchInput): Promise<MatchSnapshot> {
    const now = this.now();
    const startedAt = new Date(now);
    const firstPlayer = input.firstPlayer ?? "light";
    const state = createInitialGame(firstPlayer);
    const remainingMs = input.timeControlSeconds * 1000;

    return this.db.transaction(async (tx) => {
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

      return toSnapshot(row, now, null);
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
    return this.runCommand(actor, envelope, { requireTurn: true }, async (context) =>
      this.commitMove(context, actor, envelope.payload.move),
    );
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
    return this.db.transaction(async (tx) => {
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
    return this.db.transaction(async (tx) => {
      const now = this.now();
      const row = await lockMatchForUpdate(tx, envelope.matchId);
      if (!row) {
        return rejection(envelope, "not-authorized", null);
      }

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
      }),
    );

    const snapshot = toSnapshot(updated, now, { move, version });
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
      ended: endedEvent(updated, version, outcome),
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

    return {
      ack: { ok: true, commandId: envelope.commandId, newVersion: version },
      snapshot: await this.snapshotOf(tx, updated, now),
      moveCommitted: null,
      ended: endedEvent(updated, version, outcome),
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

    return {
      snapshot: await this.snapshotOf(tx, updated, now),
      ended: endedEvent(updated, version, outcome),
    };
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

    return {
      ...base,
      turnStartedAt: null,
      status: "completed",
      result: input.outcome.outcome,
      endReason: input.outcome.reason,
      endedAt: committedAt,
    };
  }

  private async snapshotOf(
    executor: DatabaseExecutor,
    row: MatchRow,
    now: number,
  ): Promise<MatchSnapshot> {
    return toSnapshot(row, now, await this.readLastMove(executor, row));
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

function endedEvent(
  row: MatchRow,
  version: number,
  outcome: RulesOutcome | null,
): MatchEndedEvent | null {
  if (!outcome) {
    return null;
  }
  return { matchId: row.id, version, result: outcome.outcome, reason: outcome.reason };
}
