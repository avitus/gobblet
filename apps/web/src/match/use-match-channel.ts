import type { MatchSnapshot, Move } from "@gobblet/protocol";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  INITIAL_MATCH_CHANNEL,
  isInputLocked,
  matchChannelReducer,
  previewSnapshot,
} from "./channel";
import type { MatchChannelState, PendingCommand, Selection } from "./channel";
import { useSocket } from "./provider";
import type { MatchSocket, MatchSocketEvent } from "./socket";

export type MatchChannel = Readonly<{
  state: MatchChannelState;
  /** The board to draw: the snapshot, or the snapshot with a pending move previewed. */
  view: MatchSnapshot | null;
  inputLocked: boolean;
  submitMove: (move: Move) => void;
  resign: () => void;
  select: (selection: Selection | null) => void;
  dismissNotice: () => void;
}>;

function newCommandId(): string {
  return crypto.randomUUID();
}

/**
 * Binds the socket to the match reducer (docs/adr/0020). Every inbound event has
 * already been validated by the socket; this hook only decides what to ask for
 * next: a snapshot after a gap, and one retry of a pending command per reconnect.
 */
export function useMatchChannel(matchId: string | null): MatchChannel {
  const socket = useSocket();
  const [state, dispatch] = useReducer(matchChannelReducer, INITIAL_MATCH_CHANNEL);
  const [connectionEpoch, setConnectionEpoch] = useState(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const unsubscribe = socket.subscribe((event: MatchSocketEvent) => {
      switch (event.type) {
        case "match-snapshot":
          dispatch({ type: "snapshot", snapshot: event.payload });
          break;
        case "match-move-committed":
          dispatch({ type: "move-committed", event: event.payload });
          break;
        case "match-clock-sync":
          dispatch({ type: "clock-sync", event: event.payload });
          break;
        case "match-ended":
          dispatch({ type: "ended", event: event.payload });
          break;
        case "match-found":
          dispatch({ type: "snapshot", snapshot: event.payload.snapshot });
          break;
        case "recoverable-error":
          dispatch({ type: "notice", notice: event.payload.message });
          break;
        case "fatal-error":
          dispatch({ type: "phase", phase: "lost" });
          dispatch({ type: "notice", notice: event.payload.message });
          break;
        case "invalid-payload":
          dispatch({ type: "discarded", reason: "The server sent something unreadable" });
          break;
        case "connected":
          setConnectionEpoch((epoch) => epoch + 1);
          break;
        case "reconnecting":
        case "disconnected":
          dispatch({ type: "phase", phase: "reconnecting" });
          break;
        case "session-ready":
        case "queue-status":
        case "rematch-status":
          break;
      }
    });

    // A view that mounts on an established connection gets no `connect` event, so
    // it opens itself; every later opening is driven by the transport.
    if (socket.isConnected()) {
      setConnectionEpoch((epoch) => epoch + 1);
    }

    return unsubscribe;
  }, [socket]);

  useEffect(() => {
    if (connectionEpoch === 0) {
      return;
    }

    let cancelled = false;

    async function open(): Promise<void> {
      dispatch({ type: "phase", phase: "authenticating" });
      try {
        await socket.authenticate();
      } catch {
        if (!cancelled) {
          dispatch({ type: "phase", phase: "lost" });
          dispatch({ type: "notice", notice: "The connection was refused" });
        }
        return;
      }
      if (cancelled) {
        return;
      }
      dispatch({ type: "phase", phase: "ready" });

      if (matchId === null) {
        return;
      }
      await resync(socket, matchId, dispatch);
      if (!cancelled) {
        await retryPending(socket, stateRef.current.pending, dispatch);
      }
    }

    void open();
    return () => {
      cancelled = true;
    };
  }, [socket, matchId, connectionEpoch]);

  useEffect(() => {
    if (!state.resyncRequired || matchId === null || state.phase !== "ready") {
      return;
    }
    void resync(socket, matchId, dispatch);
  }, [socket, matchId, state.resyncRequired, state.phase]);

  const submitMove = useCallback(
    (move: Move) => {
      const snapshot = stateRef.current.snapshot;
      if (!snapshot || isInputLocked(stateRef.current)) {
        return;
      }
      const command: PendingCommand = {
        kind: "move",
        commandId: newCommandId(),
        matchId: snapshot.matchId,
        expectedVersion: snapshot.version,
        move,
        sentAt: Date.now(),
      };
      dispatch({ type: "command-sent", command });
      void send(socket, command, dispatch);
    },
    [socket],
  );

  const resign = useCallback(() => {
    const snapshot = stateRef.current.snapshot;
    if (!snapshot || isInputLocked(stateRef.current)) {
      return;
    }
    const command: PendingCommand = {
      kind: "resign",
      commandId: newCommandId(),
      matchId: snapshot.matchId,
      expectedVersion: snapshot.version,
      move: null,
      sentAt: Date.now(),
    };
    dispatch({ type: "command-sent", command });
    void send(socket, command, dispatch);
  }, [socket]);

  const select = useCallback((selection: Selection | null) => {
    dispatch({ type: "select", selection });
  }, []);

  const dismissNotice = useCallback(() => {
    dispatch({ type: "notice", notice: null });
  }, []);

  return {
    state,
    view: previewSnapshot(state),
    inputLocked: isInputLocked(state),
    submitMove,
    resign,
    select,
    dismissNotice,
  };
}

type Dispatch = (action: Parameters<typeof matchChannelReducer>[1]) => void;

async function resync(socket: MatchSocket, matchId: string, dispatch: Dispatch): Promise<void> {
  try {
    const ack = await socket.sync(matchId);
    if (ack.ok) {
      dispatch({ type: "snapshot", snapshot: ack.snapshot });
      return;
    }
    dispatch({ type: "phase", phase: "lost" });
    dispatch({ type: "notice", notice: "This match is no longer available" });
  } catch {
    dispatch({ type: "resynced" });
    dispatch({ type: "notice", notice: "The match could not be refreshed" });
  }
}

/**
 * A command is retried at most once per reconnection and only while the held
 * snapshot still shows it was not applied, so the same intent keeps one
 * `commandId` and the server's idempotency does the rest (docs/adr/0011).
 */
function retryPending(
  socket: MatchSocket,
  pending: PendingCommand | null,
  dispatch: Dispatch,
): Promise<void> {
  return pending === null ? Promise.resolve() : send(socket, pending, dispatch);
}

async function send(
  socket: MatchSocket,
  command: PendingCommand,
  dispatch: Dispatch,
): Promise<void> {
  try {
    const ack = await (command.move === null
      ? socket.resign(command)
      : socket.submitMove({ ...command, move: command.move }));
    dispatch({ type: "command-answered", ack });
  } catch {
    dispatch({ type: "notice", notice: "The move has not been acknowledged yet" });
  }
}
