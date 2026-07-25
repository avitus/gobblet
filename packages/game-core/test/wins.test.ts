import { describe, expect, it } from "vitest";
import { LINES, enumerateMoves, getWinningLines } from "../src/index";
import {
  applyOrThrow,
  boardMove,
  boardSpec,
  buildState,
  rejectionReason,
  reserveMove,
} from "./helpers/build-state";

describe("winning lines", () => {
  for (const line of LINES) {
    it(`recognises a light win on ${line.id}`, () => {
      const [first, second, third, fourth] = line.squares;
      const state = buildState({
        board: boardSpec([
          [first, ["L4"]],
          [second, ["L4"]],
          [third, ["L4"]],
        ]),
        activePlayer: "light",
      });

      expect(getWinningLines(state, "light")).toEqual([]);

      const { state: next, evaluation } = applyOrThrow(state, reserveMove(0, fourth));

      expect(next.status).toEqual({ kind: "win", winner: "light", reason: "line" });
      expect(evaluation.consequence).toBe("wins");
      expect(evaluation.resultingWinningLines.map((winning) => winning.id)).toEqual([line.id]);
      expect(getWinningLines(next, "light").map((winning) => winning.id)).toEqual([line.id]);
      expect(getWinningLines(next, "dark")).toEqual([]);
      expect(next.activePlayer).toBe("light");
    });
  }

  it(`recognises a dark win and reports the line metadata`, () => {
    const state = buildState({
      board: { r2c0: ["D4"], r2c1: ["D4"], r2c2: ["D4"] },
      activePlayer: "dark",
    });

    const { state: next, evaluation } = applyOrThrow(state, reserveMove(1, "r2c3"));

    expect(next.status).toEqual({ kind: "win", winner: "dark", reason: "line" });
    expect(evaluation.resultingWinningLines).toHaveLength(1);
    expect(evaluation.resultingWinningLines[0]).toMatchObject({
      id: "row-2",
      kind: "row",
      index: 2,
      player: "dark",
    });
    expect(evaluation.resultingWinningLines[0]?.pieces).toHaveLength(4);
  });

  it("recognises a win completed by a board move", () => {
    const state = buildState({
      board: { r0c0: ["L4"], r0c1: ["L4"], r0c2: ["L4"], r2c2: ["L3"] },
      activePlayer: "light",
    });

    const { state: next } = applyOrThrow(state, boardMove("r2c2", "r0c3"));

    expect(next.status).toEqual({ kind: "win", winner: "light", reason: "line" });
  });

  it("ignores covered pieces when evaluating lines", () => {
    const state = buildState({
      board: {
        r0c0: ["L4"],
        r0c1: ["L4"],
        r0c2: ["L4"],
        r0c3: ["L2", "D4"],
        r3c0: ["L3"],
      },
      activePlayer: "light",
    });

    expect(getWinningLines(state, "light")).toEqual([]);
    expect(state.status).toEqual({ kind: "in-progress" });
  });

  it("accepts no further moves once the game is won", () => {
    const state = buildState({
      board: { r0c0: ["L4"], r0c1: ["L4"], r0c2: ["L4"] },
      activePlayer: "light",
    });
    const { state: won } = applyOrThrow(state, reserveMove(0, "r0c3"));

    expect(rejectionReason(won, reserveMove(1, "r1c1"))).toBe("game-over");
    expect(rejectionReason(won, boardMove("r0c0", "r1c1"))).toBe("game-over");
    expect(enumerateMoves(won)).toEqual([]);
  });
});
