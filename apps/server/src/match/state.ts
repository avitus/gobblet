import { createHash } from "node:crypto";
import {
  fromSerializableGameState,
  serializeGameState,
  toSerializableGameState,
} from "@gobblet/game-core";
import type { GameState, Player } from "@gobblet/game-core";
import type { SerializedGameState } from "@gobblet/protocol";
import type { MatchEndReason, MatchResultOutcome } from "@gobblet/protocol";

export function readGameState(stored: unknown): GameState {
  return fromSerializableGameState(stored);
}

export function writeGameState(state: GameState): SerializedGameState {
  return toSerializableGameState(state);
}

/** Detects silent state corruption between stored snapshots and the event log. */
export function gameStateHash(state: GameState): string {
  return createHash("sha256").update(serializeGameState(state)).digest("hex");
}

export type RulesOutcome = Readonly<{
  outcome: MatchResultOutcome;
  reason: MatchEndReason;
}>;

/**
 * Translates a terminal engine status into the match level result. Timeouts and
 * resignations are runtime concerns and never appear in the engine status.
 */
export function outcomeOfGameState(state: GameState): RulesOutcome | null {
  switch (state.status.kind) {
    case "in-progress":
      return null;
    case "win":
      return { outcome: state.status.winner, reason: state.status.reason };
    case "draw":
      return { outcome: "draw", reason: "repetition" };
  }
}

export function opponentOutcome(loser: Player): MatchResultOutcome {
  return loser === "light" ? "dark" : "light";
}
