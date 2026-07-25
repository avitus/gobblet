import { describe, expect, it } from "vitest";
import {
  GameCoreInvariantError,
  GameCoreSerializationError,
  createInitialGame,
  deserializeGameState,
  fromSerializableGameState,
  serializeGameState,
  toSerializableGameState,
} from "../src/index";
import {
  applyAllOrThrow,
  applyOrThrow,
  boardMove,
  buildState,
  reserveMove,
} from "./helpers/build-state";

const midGame = applyAllOrThrow(createInitialGame("light"), [
  reserveMove(0, "r0c0"),
  reserveMove(0, "r3c3"),
  boardMove("r0c0", "r0c1"),
  reserveMove(1, "r1c1"),
]);

const wonGame = applyOrThrow(
  buildState({ board: { r1c0: ["L4"], r1c1: ["L4"], r1c2: ["L4"] }, activePlayer: "light" }),
  reserveMove(0, "r1c3"),
).state;

function serializedOf(state = midGame): Record<string, unknown> {
  return JSON.parse(serializeGameState(state)) as Record<string, unknown>;
}

function expectRejection(input: unknown, path: string): void {
  try {
    fromSerializableGameState(input);
    expect.unreachable(`expected a serialization error for ${path}`);
  } catch (error) {
    expect(error).toBeInstanceOf(GameCoreSerializationError);
    expect((error as GameCoreSerializationError).path).toBe(path);
  }
}

describe("serialization", () => {
  it("round trips the opening position", () => {
    const state = createInitialGame("dark");
    expect(deserializeGameState(serializeGameState(state))).toEqual(state);
  });

  it("round trips a mid-game position", () => {
    expect(deserializeGameState(serializeGameState(midGame))).toEqual(midGame);
  });

  it("round trips terminal positions", () => {
    expect(deserializeGameState(serializeGameState(wonGame))).toEqual(wonGame);

    const drawn = buildState({
      board: { r0c0: ["L4"] },
      activePlayer: "dark",
      status: { kind: "draw", reason: "threefold-repetition" },
      repetition: { "gp1:seeded": 3 },
    });
    expect(deserializeGameState(serializeGameState(drawn))).toEqual(drawn);
  });

  it("is byte stable and independent of insertion order", () => {
    const first = serializeGameState(midGame);
    const second = serializeGameState(deserializeGameState(first));

    expect(second).toBe(first);
    expect(serializeGameState(createInitialGame("light"))).toBe(
      serializeGameState(createInitialGame("light")),
    );
  });

  it("sorts repetition counts deterministically", () => {
    const state = buildState({
      board: { r0c0: ["L4"] },
      activePlayer: "dark",
      repetition: { "gp1:b": 1, "gp1:a": 2, "gp1:c": 1 },
    });

    expect(Object.keys(toSerializableGameState(state).repetition.counts)).toEqual([
      "gp1:a",
      "gp1:b",
      "gp1:c",
    ]);
  });

  it("keeps the structure JSON safe and readable", () => {
    const serialized = toSerializableGameState(wonGame);

    expect(serialized.version).toBe(1);
    expect(serialized.status).toEqual({ kind: "win", winner: "light", reason: "line" });
    expect(Object.keys(serialized.board)).toHaveLength(16);
    expect(serialized.reserves.light).toHaveLength(3);
  });

  it("returns a frozen state", () => {
    const state = deserializeGameState(serializeGameState(midGame));
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.board)).toBe(true);
  });
});

describe("serialization rejects malformed input", () => {
  it("rejects values that are not objects", () => {
    expectRejection("nope", "$");
    expectRejection(null, "$");
    expectRejection([], "$");
  });

  it("rejects invalid JSON text", () => {
    try {
      deserializeGameState("{");
      expect.unreachable("expected a serialization error");
    } catch (error) {
      expect(error).toBeInstanceOf(GameCoreSerializationError);
      expect((error as GameCoreSerializationError).message).toContain("invalid JSON");
    }
  });

  it("rejects an unsupported version", () => {
    expectRejection({ ...serializedOf(), version: 2 }, "$.version");
  });

  it("rejects a malformed board", () => {
    expectRejection({ ...serializedOf(), board: 7 }, "$.board");

    const missingSquare = serializedOf();
    const board = { ...(missingSquare.board as Record<string, unknown>) };
    delete board.r0c0;
    expectRejection({ ...missingSquare, board }, "$.board.r0c0");

    expectRejection(
      { ...serializedOf(), board: { ...(serializedOf().board as object), r0c0: ["L09"] } },
      "$.board.r0c0[0]",
    );
  });

  it("rejects malformed reserves", () => {
    expectRejection({ ...serializedOf(), reserves: 7 }, "$.reserves");
    expectRejection(
      { ...serializedOf(), reserves: { light: [[], []], dark: [[], [], []] } },
      "$.reserves.light",
    );
    expectRejection(
      { ...serializedOf(), reserves: { light: [[], [], []], dark: "no" } },
      "$.reserves.dark",
    );
    expectRejection(
      { ...serializedOf(), reserves: { light: [["nope"], [], []], dark: [[], [], []] } },
      "$.reserves.light[0][0]",
    );
  });

  it("rejects a malformed active player", () => {
    expectRejection({ ...serializedOf(), activePlayer: "green" }, "$.activePlayer");
  });

  it("rejects a malformed ply", () => {
    expectRejection({ ...serializedOf(), ply: "3" }, "$.ply");
    expectRejection({ ...serializedOf(), ply: 3.5 }, "$.ply");
    expectRejection({ ...serializedOf(), ply: -1 }, "$.ply");
  });

  it("rejects malformed repetition data", () => {
    expectRejection({ ...serializedOf(), repetition: 3 }, "$.repetition");
    expectRejection({ ...serializedOf(), repetition: { counts: 3 } }, "$.repetition.counts");
    expectRejection(
      { ...serializedOf(), repetition: { counts: { "gp1:a": -1 } } },
      "$.repetition.counts.gp1:a",
    );
    expectRejection(
      { ...serializedOf(), repetition: { counts: { "gp1:a": 1.5 } } },
      "$.repetition.counts.gp1:a",
    );
  });

  it("rejects a malformed status", () => {
    expectRejection({ ...serializedOf(), status: "won" }, "$.status");
    expectRejection({ ...serializedOf(), status: { kind: "abandoned" } }, "$.status.kind");
    expectRejection(
      { ...serializedOf(), status: { kind: "win", reason: "line" } },
      "$.status.winner",
    );
    expectRejection(
      { ...serializedOf(), status: { kind: "win", winner: "light", reason: "timeout" } },
      "$.status.reason",
    );
    expectRejection(
      { ...serializedOf(), status: { kind: "draw", reason: "agreement" } },
      "$.status.reason",
    );
  });

  it("rejects structurally valid but impossible positions", () => {
    const serialized = serializedOf();
    const board = { ...(serialized.board as Record<string, unknown>) };
    board.r0c0 = ["L04"];

    expect(() => fromSerializableGameState({ ...serialized, board })).toThrow(
      GameCoreInvariantError,
    );
  });
});
