import { createInitialGame, toSerializableGameState } from "@gobblet/game-core";
import type { MatchSnapshot } from "@gobblet/protocol";

export const MATCH_ID = "11111111-1111-4111-8111-111111111111";
export const LIGHT_ACTOR_ID = "22222222-2222-4222-8222-222222222222";
export const DARK_ACTOR_ID = "33333333-3333-4333-8333-333333333333";

const SERVER_TIME = 1_800_000_000_000;

/** A snapshot of a fresh match, as `match:sync` would return it. */
export function makeSnapshot(overrides: Partial<MatchSnapshot> = {}): MatchSnapshot {
  return {
    matchId: MATCH_ID,
    version: 0,
    status: "active",
    mode: "casual",
    timeControlSeconds: 300,
    players: {
      light: {
        actorId: LIGHT_ACTOR_ID,
        actorType: "user",
        displayName: "ada",
        isGuest: false,
        rating: 1200,
      },
      dark: {
        actorId: DARK_ACTOR_ID,
        actorType: "guest",
        displayName: "Guest 1234",
        isGuest: true,
        rating: null,
      },
    },
    state: toSerializableGameState(createInitialGame("light")),
    activePlayer: "light",
    clocks: {
      lightRemainingMs: 300_000,
      darkRemainingMs: 300_000,
      turnStartedAt: SERVER_TIME,
      serverTime: SERVER_TIME,
    },
    result: null,
    lastMove: null,
    ...overrides,
  };
}

export { SERVER_TIME };
