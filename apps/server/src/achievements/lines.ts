import { LINES } from "@gobblet/game-core";
import type { WinningLine } from "@gobblet/game-core";

/**
 * The four ways a match can be won (docs/product-spec.md section 11.4). The two
 * diagonals are separate categories, because "Four Ways" names them separately
 * (appendix P6.6).
 */
export const WINNING_LINE_CATEGORIES = Object.freeze([
  "row",
  "column",
  "diagonal-0",
  "diagonal-1",
] as const);

export type WinningLineCategory = (typeof WINNING_LINE_CATEGORIES)[number];

function categoryOf(line: Readonly<{ kind: string; index: number }>): WinningLineCategory {
  if (line.kind === "column") {
    return "column";
  }
  if (line.kind === "row") {
    return "row";
  }
  return line.index === 0 ? "diagonal-0" : "diagonal-1";
}

const CATEGORY_BY_ID: ReadonlyMap<string, WinningLineCategory> = new Map(
  LINES.map((line) => [line.id as string, categoryOf(line)]),
);

/** What is written on the match row when it completes, in the engine's own vocabulary. */
export function winningLineIds(lines: readonly WinningLine[]): string[] {
  return lines.map((line) => line.id);
}

/** The distinct categories a set of stored line ids covers; an unknown id is ignored. */
export function lineCategories(ids: readonly string[]): WinningLineCategory[] {
  const categories = new Set<WinningLineCategory>();
  for (const id of ids) {
    const category = CATEGORY_BY_ID.get(id);
    if (category) {
      categories.add(category);
    }
  }
  return WINNING_LINE_CATEGORIES.filter((category) => categories.has(category));
}
