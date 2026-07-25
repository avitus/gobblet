import { PLAYERS, PLAYER_CODES } from "./players";
import type { Piece, PieceId, PieceSize, ReserveStackIndex } from "./types";

export const PIECE_SIZES: readonly [PieceSize, PieceSize, PieceSize, PieceSize] = [1, 2, 3, 4];

export const RESERVE_STACK_INDEXES: readonly [
  ReserveStackIndex,
  ReserveStackIndex,
  ReserveStackIndex,
] = [0, 1, 2];

function buildPieces(): {
  readonly all: readonly Piece[];
  readonly byId: Readonly<Record<PieceId, Piece>>;
} {
  const all: Piece[] = [];
  const byId = {} as Record<PieceId, Piece>;

  for (const owner of PLAYERS) {
    for (const reserveStack of RESERVE_STACK_INDEXES) {
      for (const size of PIECE_SIZES) {
        const piece: Piece = Object.freeze({
          id: `${PLAYER_CODES[owner]}${reserveStack}${size}`,
          owner,
          size,
          reserveStack,
        });
        all.push(piece);
        byId[piece.id] = piece;
      }
    }
  }

  return { all: Object.freeze(all), byId: Object.freeze(byId) };
}

const pieceRegistry = buildPieces();

/** All 24 pieces, ordered light before dark, then by external stack, then by size. */
export const PIECES: readonly Piece[] = pieceRegistry.all;

export const PIECE_BY_ID: Readonly<Record<PieceId, Piece>> = pieceRegistry.byId;

export function isReserveStackIndex(value: unknown): value is ReserveStackIndex {
  return value === 0 || value === 1 || value === 2;
}

export function isPieceId(value: unknown): value is PieceId {
  return typeof value === "string" && Object.hasOwn(PIECE_BY_ID, value);
}

export function getPiece(id: PieceId): Piece {
  return PIECE_BY_ID[id];
}

/** Pieces of one external stack ordered bottom to top, so the largest is exposed last. */
export function reserveStackPieceIds(
  owner: Piece["owner"],
  reserveStack: ReserveStackIndex,
): readonly PieceId[] {
  return PIECE_SIZES.map((size): PieceId => `${PLAYER_CODES[owner]}${reserveStack}${size}`);
}
