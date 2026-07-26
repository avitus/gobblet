import { SQUARES } from "@gobblet/game-core";
import type { Player, ReserveStackIndex, Square } from "@gobblet/game-core";

/**
 * The procedural board of ADR-0022, expressed as numbers rather than a model file
 * so no binary asset is needed in this phase. A licensed asset set replaces the
 * geometry without touching these coordinates.
 */
export const SQUARE_PITCH = 1;
export const BOARD_HALF_SPAN = (SQUARE_PITCH * 3) / 2;
export const BOARD_THICKNESS = 0.18;
export const RESERVE_ROW_OFFSET = 3.05;
export const RESERVE_PITCH = 1.1;

export type Vector3 = readonly [number, number, number];

/** Piece radius and height by size, in board units. */
export const PIECE_DIMENSIONS = Object.freeze({
  1: { radius: 0.16, height: 0.24 },
  2: { radius: 0.24, height: 0.34 },
  3: { radius: 0.32, height: 0.44 },
  4: { radius: 0.4, height: 0.54 },
} as const);

export type PieceSizeKey = keyof typeof PIECE_DIMENSIONS;

export function squareIndex(square: Square): number {
  return SQUARES.indexOf(square);
}

/** Centre of a square in world space, with light seated towards positive z. */
export function squarePosition(square: Square): Vector3 {
  const index = squareIndex(square);
  const row = Math.floor(index / 4);
  const column = index % 4;
  return [
    column * SQUARE_PITCH - BOARD_HALF_SPAN,
    BOARD_THICKNESS / 2,
    row * SQUARE_PITCH - BOARD_HALF_SPAN,
  ];
}

/**
 * Centre of an external reserve stack. Light sits nearest positive z, which the
 * camera rig mirrors for a player seated as dark (appendix P5.3).
 */
export function reservePosition(owner: Player, reserveStack: ReserveStackIndex): Vector3 {
  const side = owner === "light" ? 1 : -1;
  return [
    (reserveStack - 1) * RESERVE_PITCH * side,
    BOARD_THICKNESS / 2,
    RESERVE_ROW_OFFSET * side,
  ];
}

/** Lifts a position by the selection lift, used for hover and selection feedback. */
export const SELECTION_LIFT = 0.35;

export function lift(position: Vector3, amount = SELECTION_LIFT): Vector3 {
  return [position[0], position[1] + amount, position[2]];
}
