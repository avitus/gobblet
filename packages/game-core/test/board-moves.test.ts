import { describe, expect, it } from "vitest";
import {
  getPiece,
  getStack,
  getVisibleOwner,
  getVisiblePieceId,
  getVisibleSize,
} from "../src/index";
import type { Square } from "../src/index";
import {
  applyOrThrow,
  boardMove,
  buildState,
  legalDestinations,
  rejectionReason,
  reserveCounts,
} from "./helpers/build-state";

describe("moving a piece already on the board", () => {
  it("moves a visible piece to an empty square", () => {
    const state = buildState({ board: { r0c0: ["L4"] }, activePlayer: "light" });
    const moving = getVisiblePieceId(state, "r0c0");
    const { state: next, evaluation } = applyOrThrow(state, boardMove("r0c0", "r2c3"));

    expect(getStack(next, "r0c0")).toEqual([]);
    expect(getStack(next, "r2c3")).toEqual([moving]);
    expect(next.activePlayer).toBe("dark");
    expect(next.ply).toBe(1);
    expect(evaluation.consequence).toBe("continues");
    expect(reserveCounts(next, "light")).toEqual(reserveCounts(state, "light"));
  });

  it("scenario C: gobbles the mover's own smaller piece", () => {
    const state = buildState({
      board: { r0c0: ["L4"], r1c1: ["L2"], r3c3: ["L3", "L4"] },
      activePlayer: "light",
    });
    const covered = getVisiblePieceId(state, "r1c1");
    const moving = getVisiblePieceId(state, "r0c0");

    const { state: next } = applyOrThrow(state, boardMove("r0c0", "r1c1"));

    expect(getStack(next, "r1c1")).toEqual([covered, moving]);
    expect(getVisibleSize(next, "r1c1")).toBe(4);
    expect(getVisibleOwner(next, "r1c1")).toBe("light");
    expect(next.status).toEqual({ kind: "in-progress" });
  });

  it("gobbles a smaller opponent piece", () => {
    const state = buildState({
      board: { r0c0: ["L4"], r1c1: ["D3"] },
      park: { dark: ["r3c0"] },
      activePlayer: "light",
    });
    const covered = getVisiblePieceId(state, "r1c1");

    const { state: next } = applyOrThrow(state, boardMove("r0c0", "r1c1"));

    expect(getStack(next, "r1c1")).toHaveLength(2);
    expect(getStack(next, "r1c1")[0]).toBe(covered);
    expect(getVisibleOwner(next, "r1c1")).toBe("light");
  });

  it("rejects covering a piece of equal size", () => {
    const state = buildState({ board: { r0c0: ["L4"], r1c1: ["D4"] }, activePlayer: "light" });
    expect(rejectionReason(state, boardMove("r0c0", "r1c1"))).toBe("destination-piece-not-smaller");
  });

  it("rejects covering a larger piece", () => {
    const state = buildState({
      board: { r0c0: ["L2"], r1c1: ["D4"], r3c3: ["L3", "L4"] },
      activePlayer: "light",
    });
    expect(getVisibleSize(state, "r0c0")).toBe(2);
    expect(rejectionReason(state, boardMove("r0c0", "r1c1"))).toBe("destination-piece-not-smaller");
  });

  it("rejects moving a covered piece because only the top piece is visible", () => {
    const state = buildState({
      board: { r0c0: ["L2", "D4"], r3c3: ["L3", "L4"] },
      activePlayer: "light",
    });

    expect(getVisibleOwner(state, "r0c0")).toBe("dark");
    expect(rejectionReason(state, boardMove("r0c0", "r1c1"))).toBe("piece-not-owned");
  });

  it("moves only the top piece when the mover covers one of their own pieces", () => {
    const state = buildState({
      board: { r0c0: ["L2", "L4"] },
      park: { light: ["r3c0"] },
      activePlayer: "light",
    });
    const top = getVisiblePieceId(state, "r0c0");
    const beneath = getStack(state, "r0c0")[0];

    const { state: next } = applyOrThrow(state, boardMove("r0c0", "r2c2"));

    expect(getStack(next, "r2c2")).toEqual([top]);
    expect(getStack(next, "r0c0")).toEqual([beneath]);
    expect(getPiece(beneath!).size).toBe(2);
  });

  it("rejects a move onto the same square", () => {
    const state = buildState({ board: { r0c0: ["L4"] }, activePlayer: "light" });
    expect(rejectionReason(state, boardMove("r0c0", "r0c0"))).toBe("same-square");
  });

  it("rejects a move from an empty square", () => {
    const state = buildState({ board: { r0c0: ["L4"] }, activePlayer: "light" });
    expect(rejectionReason(state, boardMove("r1c1", "r2c2"))).toBe("empty-source-square");
  });

  it("rejects a move of the opponent's visible piece", () => {
    const state = buildState({ board: { r0c0: ["D4"] }, activePlayer: "light" });
    expect(rejectionReason(state, boardMove("r0c0", "r1c1"))).toBe("piece-not-owned");
  });

  it("rejects malformed square references", () => {
    const state = buildState({ board: { r0c0: ["L4"] }, activePlayer: "light" });
    expect(rejectionReason(state, boardMove("r7c0" as Square, "r1c1"))).toBe("invalid-square");
    expect(rejectionReason(state, boardMove("r0c0", "c1r1" as Square))).toBe("invalid-square");
  });

  it("offers every empty square and every strictly smaller piece as a destination", () => {
    const state = buildState({
      board: { r0c0: ["L4"], r0c1: ["D3"], r0c2: ["D4"], r0c3: ["L2"], r3c3: ["L3", "L4"] },
      activePlayer: "light",
    });

    const destinations = legalDestinations(state, "r0c0");

    expect(destinations).toContain("r0c1");
    expect(destinations).toContain("r0c3");
    expect(destinations).toContain("r1c1");
    expect(destinations).not.toContain("r0c0");
    expect(destinations).not.toContain("r0c2");
    expect(destinations).not.toContain("r3c3");
    expect(destinations).toHaveLength(13);
  });
});
