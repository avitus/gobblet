import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  PIECES,
  PIECE_BY_ID,
  PLAYERS,
  RESERVE_STACK_INDEXES,
  SQUARES,
  TOTAL_PIECES,
  applyMove,
  canonicalPositionKey,
  collectInvariantViolations,
  createInitialGame,
  deserializeGameState,
  enumerateMoves,
  evaluateMove,
  getStack,
  getWinningLines,
  isGameOver,
  serializeGameState,
} from "../src/index";
import type { GameState, Move, PieceId, Player } from "../src/index";
import { boardMove, reserveMove } from "./helpers/build-state";

/**
 * Pull requests run a small deterministic seed set. `GOBBLET_PROPERTY_MODE=nightly`
 * (the `test:properties:nightly` script) raises the depth to 100000 generated
 * transitions, and `GOBBLET_PROPERTY_TRANSITIONS` overrides both.
 */
const DEFAULT_TRANSITIONS = process.env.GOBBLET_PROPERTY_MODE === "nightly" ? 100_000 : 2_000;
const TARGET_TRANSITIONS = Number(
  process.env.GOBBLET_PROPERTY_TRANSITIONS ?? String(DEFAULT_TRANSITIONS),
);
const BATCH_RUNS = 40;
const MAX_PLIES = 250;
const BASE_SEED = 20260724;
const NIGHTLY_TIMEOUT_MS = 30 * 60 * 1000;

/** Seeds that once produced a failure. Never remove entries, only add. */
const RECORDED_REGRESSION_SEEDS: readonly { seed: number; note: string }[] = [
  { seed: BASE_SEED, note: "default pull request seed" },
];

type PlayedGame = {
  readonly firstPlayer: Player;
  readonly states: readonly GameState[];
  readonly moves: readonly Move[];
  readonly stuck: boolean;
};

function playGame(firstPlayer: Player, choices: readonly number[]): PlayedGame {
  let state = createInitialGame(firstPlayer);
  const states: GameState[] = [state];
  const moves: Move[] = [];
  let stuck = false;

  for (const choice of choices) {
    if (isGameOver(state)) {
      break;
    }

    const legal = enumerateMoves(state);
    if (legal.length === 0) {
      // Recorded as an open question in docs/rules.md: the printed rules do not
      // describe a position without a legal move, and no generated game has
      // reached one so far.
      stuck = true;
      break;
    }

    const candidate = legal[choice % legal.length]!;
    const result = applyMove(state, candidate.move);
    if (!result.ok) {
      throw new Error(`enumerated move was rejected with ${result.reason}`);
    }

    state = result.state;
    states.push(state);
    moves.push(candidate.move);
  }

  return { firstPlayer, states, moves, stuck };
}

function pieceInventory(state: GameState): readonly PieceId[] {
  const onBoard = SQUARES.flatMap((square) => [...getStack(state, square)]);
  const inReserve = PLAYERS.flatMap((player) =>
    RESERVE_STACK_INDEXES.flatMap((index) => [...state.reserves[player][index]]),
  );
  return [...onBoard, ...inReserve];
}

function assertStateIsSound(state: GameState): void {
  expect(collectInvariantViolations(state)).toEqual([]);

  const inventory = pieceInventory(state);
  expect(inventory).toHaveLength(TOTAL_PIECES);
  expect(new Set(inventory).size).toBe(TOTAL_PIECES);
  for (const player of PLAYERS) {
    expect(inventory.filter((id) => PIECE_BY_ID[id].owner === player)).toHaveLength(
      PIECES.length / 2,
    );
  }

  for (const square of SQUARES) {
    const sizes = getStack(state, square).map((id) => PIECE_BY_ID[id].size);
    for (let index = 1; index < sizes.length; index += 1) {
      expect(sizes[index]!).toBeGreaterThan(sizes[index - 1]!);
    }
  }

  if (state.status.kind === "win") {
    expect(getWinningLines(state, state.status.winner).length).toBeGreaterThan(0);
    if (state.status.reason === "line") {
      expect(state.activePlayer).toBe(state.status.winner);
    } else {
      expect(state.activePlayer).not.toBe(state.status.winner);
    }
  }

  if (isGameOver(state)) {
    expect(enumerateMoves(state)).toEqual([]);
    expect(applyMove(state, reserveMove(0, "r0c0")).ok).toBe(false);
  }
}

function assertGameIsSound(game: PlayedGame): void {
  for (const state of game.states) {
    assertStateIsSound(state);
  }

  const finalState = game.states.at(-1)!;
  expect(finalState.ply).toBe(game.moves.length);

  const replayed = game.moves.reduce<GameState>((current, move) => {
    const result = applyMove(current, move);
    if (!result.ok) {
      throw new Error(`replay rejected a recorded move with ${result.reason}`);
    }
    return result.state;
  }, createInitialGame(game.firstPlayer));

  expect(serializeGameState(replayed)).toBe(serializeGameState(finalState));
  expect(deserializeGameState(serializeGameState(finalState))).toEqual(finalState);
  expect(canonicalPositionKey(deserializeGameState(serializeGameState(finalState)))).toBe(
    canonicalPositionKey(finalState),
  );
}

function gameArbitrary(): fc.Arbitrary<PlayedGame> {
  return fc
    .record({
      firstPlayer: fc.constantFrom<Player>("light", "dark"),
      choices: fc.array(fc.nat({ max: 4096 }), { minLength: 1, maxLength: MAX_PLIES }),
    })
    .map(({ firstPlayer, choices }) => playGame(firstPlayer, choices));
}

function runBatchedProperty(
  target: number,
  check: (game: PlayedGame) => void,
): { transitions: number; batches: number; stuck: number } {
  let transitions = 0;
  let batches = 0;
  let stuck = 0;

  while (transitions < target) {
    fc.assert(
      fc.property(gameArbitrary(), (game) => {
        transitions += game.moves.length;
        stuck += game.stuck ? 1 : 0;
        check(game);
      }),
      { numRuns: BATCH_RUNS, seed: BASE_SEED + batches },
    );
    batches += 1;
  }

  return { transitions, batches, stuck };
}

describe("engine properties", () => {
  it(
    "keeps every generated position sound",
    () => {
      const { transitions, stuck } = runBatchedProperty(TARGET_TRANSITIONS, assertGameIsSound);

      expect(transitions).toBeGreaterThanOrEqual(TARGET_TRANSITIONS);
      expect(stuck).toBe(0);
    },
    NIGHTLY_TIMEOUT_MS,
  );

  it("rejects every move that was not enumerated", () => {
    fc.assert(
      fc.property(gameArbitrary(), (game) => {
        const state = game.states.at(-1)!;
        const enumerated = new Set(
          enumerateMoves(state).map((entry) => JSON.stringify(entry.move)),
        );

        for (const reserveStack of RESERVE_STACK_INDEXES) {
          for (const to of SQUARES) {
            const move = reserveMove(reserveStack, to);
            expect(evaluateMove(state, move).legal).toBe(enumerated.has(JSON.stringify(move)));
          }
        }
        for (const from of SQUARES) {
          for (const to of SQUARES) {
            const move = boardMove(from, to);
            expect(evaluateMove(state, move).legal).toBe(enumerated.has(JSON.stringify(move)));
          }
        }
      }),
      { numRuns: 25, seed: BASE_SEED },
    );
  });

  it("applies the same move to the same state deterministically", () => {
    fc.assert(
      fc.property(gameArbitrary(), (game) => {
        const state = game.states[0]!;
        const [candidate] = enumerateMoves(state);
        expect(candidate).toBeDefined();

        const first = applyMove(state, candidate!.move);
        const second = applyMove(state, candidate!.move);

        expect(first.ok && second.ok).toBe(true);
        if (first.ok && second.ok) {
          expect(serializeGameState(first.state)).toBe(serializeGameState(second.state));
          expect(first.evaluation).toEqual(second.evaluation);
        }
      }),
      { numRuns: 20, seed: BASE_SEED },
    );
  });

  it("never mutates the state that was passed in", () => {
    fc.assert(
      fc.property(gameArbitrary(), (game) => {
        const state = game.states[0]!;
        const before = serializeGameState(state);
        enumerateMoves(state);
        const [candidate] = enumerateMoves(state);
        applyMove(state, candidate!.move);
        expect(serializeGameState(state)).toBe(before);
      }),
      { numRuns: 20, seed: BASE_SEED },
    );
  });

  describe("recorded regression seeds", () => {
    for (const { seed, note } of RECORDED_REGRESSION_SEEDS) {
      it(`stays sound for seed ${seed} (${note})`, () => {
        fc.assert(fc.property(gameArbitrary(), assertGameIsSound), { numRuns: 25, seed });
      });
    }
  });
});
