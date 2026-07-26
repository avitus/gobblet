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
/** The playing surface, which every piece stands on and every tile is drawn on. */
export const BOARD_SURFACE_HEIGHT = 0;
export const RESERVE_ROW_OFFSET = 2.4;
export const RESERVE_PITCH = 1.1;
/**
 * The board is a single slab that carries the grid and both reserve rows, so every
 * piece stands on one surface: separate trays either cut into the frame or left a
 * reserve piece hanging over its edge. The slab reaches past the outer reserve row
 * far enough to seat the largest piece (appendix P5.18).
 */
export const BOARD_SLAB_WIDTH = SQUARE_PITCH * 4.1;
export const BOARD_SLAB_DEPTH = (RESERVE_ROW_OFFSET + 0.5) * 2;
/** Depth of the inlay that marks a reserve row, kept clear of the outer squares. */
export const RESERVE_ZONE_DEPTH = 0.8;
export const TABLE_SPAN = 24;

export type Vector3 = readonly [number, number, number];

/**
 * Piece radius at the open base, which is the widest part, and total height. The
 * steps are wide enough to read at the fixed camera angle, which appendix P5.18
 * records: a player must be able to tell the four sizes apart at a glance.
 */
export const PIECE_DIMENSIONS = Object.freeze({
  1: { radius: 0.15, height: 0.24 },
  2: { radius: 0.23, height: 0.34 },
  3: { radius: 0.31, height: 0.46 },
  4: { radius: 0.39, height: 0.6 },
} as const);

/** How much narrower a piece is at its closed top than at its open base. */
export const PIECE_TAPER = 0.86;

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
    BOARD_SURFACE_HEIGHT,
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
    BOARD_SURFACE_HEIGHT,
    RESERVE_ROW_OFFSET * side,
  ];
}

/** Lifts a position by the selection lift, used for hover and selection feedback. */
export const SELECTION_LIFT = 0.35;

export function lift(position: Vector3, amount = SELECTION_LIFT): Vector3 {
  return [position[0], position[1] + amount, position[2]];
}

/** Radius and depth of the grooves turned into a piece's wall. */
export const GROOVE_DEPTH = 0.018;
export const GROOVE_HALF_HEIGHT = 0.012;

/**
 * Heights of the grooves on a piece's wall: one groove for the smallest piece and
 * four for the largest, so size is legible from the piece itself and not only from
 * its proportions (appendix P5.18).
 */
export function grooveHeights(size: PieceSizeKey): readonly number[] {
  const { height } = PIECE_DIMENSIONS[size];
  const span = height * 0.55;
  return Array.from({ length: size }, (_, index) => {
    const step = (index + 1) / (size + 1);
    return height * 0.2 + span * step;
  });
}

export type ProfilePoint = readonly [radius: number, height: number];

/**
 * The silhouette of a piece, to be revolved around the vertical axis. It begins and
 * ends on the axis, so the surface it makes is closed and a piece looks solid from
 * every angle: an open-ended cylinder showed the inside of its far wall and read as
 * half a cup.
 */
export function pieceProfile(size: PieceSizeKey): readonly ProfilePoint[] {
  const { radius, height } = PIECE_DIMENSIONS[size];
  const top = radius * PIECE_TAPER;
  const wallBase = 0.02;
  const wallTop = height - 0.06;
  const wallRadius = (at: number): number =>
    radius + ((top - radius) * (at - wallBase)) / (wallTop - wallBase);

  const grooves = grooveHeights(size).flatMap((at): ProfilePoint[] => [
    [wallRadius(at - GROOVE_HALF_HEIGHT), at - GROOVE_HALF_HEIGHT],
    [wallRadius(at) - GROOVE_DEPTH, at],
    [wallRadius(at + GROOVE_HALF_HEIGHT), at + GROOVE_HALF_HEIGHT],
  ]);

  return [
    [0, 0],
    [radius * 0.94, 0],
    [radius, wallBase],
    ...grooves,
    [top, wallTop],
    [top + 0.015, height - 0.045],
    [top - 0.005, height - 0.012],
    [top * 0.82, height],
    [0, height],
  ];
}

/** The inlaid disc on a piece's closed top, whose width is a further size cue. */
export function inlayRadius(size: PieceSizeKey): number {
  return PIECE_DIMENSIONS[size].radius * PIECE_TAPER * 0.62;
}
