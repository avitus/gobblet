import type {
  CommunicationAck,
  MuteState,
  Player,
  PresetMessageKey,
  ReactionKey,
} from "@gobblet/protocol";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSettingsStore } from "../settings/store";
import { useSoundEngine } from "../sound/provider";
import { COMMUNICATION_REFUSALS, appendFeedItem } from "./communication";
import type { FeedItem } from "./communication";
import { useSocket } from "./provider";
import type { MatchSocketEvent } from "./socket";

export type CommunicationView = Readonly<{
  /** The last few exchanges, oldest first. Nothing older is kept anywhere. */
  feed: readonly FeedItem[];
  mutes: MuteState;
  notice: string | null;
  sendMessage: (messageKey: PresetMessageKey) => void;
  sendReaction: (reactionKey: ReactionKey) => void;
  setMutes: (mutes: MuteState) => void;
  dismissNotice: () => void;
}>;

/**
 * Preset messages and reactions for one match (spec section 12). The client sends
 * keys and renders what the server relays back, including its own echo; mute is a
 * request to the server to withhold rather than a filter applied here
 * (docs/adr/0026-communication-is-relayed-never-stored.md).
 */
export function useCommunication(matchId: string, seat: Player | null): CommunicationView {
  const socket = useSocket();
  const engine = useSoundEngine();
  const presetMessagesMuted = useSettingsStore((state) => state.presetMessagesMuted);
  const reactionsMuted = useSettingsStore((state) => state.reactionsMuted);
  const update = useSettingsStore((state) => state.update);

  const [feed, setFeed] = useState<readonly FeedItem[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [connectionEpoch, setConnectionEpoch] = useState(0);
  const counter = useRef(0);
  const seatRef = useRef(seat);
  seatRef.current = seat;

  const mutes = useMemo<MuteState>(
    () => ({ presetMessagesMuted, reactionsMuted }),
    [presetMessagesMuted, reactionsMuted],
  );

  useEffect(() => {
    setFeed([]);
    setNotice(null);
  }, [matchId]);

  useEffect(() => {
    const add = (item: Omit<FeedItem, "id">): void => {
      counter.current += 1;
      const id = String(counter.current);
      setFeed((current) => appendFeedItem(current, { ...item, id }));
    };

    const unsubscribe = socket.subscribe((event: MatchSocketEvent) => {
      if (event.type === "connected") {
        setConnectionEpoch((epoch) => epoch + 1);
        return;
      }
      if (event.type === "preset-message" && event.payload.matchId === matchId) {
        add({
          from: event.payload.from,
          mine: event.payload.from === seatRef.current,
          body: { kind: "message", messageKey: event.payload.messageKey },
        });
        return;
      }
      if (event.type === "reaction" && event.payload.matchId === matchId) {
        add({
          from: event.payload.from,
          mine: event.payload.from === seatRef.current,
          body: { kind: "reaction", reactionKey: event.payload.reactionKey },
        });
        // A muted reaction never arrives, so whatever is delivered is meant to be
        // heard, the player's own echo included (appendix P6.14).
        engine.play("reaction");
      }
    });

    if (socket.isConnected()) {
      setConnectionEpoch((epoch) => epoch + 1);
    }

    return unsubscribe;
  }, [socket, matchId, engine]);

  /**
   * The server holds the mute state of the connection, seeded from the profile, so
   * every connection is told what this browser prefers. A refusal is not shown here
   * because it answers no action the player took.
   */
  useEffect(() => {
    if (seat === null || connectionEpoch === 0) {
      return;
    }
    void (async () => {
      try {
        await socket.authenticate();
        await socket.setMuteState(matchId, mutes);
      } catch {
        // The match channel is what reports a connection that will not open.
      }
    })();
  }, [socket, matchId, seat, mutes, connectionEpoch]);

  const send = useCallback(
    (run: (id: string) => Promise<CommunicationAck>) => {
      setNotice(null);
      void (async () => {
        try {
          const ack = await run(matchId);
          if (!ack.ok) {
            setNotice(COMMUNICATION_REFUSALS[ack.reason]);
          }
        } catch {
          setNotice("That was not acknowledged");
        }
      })();
    },
    [matchId],
  );

  const sendMessage = useCallback(
    (messageKey: PresetMessageKey) => {
      send((id) => socket.sendPresetMessage(id, messageKey));
    },
    [send, socket],
  );

  const sendReaction = useCallback(
    (reactionKey: ReactionKey) => {
      send((id) => socket.sendReaction(id, reactionKey));
    },
    [send, socket],
  );

  const setMutes = useCallback(
    (next: MuteState) => {
      update(next);
    },
    [update],
  );

  const dismissNotice = useCallback(() => {
    setNotice(null);
  }, []);

  return { feed, mutes, notice, sendMessage, sendReaction, setMutes, dismissNotice };
}
