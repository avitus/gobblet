import { describe, expect, it } from "vitest";
import { buildBoardModel, findDestination, sameOrigin } from "../src/interaction/board-model";
import { OPENING_STATE, serializedAfter } from "./helpers/state";

/**
 * Light covers a dark piece: the largest piece of a reserve stack is exposed
 * first, so a stack must place its size four before a smaller one can be gobbled.
 */
const COVERED_STATE = serializedAfter(
  { kind: "reserve", reserveStack: 0, to: "r1c0" },
  { kind: "reserve", reserveStack: 0, to: "r2c0" },
  { kind: "reserve", reserveStack: 1, to: "r1c1" },
  { kind: "reserve", reserveStack: 0, to: "r0c0" },
  { kind: "board", from: "r1c0", to: "r0c0" },
);

/**
 * Light's size four covers a dark size three on `r0c0`, and dark holds the rest of
 * row 0, so lifting the cover completes a dark line: the losing reveal of rule 2.7.
 */
const REVEAL_STATE = serializedAfter(
  { kind: "reserve", reserveStack: 0, to: "r1c0" },
  { kind: "reserve", reserveStack: 0, to: "r2c0" },
  { kind: "reserve", reserveStack: 1, to: "r1c1" },
  { kind: "reserve", reserveStack: 0, to: "r0c0" },
  { kind: "board", from: "r1c0", to: "r0c0" },
  { kind: "reserve", reserveStack: 1, to: "r0c1" },
  { kind: "reserve", reserveStack: 2, to: "r3c3" },
  { kind: "reserve", reserveStack: 2, to: "r0c2" },
  { kind: "reserve", reserveStack: 0, to: "r3c0" },
  { kind: "reserve", reserveStack: 0, to: "r0c3" },
);

describe("the board model", () => {
  it("describes an empty board and full reserves", () => {
    const model = buildBoardModel(OPENING_STATE, "light");

    expect(model.squares).toHaveLength(16);
    expect(model.squares.every((square) => square.piece === null && square.height === 0)).toBe(
      true,
    );
    expect(model.reserves).toHaveLength(6);
    expect(model.reserves.every((stack) => stack.remaining === 4)).toBe(true);
    expect(model.reserves.every((stack) => stack.piece?.size === 4)).toBe(true);
    expect(model.activePlayer).toBe("light");
  });

  it("offers the three reserve stacks as the only origins of an opening move", () => {
    const model = buildBoardModel(OPENING_STATE, "light");

    expect(model.movableOrigins).toEqual([
      { kind: "reserve", owner: "light", reserveStack: 0 },
      { kind: "reserve", owner: "light", reserveStack: 1 },
      { kind: "reserve", owner: "light", reserveStack: 2 },
    ]);
    expect(
      model.destinationsFor(model.movableOrigins[0] ?? { kind: "board", square: "r0c0" }),
    ).toHaveLength(16);
  });

  it("offers nothing to the player who is not to move, or to an onlooker", () => {
    expect(buildBoardModel(OPENING_STATE, "dark").movableOrigins).toEqual([]);
    expect(buildBoardModel(OPENING_STATE, null).movableOrigins).toEqual([]);
    expect(
      buildBoardModel(OPENING_STATE, "dark").destinationsFor({ kind: "board", square: "r0c0" }),
    ).toEqual([]);
  });

  it("shows only the top piece of a stack, and how tall the stack is", () => {
    const model = buildBoardModel(COVERED_STATE, "dark");
    const covered = model.squares.find((square) => square.square === "r0c0");

    expect(covered?.height).toBe(2);
    expect(covered?.piece?.owner).toBe("light");
    expect(covered?.piece?.size).toBe(4);
    expect(JSON.stringify(model.squares)).not.toContain("D03");
  });

  it("marks a destination that gobbles", () => {
    const model = buildBoardModel(
      serializedAfter(
        { kind: "reserve", reserveStack: 0, to: "r0c0" },
        { kind: "reserve", reserveStack: 0, to: "r3c3" },
        { kind: "reserve", reserveStack: 0, to: "r0c1" },
        { kind: "reserve", reserveStack: 0, to: "r3c2" },
      ),
      "light",
    );

    const fromBoard = model.destinationsFor({ kind: "board", square: "r0c0" });

    expect(
      fromBoard.some((destination) => destination.gobbles && destination.square === "r3c2"),
    ).toBe(true);
  });

  it("marks the destination that wins", () => {
    const model = buildBoardModel(
      serializedAfter(
        { kind: "reserve", reserveStack: 0, to: "r0c0" },
        { kind: "reserve", reserveStack: 0, to: "r3c0" },
        { kind: "reserve", reserveStack: 0, to: "r0c1" },
        { kind: "reserve", reserveStack: 0, to: "r3c1" },
        { kind: "reserve", reserveStack: 0, to: "r0c2" },
        { kind: "reserve", reserveStack: 0, to: "r3c2" },
      ),
      "light",
    );

    const winning = model.movableOrigins
      .flatMap((origin) => model.destinationsFor(origin))
      .filter((destination) => destination.wins);

    expect(winning.map((destination) => destination.square)).toContain("r0c3");
  });

  it("keeps a losing reveal in the list and marks it", () => {
    const model = buildBoardModel(REVEAL_STATE, "light");

    const fromCovering = model.destinationsFor({ kind: "board", square: "r0c0" });

    expect(fromCovering.some((destination) => destination.losesByReveal)).toBe(true);
    expect(fromCovering.some((destination) => !destination.losesByReveal)).toBe(true);
  });

  it("compares origins by identity, not by reference", () => {
    expect(
      sameOrigin(
        { kind: "reserve", owner: "light", reserveStack: 1 },
        { kind: "reserve", owner: "light", reserveStack: 1 },
      ),
    ).toBe(true);
    expect(
      sameOrigin(
        { kind: "reserve", owner: "light", reserveStack: 1 },
        { kind: "reserve", owner: "dark", reserveStack: 1 },
      ),
    ).toBe(false);
    expect(sameOrigin({ kind: "board", square: "r0c0" }, { kind: "board", square: "r0c0" })).toBe(
      true,
    );
    expect(
      sameOrigin(
        { kind: "board", square: "r0c0" },
        { kind: "reserve", owner: "light", reserveStack: 0 },
      ),
    ).toBe(false);
  });

  it("finds a destination by square, or reports none", () => {
    const model = buildBoardModel(OPENING_STATE, "light");
    const destinations = model.destinationsFor({
      kind: "reserve",
      owner: "light",
      reserveStack: 0,
    });

    expect(findDestination(destinations, "r2c3")?.square).toBe("r2c3");
    expect(findDestination([], "r2c3")).toBeNull();
  });
});
