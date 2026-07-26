import { applyMove, fromSerializableGameState, toSerializableGameState } from "@gobblet/game-core";
import type { ReserveStackIndex, Square } from "@gobblet/game-core";
import type {
  CommandAck,
  CommandRejectionReason,
  MatchClockSyncEvent,
  MatchEndedEvent,
  MatchMoveCommittedEvent,
  MatchSnapshot,
  Move,
  Player,
} from "@gobblet/protocol";

/**
 * The client's whole match state: the last snapshot the server sent, at most one
 * command awaiting an answer, the local selection and the connection phase
 * (docs/adr/0020). Nothing else in the client writes game state.
 */
export type ConnectionPhase = "connecting" | "authenticating" | "ready" | "reconnecting" | "lost";

export type Selection = Readonly<
  { player: Player } & (
    { kind: "reserve"; reserveStack: ReserveStackIndex } | { kind: "board"; from: Square }
  )
>;

export type PendingCommand = Readonly<{
  kind: "move" | "resign";
  commandId: string;
  matchId: string;
  expectedVersion: number;
  move: Move | null;
  sentAt: number;
}>;

export type MatchChannelState = Readonly<{
  snapshot: MatchSnapshot | null;
  pending: PendingCommand | null;
  selection: Selection | null;
  phase: ConnectionPhase;
  /** Set when an event could not be applied, so the view knows to ask for a snapshot. */
  resyncRequired: boolean;
  /** A transient message for the player: a rejection reason or a discarded event. */
  notice: string | null;
  ended: MatchEndedEvent | null;
  /** Counts the payloads that failed validation, reported by the diagnostics panel. */
  discarded: number;
}>;

export type MatchChannelAction =
  | Readonly<{ type: "phase"; phase: ConnectionPhase }>
  | Readonly<{ type: "snapshot"; snapshot: MatchSnapshot }>
  | Readonly<{ type: "move-committed"; event: MatchMoveCommittedEvent }>
  | Readonly<{ type: "clock-sync"; event: MatchClockSyncEvent }>
  | Readonly<{ type: "ended"; event: MatchEndedEvent }>
  | Readonly<{ type: "command-sent"; command: PendingCommand }>
  | Readonly<{ type: "command-answered"; ack: CommandAck }>
  | Readonly<{ type: "select"; selection: Selection | null }>
  | Readonly<{ type: "discarded"; reason: string }>
  | Readonly<{ type: "notice"; notice: string | null }>
  | Readonly<{ type: "resynced" }>;

export const INITIAL_MATCH_CHANNEL: MatchChannelState = Object.freeze({
  snapshot: null,
  pending: null,
  selection: null,
  phase: "connecting",
  resyncRequired: false,
  notice: null,
  ended: null,
  discarded: 0,
});

const REJECTION_MESSAGES: Readonly<Record<CommandRejectionReason, string>> = Object.freeze({
  "stale-version": "The board had already moved on, so the move was not played",
  "not-your-turn": "It was not your turn",
  "illegal-move": "That move is not legal",
  "match-ended": "The match is over",
  "not-authorized": "This match is not yours to play",
  "clock-expired": "The clock ran out",
  "duplicate-command": "That move had already been played",
});

/**
 * The preview a pending move produces. It is computed from the held snapshot on
 * demand instead of being stored, so the optimistic board can never be mistaken
 * for the authoritative one (docs/adr/0020).
 */
export function previewSnapshot(state: MatchChannelState): MatchSnapshot | null {
  const { snapshot, pending } = state;
  if (!snapshot || !pending?.move || pending.expectedVersion !== snapshot.version) {
    return snapshot;
  }

  const result = applyMove(fromSerializableGameState(snapshot.state), pending.move);
  if (!result.ok) {
    return snapshot;
  }

  return {
    ...snapshot,
    state: toSerializableGameState(result.state),
    activePlayer: result.state.activePlayer,
    lastMove: { move: pending.move, version: snapshot.version },
  };
}

/** True while the board must refuse input: one command may be outstanding at a time. */
export function isInputLocked(state: MatchChannelState): boolean {
  return state.pending !== null || state.phase !== "ready";
}

function advance(snapshot: MatchSnapshot, event: MatchMoveCommittedEvent): MatchSnapshot | null {
  const result = applyMove(fromSerializableGameState(snapshot.state), event.move);
  if (!result.ok) {
    return null;
  }

  return {
    ...snapshot,
    version: event.version,
    state: toSerializableGameState(result.state),
    activePlayer: event.activePlayer,
    clocks: event.clocks,
    lastMove: { move: event.move, version: event.version },
  };
}

function clearPendingFor(state: MatchChannelState, version: number): PendingCommand | null {
  if (state.pending && state.pending.expectedVersion < version) {
    return null;
  }
  return state.pending;
}

/**
 * A pure reducer over parsed protocol events (docs/adr/0020). An event that is not
 * the successor of the held version is never patched in: the state asks for a fresh
 * snapshot instead.
 */
export function matchChannelReducer(
  state: MatchChannelState,
  action: MatchChannelAction,
): MatchChannelState {
  switch (action.type) {
    case "phase":
      return { ...state, phase: action.phase };

    case "snapshot": {
      if (state.snapshot && action.snapshot.version < state.snapshot.version) {
        return state;
      }
      return {
        ...state,
        snapshot: action.snapshot,
        // A snapshot at the version the command expected proves it was not applied,
        // so the command stays pending and is retried with its own identifier.
        pending: clearPendingFor(state, action.snapshot.version),
        selection: null,
        resyncRequired: false,
      };
    }

    case "move-committed": {
      const { snapshot } = state;
      if (!snapshot || action.event.matchId !== snapshot.matchId) {
        return state;
      }
      if (action.event.version <= snapshot.version) {
        return { ...state, pending: clearPendingFor(state, action.event.version) };
      }
      if (action.event.version !== snapshot.version + 1) {
        return { ...state, resyncRequired: true };
      }

      const advanced = advance(snapshot, action.event);
      if (!advanced) {
        return { ...state, resyncRequired: true, discarded: state.discarded + 1 };
      }

      return {
        ...state,
        snapshot: advanced,
        pending: clearPendingFor(state, action.event.version),
        selection: null,
      };
    }

    case "clock-sync": {
      const { snapshot } = state;
      if (!snapshot || action.event.matchId !== snapshot.matchId) {
        return state;
      }
      // A tick for a version the client has not reached means an event was missed.
      if (action.event.version > snapshot.version) {
        return { ...state, resyncRequired: true };
      }
      if (action.event.version < snapshot.version) {
        return state;
      }
      return {
        ...state,
        snapshot: {
          ...snapshot,
          activePlayer: action.event.activePlayer,
          clocks: {
            ...snapshot.clocks,
            lightRemainingMs: action.event.lightRemainingMs,
            darkRemainingMs: action.event.darkRemainingMs,
            serverTime: action.event.serverTime,
          },
        },
      };
    }

    case "ended": {
      if (state.snapshot && action.event.matchId !== state.snapshot.matchId) {
        return state;
      }
      return {
        ...state,
        ended: action.event,
        pending: null,
        selection: null,
        resyncRequired: state.snapshot === null || state.snapshot.version < action.event.version,
      };
    }

    case "command-sent":
      return { ...state, pending: action.command, notice: null };

    case "command-answered": {
      if (state.pending && action.ack.commandId !== state.pending.commandId) {
        return state;
      }
      if (action.ack.ok) {
        return { ...state, pending: null, selection: null };
      }
      return {
        ...state,
        pending: null,
        selection: null,
        snapshot: action.ack.snapshot ?? state.snapshot,
        resyncRequired: action.ack.snapshot === undefined,
        notice: REJECTION_MESSAGES[action.ack.reason],
      };
    }

    case "select":
      return isInputLocked(state) ? state : { ...state, selection: action.selection };

    case "discarded":
      return {
        ...state,
        discarded: state.discarded + 1,
        resyncRequired: true,
        notice: action.reason,
      };

    case "notice":
      return { ...state, notice: action.notice };

    case "resynced":
      return { ...state, resyncRequired: false };
  }
}
