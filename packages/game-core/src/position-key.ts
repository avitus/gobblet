import { SQUARES } from "./board-geometry";
import { POSITION_KEY_VERSION } from "./constants";
import { PIECE_BY_ID } from "./pieces";
import { PLAYERS, PLAYER_CODES } from "./players";
import type { BoardState, GameState, Player, ReserveState } from "./types";

const EMPTY_SQUARE_TOKEN = "-";

function encodeBoard(board: BoardState): string {
  return SQUARES.map((square) => {
    const stack = board[square];
    if (stack.length === 0) {
      return EMPTY_SQUARE_TOKEN;
    }
    return stack
      .map((id) => {
        const piece = PIECE_BY_ID[id];
        return `${PLAYER_CODES[piece.owner]}${piece.size}`;
      })
      .join("");
  }).join("/");
}

/**
 * External stacks are physically interchangeable: each one always holds sizes 1..k
 * bottom to top, so the remaining counts (ordered descending) fully describe them.
 */
function encodeReserves(reserves: ReserveState): string {
  return PLAYERS.map((player) => {
    const remaining = reserves[player].map((stack) => stack.length).sort((a, b) => b - a);
    return `${PLAYER_CODES[player]}${remaining.join("")}`;
  }).join(",");
}

/**
 * Canonical key of a physical position. Two states share a key exactly when they
 * are physically indistinguishable and the same player is to move. Clocks, ply
 * counters and piece identities are deliberately excluded.
 */
export function positionKeyOf(
  board: BoardState,
  reserves: ReserveState,
  sideToMove: Player,
): string {
  return [
    POSITION_KEY_VERSION,
    encodeBoard(board),
    encodeReserves(reserves),
    PLAYER_CODES[sideToMove],
  ].join(":");
}

export function canonicalPositionKey(state: GameState): string {
  return positionKeyOf(state.board, state.reserves, state.activePlayer);
}
