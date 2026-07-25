import {
  createInitialGame,
  enumerateMoves,
  toSerializableGameState,
  type Move,
} from "@gobblet/game-core";
import { describe, expect, it } from "vitest";
import { moveSchema, serializedGameStateSchema, type MovePayload } from "../src/index";
import { applyOrThrow, midGame } from "./helpers/fixtures";

describe("moveSchema", () => {
  it("accepts every reserve move the engine enumerates in the initial position", () => {
    const moves = enumerateMoves(createInitialGame("light")).map((evaluated) => evaluated.move);

    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((move) => move.kind === "reserve")).toBe(true);
    for (const move of moves) {
      expect(moveSchema.parse(move)).toEqual(move);
    }
  });

  it("accepts a board move the engine enumerates mid game", () => {
    const boardMove = enumerateMoves(midGame)
      .map((evaluated) => evaluated.move)
      .find((move) => move.kind === "board");

    expect(boardMove).toBeDefined();
    expect(moveSchema.parse(boardMove)).toEqual(boardMove);
  });

  it("rejects a square outside the canonical sixteen", () => {
    expect(moveSchema.safeParse({ kind: "board", from: "r9c9", to: "r0c0" }).success).toBe(false);
  });

  it("rejects an unknown kind and a mixed move shape", () => {
    expect(moveSchema.safeParse({ kind: "teleport", to: "r0c0" }).success).toBe(false);
    expect(moveSchema.safeParse({ kind: "board", reserveStack: 0, to: "r0c0" }).success).toBe(
      false,
    );
    expect(
      moveSchema.safeParse({ kind: "reserve", reserveStack: 0, from: "r0c0", to: "r0c1" }).success,
    ).toBe(false);
  });

  it("rejects an out of range reserve stack", () => {
    expect(moveSchema.safeParse({ kind: "reserve", reserveStack: 3, to: "r0c0" }).success).toBe(
      false,
    );
  });

  it("stays assignable to and from the engine move type", () => {
    const parsed: Move = moveSchema.parse({ kind: "reserve", reserveStack: 2, to: "r1c3" });
    const engineMove: MovePayload["move"] = { kind: "board", from: "r0c0", to: "r0c1" };

    expect(parsed).toEqual({ kind: "reserve", reserveStack: 2, to: "r1c3" });
    expect(engineMove.kind).toBe("board");
  });
});

describe("serializedGameStateSchema", () => {
  it("accepts a state produced after a real move", () => {
    const state = toSerializableGameState(
      applyOrThrow(midGame, { kind: "board", from: "r0c0", to: "r0c1" }),
    );

    expect(serializedGameStateSchema.parse(state)).toEqual(state);
  });

  it("rejects structurally invalid states", () => {
    expect(serializedGameStateSchema.safeParse({}).success).toBe(false);
    expect(serializedGameStateSchema.safeParse(undefined).success).toBe(false);
    expect(serializedGameStateSchema.safeParse(null).success).toBe(false);
    expect(serializedGameStateSchema.safeParse("light").success).toBe(false);
  });

  it("rejects a state whose board holds an unknown piece", () => {
    const state = toSerializableGameState(createInitialGame("light"));
    const corrupted = { ...state, board: { ...state.board, r0c0: ["L9"] } };

    expect(serializedGameStateSchema.safeParse(corrupted).success).toBe(false);
  });

  it("rejects a state that violates engine invariants", () => {
    const state = toSerializableGameState(createInitialGame("light"));
    const duplicated = { ...state, board: { ...state.board, r0c0: ["L04"] } };

    expect(serializedGameStateSchema.safeParse(duplicated).success).toBe(false);
  });
});
