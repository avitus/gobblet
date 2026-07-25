import { describe, expect, it } from "vitest";
import { REPETITION_LIMIT, canonicalPositionKey, createInitialGame } from "../src/index";
import type { Move } from "../src/index";
import {
  applyAllOrThrow,
  applyOrThrow,
  boardMove,
  buildState,
  rejectionReason,
  reserveMove,
} from "./helpers/build-state";

/** Two lone pieces shuffled back and forth reproduce the same position three times. */
const openingMoves: readonly Move[] = [reserveMove(0, "r0c0"), reserveMove(0, "r3c3")];

const shuffle: readonly Move[] = [
  boardMove("r0c0", "r0c1"),
  boardMove("r3c3", "r3c2"),
  boardMove("r0c1", "r0c0"),
  boardMove("r3c2", "r3c3"),
];

describe("scenario F: threefold repetition", () => {
  it("draws when the same position with the same side to move occurs three times", () => {
    const opening = applyAllOrThrow(createInitialGame("light"), openingMoves);
    const repeatedKey = canonicalPositionKey(opening);

    expect(opening.repetition.counts[repeatedKey]).toBe(1);

    const secondOccurrence = applyAllOrThrow(opening, shuffle);

    expect(canonicalPositionKey(secondOccurrence)).toBe(repeatedKey);
    expect(secondOccurrence.repetition.counts[repeatedKey]).toBe(2);
    expect(secondOccurrence.status).toEqual({ kind: "in-progress" });

    const beforeDraw = applyAllOrThrow(secondOccurrence, shuffle.slice(0, 3));
    const { state: drawn, evaluation } = applyOrThrow(beforeDraw, shuffle[3]!);

    expect(evaluation.consequence).toBe("draws-by-repetition");
    expect(evaluation.positionKey).toBe(repeatedKey);
    expect(drawn.status).toEqual({ kind: "draw", reason: "threefold-repetition" });
    expect(drawn.repetition.counts[repeatedKey]).toBe(REPETITION_LIMIT);
    expect(drawn.activePlayer).toBe("dark");
    expect(rejectionReason(drawn, reserveMove(1, "r1c1"))).toBe("game-over");
  });

  it("counts the opening position as the first occurrence", () => {
    const start = createInitialGame("light");
    expect(start.repetition.counts[canonicalPositionKey(start)]).toBe(1);
  });

  it("keeps positions with a different side to move separate", () => {
    const light = createInitialGame("light");
    const dark = createInitialGame("dark");

    expect(canonicalPositionKey(light)).not.toBe(canonicalPositionKey(dark));
  });

  it("treats the three external stacks as interchangeable", () => {
    const start = createInitialGame("light");
    const fromStackZero = applyOrThrow(start, reserveMove(0, "r0c0")).state;
    const fromStackTwo = applyOrThrow(start, reserveMove(2, "r0c0")).state;

    expect(canonicalPositionKey(fromStackTwo)).toBe(canonicalPositionKey(fromStackZero));
  });

  it("distinguishes positions that differ only in remaining reserve pieces", () => {
    const withOnePiece = buildState({ board: { r0c0: ["L4"] }, activePlayer: "dark" });
    const withNestedStack = buildState({
      board: { r0c0: ["L4"], r1c1: ["L4"] },
      activePlayer: "dark",
    });

    expect(canonicalPositionKey(withOnePiece)).not.toBe(canonicalPositionKey(withNestedStack));
  });

  it("ignores ply and repetition history when computing a position key", () => {
    const first = buildState({ board: { r0c0: ["L4"] }, activePlayer: "dark", ply: 1 });
    const later = buildState({
      board: { r0c0: ["L4"] },
      activePlayer: "dark",
      ply: 17,
      repetition: { seeded: 2 },
    });

    expect(canonicalPositionKey(later)).toBe(canonicalPositionKey(first));
  });

  it("does not draw when a repeated position is reached with the other side to move", () => {
    const opening = applyAllOrThrow(createInitialGame("light"), openingMoves);
    const twice = applyAllOrThrow(opening, [...shuffle, ...shuffle.slice(0, 2)]);

    expect(twice.status).toEqual({ kind: "in-progress" });
  });
});
