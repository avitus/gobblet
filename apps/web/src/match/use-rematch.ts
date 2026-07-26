import type { RematchRejectionReason, RematchStatusEvent } from "@gobblet/protocol";
import { useCallback, useEffect, useState } from "react";
import { useSocket } from "./provider";
import type { MatchSocketEvent } from "./socket";

export type RematchView = Readonly<{
  status: RematchStatusEvent | null;
  /** True while this connection is the one waiting for an answer. */
  offeredByMe: boolean;
  pending: boolean;
  notice: string | null;
  nextMatchId: string | null;
  offer: () => void;
  respond: (accept: boolean) => void;
}>;

const REFUSAL_MESSAGES: Readonly<Record<RematchRejectionReason, string>> = Object.freeze({
  "not-authorized": "Sign in again to offer a rematch",
  "not-participant": "Only the two players may offer a rematch",
  "match-not-ended": "The match is still running",
  "already-offered": "An offer is already waiting",
  "no-offer": "There is no offer to answer",
  "opponent-gone": "Your opponent has left",
  ineligible: "A rematch of this match is not available",
});

/**
 * Rematch offers for one finished match (docs/product-spec.md section 4.5). The
 * offer belongs to the match that ended, and the accepted state carries the id of
 * the match that replaced it.
 */
export function useRematch(matchId: string | null, actorId: string | null): RematchView {
  const socket = useSocket();
  const [status, setStatus] = useState<RematchStatusEvent | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setStatus(null);
    setNotice(null);
    setPending(false);
  }, [matchId]);

  useEffect(
    () =>
      socket.subscribe((event: MatchSocketEvent) => {
        if (event.type !== "rematch-status" || event.payload.matchId !== matchId) {
          return;
        }
        setStatus(event.payload);
        setPending(false);
      }),
    [socket, matchId],
  );

  const act = useCallback(
    (run: (id: string) => Promise<{ ok: boolean; reason?: RematchRejectionReason }>) => {
      if (matchId === null) {
        return;
      }
      setNotice(null);
      setPending(true);
      void (async () => {
        try {
          const ack = await run(matchId);
          if (!ack.ok && ack.reason !== undefined) {
            setNotice(REFUSAL_MESSAGES[ack.reason]);
          }
        } catch {
          setNotice("The rematch offer was not acknowledged");
        } finally {
          setPending(false);
        }
      })();
    },
    [matchId],
  );

  const offer = useCallback(() => {
    act(async (id) => {
      const ack = await socket.requestRematch(id);
      return ack.ok ? { ok: true } : { ok: false, reason: ack.reason };
    });
  }, [act, socket]);

  const respond = useCallback(
    (accept: boolean) => {
      act(async (id) => {
        const ack = await socket.respondToRematch(id, accept);
        return ack.ok ? { ok: true } : { ok: false, reason: ack.reason };
      });
    },
    [act, socket],
  );

  return {
    status,
    offeredByMe: status?.state === "offered" && status.requestedBy === actorId,
    pending,
    notice,
    nextMatchId: status?.state === "accepted" ? status.nextMatchId : null,
    offer,
    respond,
  };
}
