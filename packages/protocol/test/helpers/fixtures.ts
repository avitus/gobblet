import { applyMove, createInitialGame, toSerializableGameState } from "@gobblet/game-core";
import type { GameState, Move } from "@gobblet/game-core";
import type { MatchClocks, MatchPlayer, MatchSnapshot } from "../../src/index";

export const MATCH_ID = "9f0c8c8e-1d1b-4d1c-9a3d-1f3f2b7e55aa";
export const COMMAND_ID = "b3c1f0a4-6f2c-4c53-9b0f-4c0c31d4a111";
export const LIGHT_ACTOR_ID = "1f6a1d24-9c2f-4a8f-8f60-3f3d1c6f0aa1";
export const DARK_ACTOR_ID = "2c7b2e35-ad30-4b90-9071-4a4e2d7f1bb2";

export function applyOrThrow(state: GameState, move: Move): GameState {
  const result = applyMove(state, move);
  if (!result.ok) {
    throw new Error(`fixture move rejected by the engine: ${result.reason}`);
  }
  return result.state;
}

export const midGame = applyOrThrow(
  applyOrThrow(createInitialGame("light"), { kind: "reserve", reserveStack: 0, to: "r0c0" }),
  { kind: "reserve", reserveStack: 0, to: "r3c3" },
);

export const lightPlayer: MatchPlayer = {
  actorId: LIGHT_ACTOR_ID,
  actorType: "user",
  displayName: "ada",
  isGuest: false,
  rating: 1243,
};

export const darkPlayer: MatchPlayer = {
  actorId: DARK_ACTOR_ID,
  actorType: "guest",
  displayName: "guest-7f21",
  isGuest: true,
  rating: null,
};

export const clocks: MatchClocks = {
  lightRemainingMs: 214300,
  darkRemainingMs: 187500,
  turnStartedAt: 1753392000000,
  serverTime: 1753392003250,
};

export function buildSnapshot(overrides: Partial<MatchSnapshot> = {}): MatchSnapshot {
  return {
    matchId: MATCH_ID,
    version: 18,
    status: "active",
    mode: "ranked",
    timeControlSeconds: 300,
    players: { light: lightPlayer, dark: darkPlayer },
    state: toSerializableGameState(createInitialGame("light")),
    activePlayer: "light",
    clocks,
    result: null,
    lastMove: null,
    ...overrides,
  };
}
