import { deepFreeze } from "./freeze";
import type { ColumnIndex, Line, RowIndex, Square } from "./types";

/** The sixteen squares in stable canonical order: row major, top-left first. */
export const SQUARES = deepFreeze([
  "r0c0",
  "r0c1",
  "r0c2",
  "r0c3",
  "r1c0",
  "r1c1",
  "r1c2",
  "r1c3",
  "r2c0",
  "r2c1",
  "r2c2",
  "r2c3",
  "r3c0",
  "r3c1",
  "r3c2",
  "r3c3",
] as const satisfies readonly Square[]);

const SQUARE_SET: ReadonlySet<string> = new Set<string>(SQUARES);

/** The ten lines that can win the game: four rows, four columns, two diagonals. */
export const LINES = deepFreeze([
  { id: "row-0", kind: "row", index: 0, squares: ["r0c0", "r0c1", "r0c2", "r0c3"] },
  { id: "row-1", kind: "row", index: 1, squares: ["r1c0", "r1c1", "r1c2", "r1c3"] },
  { id: "row-2", kind: "row", index: 2, squares: ["r2c0", "r2c1", "r2c2", "r2c3"] },
  { id: "row-3", kind: "row", index: 3, squares: ["r3c0", "r3c1", "r3c2", "r3c3"] },
  { id: "column-0", kind: "column", index: 0, squares: ["r0c0", "r1c0", "r2c0", "r3c0"] },
  { id: "column-1", kind: "column", index: 1, squares: ["r0c1", "r1c1", "r2c1", "r3c1"] },
  { id: "column-2", kind: "column", index: 2, squares: ["r0c2", "r1c2", "r2c2", "r3c2"] },
  { id: "column-3", kind: "column", index: 3, squares: ["r0c3", "r1c3", "r2c3", "r3c3"] },
  { id: "diagonal-0", kind: "diagonal", index: 0, squares: ["r0c0", "r1c1", "r2c2", "r3c3"] },
  { id: "diagonal-1", kind: "diagonal", index: 1, squares: ["r0c3", "r1c2", "r2c1", "r3c0"] },
] as const satisfies readonly Line[]);

export function isSquare(value: unknown): value is Square {
  return typeof value === "string" && SQUARE_SET.has(value);
}

export function squareAt(row: RowIndex, column: ColumnIndex): Square {
  return `r${row}c${column}`;
}
