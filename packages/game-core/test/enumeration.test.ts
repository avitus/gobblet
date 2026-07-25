import { describe, expect, it } from "vitest";
import {
  RESERVE_STACK_INDEXES,
  SQUARES,
  applyMove,
  createInitialGame,
  enumerateMoves,
  evaluateMove,
} from "../src/index";
import type { GameState, Move } from "../src/index";
import { applyOrThrow, boardMove, buildState, reserveMove } from "./helpers/build-state";

function allCandidateMoves(): readonly Move[] {
  const moves: Move[] = [];
  for (const reserveStack of RESERVE_STACK_INDEXES) {
    for (const to of SQUARES) {
      moves.push(reserveMove(reserveStack, to));
    }
  }
  for (const from of SQUARES) {
    for (const to of SQUARES) {
      moves.push(boardMove(from, to));
    }
  }
  return moves;
}

function assertEnumerationMatchesEvaluation(state: GameState): void {
  const enumerated = new Set(enumerateMoves(state).map((entry) => JSON.stringify(entry.move)));

  for (const move of allCandidateMoves()) {
    const key = JSON.stringify(move);
    const evaluation = evaluateMove(state, move);
    expect(enumerated.has(key)).toBe(evaluation.legal);
    if (!evaluation.legal) {
      const applied = applyMove(state, move);
      expect(applied.ok).toBe(false);
    }
  }
}

describe("move enumeration", () => {
  it("offers every reserve stack on every empty square at the start", () => {
    const state = createInitialGame("light");
    const moves = enumerateMoves(state);

    expect(moves).toHaveLength(48);
    expect(moves.every((entry) => entry.move.kind === "reserve")).toBe(true);
    expect(moves.every((entry) => entry.consequence === "continues")).toBe(true);
    expect(moves.every((entry) => entry.legal)).toBe(true);
  });

  it("agrees with evaluateMove and applyMove for every candidate move", () => {
    assertEnumerationMatchesEvaluation(createInitialGame("light"));
    assertEnumerationMatchesEvaluation(
      buildState({
        board: {
          r0c0: ["D3"],
          r0c1: ["D4"],
          r0c2: ["D4"],
          r0c3: ["D3", "L4"],
          r1c1: ["L4"],
        },
        activePlayer: "light",
      }),
    );
    assertEnumerationMatchesEvaluation(
      buildState({
        board: { r0c0: ["L1", "L2", "L3", "L4"], r1c1: ["D4"], r2c2: ["D3"], r3c3: ["D3"] },
        park: { dark: ["r3c0"] },
        activePlayer: "light",
      }),
    );
  });

  it("returns nothing for a finished game", () => {
    const state = buildState({
      board: { r1c0: ["L4"], r1c1: ["L4"], r1c2: ["L4"] },
      activePlayer: "light",
    });
    const { state: won } = applyOrThrow(state, reserveMove(0, "r1c3"));

    expect(enumerateMoves(won)).toEqual([]);
  });

  it("includes the defensive reserve gobble only where the exception applies", () => {
    const state = buildState({
      board: { r0c0: ["D3"], r0c1: ["D3"], r0c2: ["D3"], r3c0: ["D4"], r3c3: ["D4"], r2c1: ["D4"] },
      activePlayer: "light",
    });

    const reserveTargets = new Set<string>();
    for (const entry of enumerateMoves(state)) {
      if (entry.move.kind === "reserve") {
        reserveTargets.add(entry.move.to);
      }
    }

    expect(reserveTargets).toEqual(
      new Set([
        "r0c0",
        "r0c1",
        "r0c2",
        "r0c3",
        "r1c0",
        "r1c1",
        "r1c2",
        "r1c3",
        "r2c0",
        "r2c2",
        "r2c3",
        "r3c1",
        "r3c2",
      ]),
    );
  });

  it("keeps every enumerated evaluation frozen", () => {
    const [first] = enumerateMoves(createInitialGame("light"));

    expect(first).toBeDefined();
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first?.revealedOpponentLines)).toBe(true);
  });
});
