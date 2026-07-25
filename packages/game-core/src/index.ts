/**
 * `@gobblet/game-core` is the single authoritative implementation of the standard
 * 4x4 Gobblet rules. It is pure: no I/O, no framework imports, no wall-clock
 * reads, no randomness, and every returned state is deeply frozen.
 *
 * See docs/rules.md for the formal rule statement and docs/adr/0012 for why the
 * engine is shared by client and server instead of duplicated.
 */

export type * from "./types";

export {
  BOARD_DIMENSION,
  GAME_STATE_VERSION,
  LINE_LENGTH,
  PIECES_PER_PLAYER,
  PIECES_PER_RESERVE_STACK,
  POSITION_KEY_VERSION,
  REPETITION_LIMIT,
  RESERVE_GOBBLE_THREAT_COUNT,
  RESERVE_STACKS_PER_PLAYER,
  TOTAL_PIECES,
} from "./constants";

export { LINES, SQUARES, isSquare, squareAt } from "./board-geometry";

export {
  PIECES,
  PIECE_BY_ID,
  PIECE_SIZES,
  RESERVE_STACK_INDEXES,
  getPiece,
  isPieceId,
  isReserveStackIndex,
  reserveStackPieceIds,
} from "./pieces";

export { PLAYERS, PLAYER_BY_CODE, PLAYER_CODES, isPlayer, otherPlayer } from "./players";

export {
  getStack,
  getVisibleOwner,
  getVisiblePieceId,
  getVisibleSize,
  getWinningLines,
  hasThreeInLineThrough,
  topPieceOnBoard,
  visibleOwnerOnBoard,
  visibleSizeOnBoard,
  winningLinesOnBoard,
} from "./board";

export {
  createEmptyBoard,
  createFullReserves,
  createInitialGame,
  getExposedReservePieceId,
  getReserveStack,
  isGameOver,
} from "./game";

export { applyMove, enumerateMoves, evaluateMove } from "./moves";

export { canonicalPositionKey, positionKeyOf } from "./position-key";

export {
  assertGameStateInvariants,
  assertTransitionInvariants,
  collectInvariantViolations,
  collectTransitionViolations,
} from "./invariants";

export {
  deserializeGameState,
  fromSerializableGameState,
  serializeGameState,
  toSerializableGameState,
} from "./serialization";

export {
  GameCoreError,
  GameCoreInvariantError,
  GameCoreSerializationError,
  GameCoreTransitionError,
} from "./errors";
