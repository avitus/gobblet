import { LINES } from "./board-geometry";
import { RESERVE_GOBBLE_THREAT_COUNT } from "./constants";
import { PIECE_BY_ID } from "./pieces";
import type {
  BoardState,
  GameState,
  PieceId,
  PieceSize,
  Player,
  Square,
  SquareStack,
  WinningLine,
} from "./types";

export function topPieceOnBoard(board: BoardState, square: Square): PieceId | null {
  return board[square].at(-1) ?? null;
}

export function visibleOwnerOnBoard(board: BoardState, square: Square): Player | null {
  const top = topPieceOnBoard(board, square);
  return top === null ? null : PIECE_BY_ID[top].owner;
}

export function visibleSizeOnBoard(board: BoardState, square: Square): PieceSize | null {
  const top = topPieceOnBoard(board, square);
  return top === null ? null : PIECE_BY_ID[top].size;
}

/** Every line whose four visible pieces all belong to `player`. */
export function winningLinesOnBoard(board: BoardState, player: Player): readonly WinningLine[] {
  const winning: WinningLine[] = [];

  for (const line of LINES) {
    const pieces: PieceId[] = [];
    for (const square of line.squares) {
      const top = topPieceOnBoard(board, square);
      if (top === null || PIECE_BY_ID[top].owner !== player) {
        break;
      }
      pieces.push(top);
    }

    if (pieces.length === line.squares.length) {
      winning.push({
        id: line.id,
        kind: line.kind,
        index: line.index,
        squares: line.squares,
        player,
        pieces: pieces as unknown as WinningLine["pieces"],
      });
    }
  }

  return winning;
}

/**
 * True when `square` belongs to a line in which `player` already shows exactly
 * three visible pieces. This is the precondition of the official defensive
 * exception that lets a reserve piece cover an opponent piece.
 */
export function hasThreeInLineThrough(board: BoardState, player: Player, square: Square): boolean {
  for (const line of LINES) {
    let containsSquare = false;
    let visible = 0;

    for (const lineSquare of line.squares) {
      if (lineSquare === square) {
        containsSquare = true;
      }
      if (visibleOwnerOnBoard(board, lineSquare) === player) {
        visible += 1;
      }
    }

    if (containsSquare && visible === RESERVE_GOBBLE_THREAT_COUNT) {
      return true;
    }
  }

  return false;
}

export function getStack(state: GameState, square: Square): SquareStack {
  return state.board[square];
}

export function getVisiblePieceId(state: GameState, square: Square): PieceId | null {
  return topPieceOnBoard(state.board, square);
}

export function getVisibleOwner(state: GameState, square: Square): Player | null {
  return visibleOwnerOnBoard(state.board, square);
}

export function getVisibleSize(state: GameState, square: Square): PieceSize | null {
  return visibleSizeOnBoard(state.board, square);
}

export function getWinningLines(state: GameState, player: Player): readonly WinningLine[] {
  return winningLinesOnBoard(state.board, player);
}
