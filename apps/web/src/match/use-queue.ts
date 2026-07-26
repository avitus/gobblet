import type {
  MatchFoundEvent,
  QueueKey,
  QueueRejectionReason,
  QueueStatus,
} from "@gobblet/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSocket } from "./provider";
import type { MatchSocketEvent } from "./socket";

export type QueuePhase = "idle" | "joining" | "waiting" | "matched" | "refused";

export type QueueView = Readonly<{
  phase: QueuePhase;
  status: QueueStatus | null;
  /** Set the moment a match exists, whichever of the two answers arrives first. */
  found: MatchFoundEvent | null;
  notice: string | null;
  join: (key: QueueKey) => void;
  leave: () => void;
}>;

const REFUSAL_MESSAGES: Readonly<Record<QueueRejectionReason, string>> = Object.freeze({
  "not-authorized": "Sign in again to join a queue",
  ineligible: "Ranked play needs an account with a verified email address",
  "already-in-match": "You are already in a match",
  "not-queued": "You were not in a queue",
  "queue-closed": "That queue is closed",
});

/**
 * The matchmaking side of the socket (docs/product-spec.md section 9). The
 * acknowledgement and the `match:found` announcement can arrive in either order, so
 * both are accepted and the first one wins.
 */
export function useQueue(): QueueView {
  const socket = useSocket();
  const [phase, setPhase] = useState<QueuePhase>("idle");
  const [status, setStatus] = useState<QueueStatus | null>(null);
  const [found, setFound] = useState<MatchFoundEvent | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(
    () =>
      socket.subscribe((event: MatchSocketEvent) => {
        switch (event.type) {
          case "queue-status":
            setStatus(event.payload);
            if (phaseRef.current !== "matched") {
              setPhase("waiting");
            }
            break;
          case "match-found":
            setFound(event.payload);
            setPhase("matched");
            setStatus(null);
            break;
          case "recoverable-error":
            setNotice(event.payload.message);
            break;
          case "fatal-error":
            setNotice(event.payload.message);
            setPhase("idle");
            setStatus(null);
            break;
          case "disconnected":
            if (phaseRef.current === "waiting" || phaseRef.current === "joining") {
              setPhase("idle");
              setStatus(null);
              setNotice("The connection dropped, so the search stopped");
            }
            break;
          case "session-ready":
          case "match-snapshot":
          case "match-move-committed":
          case "match-clock-sync":
          case "match-ended":
          case "rematch-status":
          case "connected":
          case "reconnecting":
          case "invalid-payload":
          case "preset-message":
          case "reaction":
            break;
        }
      }),
    [socket],
  );

  const join = useCallback(
    (key: QueueKey) => {
      setNotice(null);
      setPhase("joining");
      void (async () => {
        try {
          await socket.authenticate();
          const ack = await socket.joinQueue(key);
          if (ack.state === "queued") {
            setStatus(ack.status);
            setPhase((current) => (current === "matched" ? current : "waiting"));
            return;
          }
          if (ack.state === "matched") {
            setPhase("matched");
            return;
          }
          setPhase("refused");
          setNotice(REFUSAL_MESSAGES[ack.reason]);
        } catch {
          setPhase("idle");
          setNotice("The search could not be started");
        }
      })();
    },
    [socket],
  );

  const leave = useCallback(() => {
    setPhase("idle");
    setStatus(null);
    void (async () => {
      try {
        const ack = await socket.leaveQueue();
        if (!ack.ok && ack.reason !== "not-queued") {
          setNotice(REFUSAL_MESSAGES[ack.reason]);
        }
      } catch {
        setNotice("The search could not be stopped");
      }
    })();
  }, [socket]);

  return { phase, status, found, notice, join, leave };
}
