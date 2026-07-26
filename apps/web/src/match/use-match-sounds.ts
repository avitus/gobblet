import { fromSerializableGameState } from "@gobblet/game-core";
import type { SoundCue } from "@gobblet/game-ui";
import type { Move } from "@gobblet/protocol";
import type { MatchEndedEvent, MatchSnapshot, Player } from "@gobblet/protocol";
import { useEffect, useRef } from "react";
import { useSoundEngine } from "../sound/provider";

export type MatchSoundsInput = Readonly<{
  snapshot: MatchSnapshot | null;
  ended: MatchEndedEvent | null;
  seat: Player | null;
  /** True while the local player's clock is inside the low-time threshold. */
  lowTime: boolean;
}>;

/**
 * Maps what changed in the match onto the sounds of section 13.5. One sound per
 * commit, chosen by how much it tells the player: a reveal outranks a gobble, and a
 * gobble outranks a plain placement.
 */
export function useMatchSounds(input: MatchSoundsInput): void {
  const engine = useSoundEngine();
  const previous = useRef<MatchSnapshot | null>(null);
  const endedPlayed = useRef<string | null>(null);
  const lowTimePlayed = useRef(false);

  useEffect(() => {
    const { snapshot } = input;
    const before = previous.current;
    previous.current = snapshot;

    if (snapshot === null || before === null || snapshot.matchId !== before.matchId) {
      return;
    }
    if (snapshot.version <= before.version || snapshot.lastMove === null) {
      return;
    }
    engine.play(cueForMove(before, snapshot.lastMove.move));
  }, [engine, input]);

  useEffect(() => {
    const { ended, seat } = input;
    if (ended === null || endedPlayed.current === ended.matchId) {
      return;
    }
    endedPlayed.current = ended.matchId;
    engine.play(cueForResult(ended, seat));
  }, [engine, input]);

  // Strict mode runs an effect twice, so the crossing is remembered rather than
  // trusted to the dependency change alone.
  useEffect(() => {
    if (!input.lowTime) {
      lowTimePlayed.current = false;
      return;
    }
    if (!lowTimePlayed.current) {
      lowTimePlayed.current = true;
      engine.play("low-time");
    }
  }, [engine, input.lowTime]);
}

function cueForMove(before: MatchSnapshot, move: Move): SoundCue {
  const board = fromSerializableGameState(before.state).board;
  if (move.kind === "board" && board[move.from].length > 1) {
    return "reveal";
  }
  return board[move.to].length > 0 ? "gobble" : "placement";
}

function cueForResult(ended: MatchEndedEvent, seat: Player | null): SoundCue {
  if (ended.result === "draw") {
    return "draw";
  }
  if (seat === null) {
    return "win";
  }
  return ended.result === seat ? "win" : "loss";
}
