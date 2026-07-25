import { SQUARES } from "./board-geometry";
import { GAME_STATE_VERSION } from "./constants";
import { deepFreeze } from "./freeze";
import { reserveStackPieceIds } from "./pieces";
import { canonicalPositionKey } from "./position-key";
import type {
  BoardState,
  GameState,
  PieceId,
  Player,
  PlayerReserves,
  ReserveStack,
  ReserveStackIndex,
  ReserveState,
  Square,
  SquareStack,
} from "./types";

const EMPTY_STACK: SquareStack = Object.freeze([]);

export function createEmptyBoard(): BoardState {
  const board = {} as Record<Square, SquareStack>;
  for (const square of SQUARES) {
    board[square] = EMPTY_STACK;
  }
  return board;
}

export function createFullReserves(): ReserveState {
  const stacksFor = (player: Player): PlayerReserves => [
    reserveStackPieceIds(player, 0),
    reserveStackPieceIds(player, 1),
    reserveStackPieceIds(player, 2),
  ];

  return { light: stacksFor("light"), dark: stacksFor("dark") };
}

/**
 * Standard opening position: empty board, three full external stacks per player,
 * `firstPlayer` to move. The opening position counts as the first occurrence for
 * threefold repetition.
 */
export function createInitialGame(firstPlayer: Player): GameState {
  const opening: GameState = {
    version: GAME_STATE_VERSION,
    board: createEmptyBoard(),
    reserves: createFullReserves(),
    activePlayer: firstPlayer,
    ply: 0,
    repetition: { counts: {} },
    status: { kind: "in-progress" },
  };

  return deepFreeze({
    ...opening,
    repetition: { counts: { [canonicalPositionKey(opening)]: 1 } },
  });
}

export function isGameOver(state: GameState): boolean {
  return state.status.kind !== "in-progress";
}

export function getReserveStack(
  state: GameState,
  player: Player,
  reserveStack: ReserveStackIndex,
): ReserveStack {
  return state.reserves[player][reserveStack];
}

/** The piece a player would enter from an external stack, or null when it is empty. */
export function getExposedReservePieceId(
  state: GameState,
  player: Player,
  reserveStack: ReserveStackIndex,
): PieceId | null {
  return getReserveStack(state, player, reserveStack).at(-1) ?? null;
}
