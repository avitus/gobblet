import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SerializedGameState } from "@gobblet/game-core";
import { useBoardInteraction } from "../src/interaction/use-board-interaction";
import type { BoardInteraction } from "../src/interaction/use-board-interaction";
import { describeScene } from "../src/scene/description";
import {
  PIECE_DIMENSIONS,
  SELECTION_LIFT,
  reservePosition,
  squarePosition,
} from "../src/scene/layout";
import { OPENING_STATE, serializedAfter } from "./helpers/state";

const COVERED_STATE = serializedAfter(
  { kind: "reserve", reserveStack: 0, to: "r1c0" },
  { kind: "reserve", reserveStack: 0, to: "r2c0" },
  { kind: "reserve", reserveStack: 1, to: "r1c1" },
  { kind: "reserve", reserveStack: 0, to: "r0c0" },
  { kind: "board", from: "r1c0", to: "r0c0" },
);

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

function mountInteraction(
  state: SerializedGameState = OPENING_STATE,
  seat: "light" | "dark" = "light",
): () => BoardInteraction {
  let latest: BoardInteraction | null = null;

  function Probe(): null {
    latest = useBoardInteraction({ state, seat, locked: false, onSubmit: () => undefined });
    return null;
  }

  render(<Probe />);
  return () => {
    if (!latest) {
      throw new Error("the interaction layer did not render");
    }
    return latest;
  };
}

describe("the scene description", () => {
  it("places sixteen squares on the board plane", () => {
    const description = describeScene(mountInteraction()());

    expect(description.squares).toHaveLength(16);
    expect(description.squares[0]?.position).toEqual(squarePosition("r0c0"));
    expect(
      description.squares.every(
        (square) => square.highlight === "none" || square.highlight === "cursor",
      ),
    ).toBe(true);
  });

  it("draws one piece per exposed reserve stack and none for an empty board", () => {
    const description = describeScene(mountInteraction()());

    expect(description.pieces).toHaveLength(6);
    expect(description.pieces.map((piece) => piece.key)).toContain("reserve-light-0");
    expect(description.pieces[0]?.radius).toBe(PIECE_DIMENSIONS[4].radius);
  });

  it("draws only the top piece of a covered square", () => {
    const description = describeScene(mountInteraction(COVERED_STATE)());
    const onSquare = description.pieces.filter((piece) => piece.key.startsWith("board-"));

    expect(onSquare.filter((piece) => piece.key === "board-r0c0")).toHaveLength(1);
    expect(onSquare.find((piece) => piece.key === "board-r0c0")?.owner).toBe("light");
  });

  it("lifts the selected and the hovered piece", () => {
    const interaction = mountInteraction();

    act(() => {
      interaction().choose({ kind: "reserve", owner: "light", reserveStack: 0 });
    });
    act(() => {
      interaction().hover({ kind: "reserve", owner: "light", reserveStack: 2 });
    });

    const description = describeScene(interaction());
    const selected = description.pieces.find((piece) => piece.key === "reserve-light-0");
    const hovered = description.pieces.find((piece) => piece.key === "reserve-light-2");
    const untouched = description.pieces.find((piece) => piece.key === "reserve-dark-0");

    expect(selected?.raised).toBe(true);
    expect(selected?.position[1]).toBeCloseTo(reservePosition("light", 0)[1] + SELECTION_LIFT, 6);
    expect(hovered?.raised).toBe(true);
    expect(untouched?.raised).toBe(false);
  });

  it("marks legal destinations, a reveal loss and the keyboard cursor", () => {
    const interaction = mountInteraction(COVERED_STATE, "dark");

    act(() => {
      interaction().moveCursor({ rows: 1 });
    });

    const resting = describeScene(interaction());
    expect(resting.squares.find((square) => square.square === "r1c0")?.highlight).toBe("cursor");

    act(() => {
      interaction().choose({ kind: "reserve", owner: "dark", reserveStack: 1 });
    });

    const selected = describeScene(interaction());
    const legal = selected.squares.filter((square) => square.highlight === "legal");

    expect(legal.length).toBeGreaterThan(0);
    expect(selected.squares.filter((square) => square.focusable).length).toBeGreaterThan(0);
  });

  it("lifts a piece already on the board when it is selected", () => {
    const interaction = mountInteraction(COVERED_STATE, "dark");

    act(() => {
      interaction().choose({ kind: "board", square: "r2c0" });
    });

    const description = describeScene(interaction());
    const selected = description.pieces.find((piece) => piece.key === "board-r2c0");
    const other = description.pieces.find((piece) => piece.key === "board-r0c0");

    expect(selected?.raised).toBe(true);
    expect(selected?.position[1]).toBeCloseTo(squarePosition("r2c0")[1] + SELECTION_LIFT, 6);
    expect(other?.raised).toBe(false);
  });

  it("warns instead of inviting when a destination loses by reveal", () => {
    const interaction = mountInteraction(REVEAL_STATE);

    act(() => {
      interaction().choose({ kind: "board", square: "r0c0" });
    });

    const highlights = describeScene(interaction()).squares.map((square) => square.highlight);

    expect(highlights).toContain("warning");
    expect(highlights).toContain("legal");
  });

  it("draws nothing for a reserve stack that has been emptied", () => {
    const emptied = serializedAfter(
      { kind: "reserve", reserveStack: 0, to: "r0c0" },
      { kind: "reserve", reserveStack: 0, to: "r3c0" },
      { kind: "reserve", reserveStack: 0, to: "r0c1" },
      { kind: "reserve", reserveStack: 0, to: "r3c1" },
      { kind: "reserve", reserveStack: 0, to: "r0c2" },
      { kind: "reserve", reserveStack: 0, to: "r3c2" },
      { kind: "reserve", reserveStack: 0, to: "r1c0" },
      { kind: "reserve", reserveStack: 0, to: "r2c0" },
    );

    const description = describeScene(mountInteraction(emptied)());

    expect(description.pieces.map((piece) => piece.key)).not.toContain("reserve-light-0");
    expect(description.pieces.map((piece) => piece.key)).not.toContain("reserve-dark-0");
    expect(description.pieces.filter((piece) => piece.key.startsWith("reserve-"))).toHaveLength(4);
  });

  it("offers no focus stop while the board is locked", () => {
    let latest: BoardInteraction | null = null;

    function Probe(): null {
      latest = useBoardInteraction({
        state: OPENING_STATE,
        seat: "light",
        locked: true,
        onSubmit: () => undefined,
      });
      return null;
    }

    render(<Probe />);
    if (!latest) {
      throw new Error("the interaction layer did not render");
    }

    expect(describeScene(latest).squares.every((square) => !square.focusable)).toBe(true);
  });
});
