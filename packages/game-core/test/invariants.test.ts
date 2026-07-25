import { describe, expect, it } from "vitest";
import {
  GameCoreError,
  GameCoreInvariantError,
  GameCoreTransitionError,
  assertGameStateInvariants,
  assertTransitionInvariants,
  collectInvariantViolations,
  collectTransitionViolations,
  createInitialGame,
} from "../src/index";
import type { GameState, InvariantViolationCode, Square } from "../src/index";
import { applyOrThrow, buildState, reserveMove } from "./helpers/build-state";

const valid = buildState({ board: { r0c0: ["L4"] }, activePlayer: "dark" });

function corrupt(overrides: Record<string, unknown>): GameState {
  return { ...valid, ...overrides };
}

function withRawSquare(square: Square, stack: readonly string[]): GameState {
  return corrupt({ board: { ...valid.board, [square]: stack } });
}

function codesOf(state: GameState): readonly InvariantViolationCode[] {
  return collectInvariantViolations(state).map((violation) => violation.code);
}

describe("state invariants", () => {
  it("accepts states produced by the engine", () => {
    expect(collectInvariantViolations(createInitialGame("light"))).toEqual([]);
    expect(collectInvariantViolations(valid)).toEqual([]);
    expect(() => {
      assertGameStateInvariants(valid);
    }).not.toThrow();
  });

  it("accepts a legitimately won state", () => {
    const state = buildState({
      board: { r0c0: ["L4"], r0c1: ["L4"], r0c2: ["L4"] },
      activePlayer: "light",
    });
    const { state: won } = applyOrThrow(state, reserveMove(0, "r0c3"));

    expect(collectInvariantViolations(won)).toEqual([]);
  });

  it("rejects an unsupported state version", () => {
    expect(codesOf(corrupt({ version: 2 }))).toContain("unsupported-state-version");
  });

  it("rejects an invalid ply", () => {
    expect(codesOf(corrupt({ ply: -1 }))).toContain("invalid-ply");
    expect(codesOf(corrupt({ ply: 1.5 }))).toContain("invalid-ply");
  });

  it("rejects an unknown active player", () => {
    expect(codesOf(corrupt({ activePlayer: "green" }))).toContain("invalid-active-player");
  });

  it("rejects unknown pieces", () => {
    expect(codesOf(withRawSquare("r1c1", ["L09"]))).toEqual(["unknown-piece"]);
  });

  it("rejects duplicated pieces", () => {
    const codes = codesOf(withRawSquare("r1c1", ["L04"]));
    expect(codes).toContain("duplicate-piece");
    expect(codes).toContain("piece-count-per-player");
  });

  it("rejects missing pieces", () => {
    const codes = codesOf(
      corrupt({ reserves: { ...valid.reserves, light: [valid.reserves.light[0], [], []] } }),
    );
    expect(codes).toContain("missing-piece");
    expect(codes).toContain("piece-count-per-player");
  });

  it("rejects board stacks that are not strictly ascending", () => {
    expect(codesOf(withRawSquare("r1c1", ["L14", "L13"]))).toContain("board-stack-not-ascending");
    expect(codesOf(withRawSquare("r1c2", ["L11", "L21"]))).toContain("board-stack-not-ascending");
  });

  it("rejects external stacks that are not a 1..k prefix", () => {
    const codes = codesOf(
      corrupt({
        reserves: {
          ...valid.reserves,
          dark: [["D01", "D03"], valid.reserves.dark[1], valid.reserves.dark[2]],
        },
      }),
    );
    expect(codes).toContain("invalid-reserve-stack-contents");
  });

  it("rejects an in-progress state that already shows a line of four", () => {
    const state = buildState({
      board: { r0c0: ["L4"], r0c1: ["L4"], r0c2: ["L4"], r0c3: ["L3"] },
      activePlayer: "dark",
      assertInvariants: false,
    });

    expect(codesOf(state)).toContain("in-progress-with-winning-line");
    expect(() => {
      assertGameStateInvariants(state);
    }).toThrow(GameCoreInvariantError);
  });

  it("rejects a win without a visible line of four", () => {
    expect(
      codesOf(corrupt({ status: { kind: "win", winner: "light", reason: "line" } })),
    ).toContain("win-without-winning-line");
    expect(
      codesOf(corrupt({ status: { kind: "win", winner: "dark", reason: "revealed-line" } })),
    ).toContain("win-without-winning-line");
  });

  it("rejects a draw without a repeated position", () => {
    expect(
      codesOf(
        corrupt({
          status: { kind: "draw", reason: "threefold-repetition" },
          repetition: { counts: { "gp1:seeded": 1 } },
        }),
      ),
    ).toContain("draw-without-repetition");
  });

  it("rejects impossible repetition counts", () => {
    expect(codesOf(corrupt({ repetition: { counts: { "gp1:seeded": 0 } } }))).toContain(
      "invalid-repetition-count",
    );
    expect(codesOf(corrupt({ repetition: { counts: { "gp1:seeded": 2.5 } } }))).toContain(
      "invalid-repetition-count",
    );
  });

  it("reports every violation with a message", () => {
    const violations = collectInvariantViolations(corrupt({ ply: -1 }));
    expect(violations[0]?.message).toContain("non-negative integer");
  });

  it("throws an error that lists the violated codes", () => {
    try {
      assertGameStateInvariants(corrupt({ ply: -1 }));
      expect.unreachable("expected an invariant error");
    } catch (error) {
      expect(error).toBeInstanceOf(GameCoreInvariantError);
      expect(error).toBeInstanceOf(GameCoreError);
      const invariantError = error as GameCoreInvariantError;
      expect(invariantError.name).toBe("GameCoreInvariantError");
      expect(invariantError.message).toContain("invalid-ply");
      expect(invariantError.violations).toHaveLength(1);
    }
  });
});

describe("transition invariants", () => {
  const before = buildState({ board: { r0c0: ["L4"] }, activePlayer: "light" });
  const after = applyOrThrow(before, reserveMove(1, "r2c2")).state;

  it("accepts a normal transition", () => {
    expect(collectTransitionViolations(before, after)).toEqual([]);
    expect(() => {
      assertTransitionInvariants(before, after);
    }).not.toThrow();
  });

  it("accepts a terminal transition that keeps the mover on turn", () => {
    const threat = buildState({
      board: { r2c0: ["L4"], r2c1: ["L4"], r2c2: ["L4"] },
      activePlayer: "light",
    });
    const won = applyOrThrow(threat, reserveMove(0, "r2c3")).state;

    expect(collectTransitionViolations(threat, won)).toEqual([]);
  });

  it("rejects a ply that did not advance", () => {
    const codes = collectTransitionViolations(before, { ...after, ply: before.ply }).map(
      (violation) => violation.code,
    );
    expect(codes).toContain("ply-not-incremented");
  });

  it("rejects reopening a terminal state", () => {
    const terminal: GameState = {
      ...before,
      status: { kind: "win", winner: "light", reason: "line" },
    };
    const codes = collectTransitionViolations(terminal, { ...after, ply: terminal.ply + 1 }).map(
      (violation) => violation.code,
    );
    expect(codes).toContain("terminal-state-reopened");
  });

  it("rejects a nonterminal move that did not alternate the active player", () => {
    const codes = collectTransitionViolations(before, { ...after, activePlayer: "light" }).map(
      (violation) => violation.code,
    );
    expect(codes).toContain("active-player-not-alternated");
  });

  it("rejects a terminal move that changed the active player", () => {
    const terminalAfter: GameState = {
      ...after,
      status: { kind: "win", winner: "light", reason: "line" },
    };
    const codes = collectTransitionViolations(before, terminalAfter).map(
      (violation) => violation.code,
    );
    expect(codes).toContain("active-player-changed-on-terminal-move");
  });

  it("throws an error that lists the violated transition codes", () => {
    try {
      assertTransitionInvariants(before, { ...after, ply: before.ply });
      expect.unreachable("expected a transition error");
    } catch (error) {
      expect(error).toBeInstanceOf(GameCoreTransitionError);
      const transitionError = error as GameCoreTransitionError;
      expect(transitionError.name).toBe("GameCoreTransitionError");
      expect(transitionError.message).toContain("ply-not-incremented");
      expect(transitionError.violations).toHaveLength(1);
    }
  });
});

describe("error hierarchy", () => {
  it("exposes a common base error", () => {
    const error = new GameCoreError("boom");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("GameCoreError");
    expect(error.message).toBe("boom");
  });
});
