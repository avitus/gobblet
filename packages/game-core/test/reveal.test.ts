import { describe, expect, it } from "vitest";
import { enumerateMoves, evaluateMove, getVisibleSize, getWinningLines } from "../src/index";
import { applyOrThrow, boardMove, buildState, rejectionReason } from "./helpers/build-state";

/**
 * Dark shows three pieces in row 0 and hides a fourth under the light piece on
 * r0c3, so lifting that light piece exposes a dark line of four.
 */
const revealFixture = buildState({
  board: {
    r0c0: ["D3"],
    r0c1: ["D4"],
    r0c2: ["D4"],
    r0c3: ["D3", "L4"],
  },
  activePlayer: "light",
});

describe("scenario D: revealing an opponent line and failing to block it", () => {
  it("loses immediately for the mover", () => {
    const { state, evaluation } = applyOrThrow(revealFixture, boardMove("r0c3", "r2c2"));

    expect(evaluation.consequence).toBe("loses-by-reveal");
    expect(evaluation.revealedOpponentLines.map((line) => line.id)).toEqual(["row-0"]);
    expect(evaluation.blockedOpponentLines).toEqual([]);
    expect(state.status).toEqual({ kind: "win", winner: "dark", reason: "revealed-line" });
    expect(getWinningLines(state, "dark").map((line) => line.id)).toEqual(["row-0"]);
    expect(state.activePlayer).toBe("light");
    expect(enumerateMoves(state)).toEqual([]);
  });

  it("is reported before the move is applied", () => {
    const evaluation = evaluateMove(revealFixture, boardMove("r0c3", "r2c2"));

    expect(evaluation.legal).toBe(true);
    expect(evaluation.legal && evaluation.consequence).toBe("loses-by-reveal");
  });

  it("marks every legal destination that fails to block as losing", () => {
    const losing = enumerateMoves(revealFixture).filter(
      (candidate) => candidate.consequence === "loses-by-reveal",
    );

    expect(losing.length).toBeGreaterThan(0);
    for (const candidate of losing) {
      expect(candidate.move).toMatchObject({ kind: "board", from: "r0c3" });
    }
  });
});

describe("scenario E: revealing an opponent line and blocking it", () => {
  it("continues the game when the moved piece covers another piece of the same line", () => {
    const { state, evaluation } = applyOrThrow(revealFixture, boardMove("r0c3", "r0c0"));

    expect(evaluation.consequence).toBe("continues");
    expect(evaluation.revealedOpponentLines.map((line) => line.id)).toEqual(["row-0"]);
    expect(evaluation.blockedOpponentLines.map((line) => line.id)).toEqual(["row-0"]);
    expect(state.status).toEqual({ kind: "in-progress" });
    expect(state.activePlayer).toBe("dark");
    expect(getWinningLines(state, "dark")).toEqual([]);
    expect(getVisibleSize(state, "r0c3")).toBe(3);
  });

  it("cannot block by covering an equally sized piece", () => {
    expect(rejectionReason(revealFixture, boardMove("r0c3", "r0c1"))).toBe(
      "destination-piece-not-smaller",
    );
  });

  it("can win with the blocking move itself", () => {
    const fixture = buildState({
      board: {
        r0c0: ["D3"],
        r0c1: ["D4"],
        r0c2: ["D4"],
        r0c3: ["D3", "L4"],
        r1c1: ["L4"],
        r2c2: ["L4"],
        r3c3: ["L3"],
      },
      activePlayer: "light",
    });

    const { state, evaluation } = applyOrThrow(fixture, boardMove("r0c3", "r0c0"));

    expect(evaluation.consequence).toBe("wins");
    expect(evaluation.blockedOpponentLines.map((line) => line.id)).toEqual(["row-0"]);
    expect(evaluation.resultingWinningLines.map((line) => line.id)).toEqual(["diagonal-0"]);
    expect(state.status).toEqual({ kind: "win", winner: "light", reason: "line" });
  });
});

describe("multiple revealed lines", () => {
  const fixture = buildState({
    board: {
      r0c0: ["D2", "L4"],
      r0c1: ["D4"],
      r0c2: ["D4"],
      r0c3: ["D4"],
      r1c0: ["D3"],
      r2c0: ["D3"],
      r3c0: ["D3"],
    },
    activePlayer: "light",
  });

  it("loses whenever any revealed line stays unblocked", () => {
    const candidates = enumerateMoves(fixture).filter(
      (candidate) => candidate.move.kind === "board" && candidate.move.from === "r0c0",
    );

    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(candidate.consequence).toBe("loses-by-reveal");
      expect(candidate.revealedOpponentLines.map((line) => line.id).sort()).toEqual([
        "column-0",
        "row-0",
      ]);
    }
  });

  it("reports the partially blocked line but still loses", () => {
    const { state, evaluation } = applyOrThrow(fixture, boardMove("r0c0", "r1c0"));

    expect(evaluation.blockedOpponentLines.map((line) => line.id)).toEqual(["column-0"]);
    expect(evaluation.consequence).toBe("loses-by-reveal");
    expect(state.status).toEqual({ kind: "win", winner: "dark", reason: "revealed-line" });
  });
});

describe("terminal outcome priority", () => {
  it("does not let the mover's own new line override an unblocked revealed line", () => {
    const fixture = buildState({
      board: {
        r0c1: ["L4"],
        r0c2: ["L4"],
        r0c3: ["L3"],
        r3c0: ["D4"],
        r3c1: ["D4"],
        r3c2: ["D4"],
        r3c3: ["D3", "L4"],
      },
      activePlayer: "light",
    });

    const { state, evaluation } = applyOrThrow(fixture, boardMove("r3c3", "r0c0"));

    expect(evaluation.consequence).toBe("loses-by-reveal");
    expect(state.status).toEqual({ kind: "win", winner: "dark", reason: "revealed-line" });
    expect(getWinningLines(state, "light").map((line) => line.id)).toEqual(["row-0"]);
    expect(getWinningLines(state, "dark").map((line) => line.id)).toEqual(["row-3"]);
  });

  it("never reveals anything when entering a piece from a reserve", () => {
    const fixture = buildState({
      board: { r0c0: ["D3"], r0c1: ["D3"], r0c2: ["D3"], r3c0: ["D4"], r3c3: ["D4"], r2c1: ["D4"] },
      activePlayer: "light",
    });

    for (const candidate of enumerateMoves(fixture)) {
      if (candidate.move.kind === "reserve") {
        expect(candidate.revealedOpponentLines).toEqual([]);
        expect(candidate.blockedOpponentLines).toEqual([]);
      }
    }
  });
});
