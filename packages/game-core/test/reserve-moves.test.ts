import { describe, expect, it } from "vitest";
import {
  canonicalPositionKey,
  createInitialGame,
  evaluateMove,
  getExposedReservePieceId,
  getPiece,
  getStack,
  getVisibleOwner,
  getVisibleSize,
} from "../src/index";
import type { ReserveStackIndex, Square } from "../src/index";
import {
  applyAllOrThrow,
  applyOrThrow,
  buildState,
  legalDestinations,
  rejectionReason,
  reserveCounts,
  reserveMove,
} from "./helpers/build-state";

describe("scenario A: ordinary reserve placement", () => {
  it("places the exposed piece on an empty square", () => {
    const start = createInitialGame("light");
    const exposed = getExposedReservePieceId(start, "light", 0);
    const { state, evaluation } = applyOrThrow(start, reserveMove(0, "r1c1"));

    expect(getStack(state, "r1c1")).toEqual([exposed]);
    expect(getVisibleSize(state, "r1c1")).toBe(4);
    expect(reserveCounts(state, "light")).toEqual([3, 4, 4]);
    expect(state.activePlayer).toBe("dark");
    expect(state.ply).toBe(1);
    expect(state.status).toEqual({ kind: "in-progress" });
    expect(evaluation.consequence).toBe("continues");
    expect(evaluation.revealedOpponentLines).toEqual([]);
    expect(evaluation.blockedOpponentLines).toEqual([]);
    expect(evaluation.positionKey).toBe(canonicalPositionKey(state));
  });

  it("exposes the next smaller piece of the same external stack", () => {
    const start = createInitialGame("light");
    const first = applyOrThrow(start, reserveMove(0, "r0c0")).state;
    const exposed = getExposedReservePieceId(first, "light", 0);

    expect(exposed).not.toBeNull();
    expect(getPiece(exposed!).size).toBe(3);
  });

  it("rejects a reserve entry onto an occupied square without the defensive exception", () => {
    const state = buildState({
      board: { r0c0: ["D3"], r0c1: ["D3"], r3c0: ["D4"], r3c3: ["D4"] },
      activePlayer: "light",
    });

    expect(rejectionReason(state, reserveMove(0, "r0c0"))).toBe(
      "reserve-cover-requires-opponent-three-line",
    );
    expect(evaluateMove(state, reserveMove(0, "r1c1")).legal).toBe(true);
  });

  it("rejects a reserve entry onto a piece that is not smaller", () => {
    const state = buildState({
      board: { r0c0: ["D3"], r0c1: ["D3"], r0c2: ["D3"], r3c0: ["D4"], r3c3: ["D4"], r2c1: ["D4"] },
      activePlayer: "light",
    });

    expect(rejectionReason(state, reserveMove(0, "r3c0"))).toBe("destination-piece-not-smaller");
  });

  it("never lets a reserve piece cover one of the mover's own pieces", () => {
    const state = buildState({
      board: {
        r0c0: ["D3"],
        r0c1: ["D3"],
        r0c2: ["D3"],
        r3c0: ["D4"],
        r3c3: ["D4"],
        r2c1: ["D4"],
        r1c1: ["L4"],
      },
      activePlayer: "light",
    });

    expect(rejectionReason(state, reserveMove(1, "r1c1"))).toBe("reserve-cannot-cover-own-piece");
  });
});

describe("scenario B: defensive reserve gobble", () => {
  const threat = buildState({
    board: { r0c0: ["D3"], r0c1: ["D3"], r0c2: ["D3"], r3c0: ["D4"], r3c3: ["D4"], r2c1: ["D4"] },
    activePlayer: "light",
  });

  it("allows covering any of the three aligned opponent pieces", () => {
    for (const square of ["r0c0", "r0c1", "r0c2"] satisfies Square[]) {
      const covered = getStack(threat, square).at(-1);
      const { state, evaluation } = applyOrThrow(threat, reserveMove(0, square));

      expect(getStack(state, square)).toHaveLength(2);
      expect(getStack(state, square)[0]).toBe(covered);
      expect(getVisibleOwner(state, square)).toBe("light");
      expect(evaluation.consequence).toBe("continues");
      expect(evaluation.revealedOpponentLines).toEqual([]);
    }
  });

  it("still allows the ordinary empty-square entry that also blocks the line", () => {
    const { state } = applyOrThrow(threat, reserveMove(0, "r0c3"));
    expect(getVisibleOwner(state, "r0c3")).toBe("light");
  });

  it("does not allow covering occupied squares outside a three-piece line", () => {
    const twoInLine = buildState({
      board: { r0c0: ["D3"], r0c1: ["D3"], r3c0: ["D4"], r3c3: ["D4"] },
      activePlayer: "light",
    });

    expect(rejectionReason(twoInLine, reserveMove(0, "r0c0"))).toBe(
      "reserve-cover-requires-opponent-three-line",
    );
    expect(rejectionReason(twoInLine, reserveMove(1, "r0c1"))).toBe(
      "reserve-cover-requires-opponent-three-line",
    );
  });

  it("allows the threatened squares and the empty squares, and nothing else", () => {
    for (const square of ["r0c0", "r0c1", "r0c2", "r0c3", "r1c0"] satisfies Square[]) {
      expect(evaluateMove(threat, reserveMove(0, square)).legal).toBe(true);
    }
    for (const square of ["r3c0", "r3c3", "r2c1"] satisfies Square[]) {
      expect(evaluateMove(threat, reserveMove(0, square)).legal).toBe(false);
    }
  });
});

describe("reserve stack bookkeeping", () => {
  it("draws from each external stack of both players", () => {
    const state = applyAllOrThrow(createInitialGame("light"), [
      reserveMove(0, "r0c0"),
      reserveMove(0, "r0c1"),
      reserveMove(1, "r1c1"),
      reserveMove(1, "r1c2"),
      reserveMove(2, "r2c2"),
      reserveMove(2, "r2c3"),
    ]);

    expect(reserveCounts(state, "light")).toEqual([3, 3, 3]);
    expect(reserveCounts(state, "dark")).toEqual([3, 3, 3]);
    expect(state.ply).toBe(6);
    expect(state.activePlayer).toBe("light");
  });

  it("rejects entries from an exhausted external stack", () => {
    const state = buildState({
      board: { r0c0: ["L1", "L2", "L3", "L4"] },
      activePlayer: "light",
    });

    expect(rejectionReason(state, reserveMove(0, "r1c1"))).toBe("empty-reserve-stack");
    expect(evaluateMove(state, reserveMove(1, "r1c1")).legal).toBe(true);
  });

  it("rejects malformed reserve references", () => {
    const state = createInitialGame("light");

    expect(rejectionReason(state, reserveMove(7 as ReserveStackIndex, "r0c0"))).toBe(
      "invalid-reserve-stack",
    );
    expect(rejectionReason(state, reserveMove(0, "r4c4" as Square))).toBe("invalid-square");
  });

  it("offers every empty square as a destination for a reserve piece", () => {
    const state = createInitialGame("light");
    expect(legalDestinations(state, "r0c0")).toEqual([]);
    let legal = 0;
    for (const square of [
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
    ] satisfies Square[]) {
      if (evaluateMove(state, reserveMove(0, square)).legal) {
        legal += 1;
      }
    }
    expect(legal).toBe(16);
  });
});
