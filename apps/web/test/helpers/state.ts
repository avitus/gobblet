import { applyMove, createInitialGame, toSerializableGameState } from "@gobblet/game-core";
import type { GameState, Move, SerializedGameState } from "@gobblet/game-core";

/** Plays a sequence of moves from the opening, failing loudly on an illegal one. */
export function play(...moves: readonly Move[]): GameState {
  let state = createInitialGame("light");
  for (const move of moves) {
    const result = applyMove(state, move);
    if (!result.ok) {
      throw new Error(`illegal move in fixture: ${result.reason}`);
    }
    state = result.state;
  }
  return state;
}

export function serializedAfter(...moves: readonly Move[]): SerializedGameState {
  return toSerializableGameState(play(...moves));
}
