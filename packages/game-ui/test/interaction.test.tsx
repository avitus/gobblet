import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Move, Player, SerializedGameState } from "@gobblet/game-core";
import {
  choosePiece,
  handleBoardKey,
  useBoardInteraction,
} from "../src/interaction/use-board-interaction";
import type { BoardInteraction } from "../src/interaction/use-board-interaction";
import { OPENING_STATE, serializedAfter } from "./helpers/state";

/** Light holds size four on two stacks; dark's size three stands on `r0c1`. */
const COVERABLE_STATE = serializedAfter(
  { kind: "reserve", reserveStack: 0, to: "r3c3" },
  { kind: "reserve", reserveStack: 0, to: "r0c0" },
  { kind: "reserve", reserveStack: 0, to: "r3c2" },
  { kind: "reserve", reserveStack: 0, to: "r0c1" },
);

function mountInteraction(
  options: Readonly<{
    state?: SerializedGameState;
    seat?: Player | null;
    locked?: boolean;
    onSubmit?: (move: Move) => void;
  }> = {},
): () => BoardInteraction {
  let latest: BoardInteraction | null = null;

  function Probe(): null {
    latest = useBoardInteraction({
      state: options.state ?? OPENING_STATE,
      seat: options.seat ?? "light",
      locked: options.locked ?? false,
      onSubmit: options.onSubmit ?? (() => undefined),
    });
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

describe("the interaction layer", () => {
  it("selects an origin and deselects it when chosen twice", () => {
    const interaction = mountInteraction();

    act(() => {
      interaction().choose({ kind: "reserve", owner: "light", reserveStack: 1 });
    });
    expect(interaction().selected).toEqual({
      kind: "reserve",
      owner: "light",
      reserveStack: 1,
    });
    expect(interaction().destinations).toHaveLength(16);

    act(() => {
      interaction().choose({ kind: "reserve", owner: "light", reserveStack: 1 });
    });
    expect(interaction().selected).toBeNull();
    expect(interaction().destinations).toEqual([]);
  });

  it("refuses to select a piece that cannot move", () => {
    const interaction = mountInteraction();

    act(() => {
      interaction().choose({ kind: "reserve", owner: "dark", reserveStack: 0 });
      interaction().choose({ kind: "board", square: "r0c0" });
    });

    expect(interaction().selected).toBeNull();
  });

  it("refuses every gesture while locked", () => {
    const onSubmit = vi.fn();
    const interaction = mountInteraction({ locked: true, onSubmit });

    act(() => {
      interaction().choose({ kind: "reserve", owner: "light", reserveStack: 0 });
      interaction().chooseSquare("r0c0");
    });

    expect(interaction().selected).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits when a selected origin meets a legal destination", () => {
    const onSubmit = vi.fn();
    const interaction = mountInteraction({ onSubmit });

    act(() => {
      interaction().choose({ kind: "reserve", owner: "light", reserveStack: 2 });
    });
    act(() => {
      interaction().chooseSquare("r3c3");
    });

    expect(onSubmit).toHaveBeenCalledWith({ kind: "reserve", reserveStack: 2, to: "r3c3" });
    expect(interaction().selected).toBeNull();
  });

  it("completes a move when the piece pressed is the one being covered", () => {
    const onSubmit = vi.fn();
    const interaction = mountInteraction({ state: COVERABLE_STATE, onSubmit });

    act(() => {
      choosePiece(interaction(), { kind: "board", square: "r3c3" });
    });
    act(() => {
      choosePiece(interaction(), { kind: "board", square: "r0c1" });
    });

    expect(onSubmit).toHaveBeenCalledWith({ kind: "board", from: "r3c3", to: "r0c1" });
  });

  it("ignores a press on an opponent's piece that nothing is aimed at", () => {
    const onSubmit = vi.fn();
    const interaction = mountInteraction({ state: COVERABLE_STATE, onSubmit });

    act(() => {
      choosePiece(interaction(), { kind: "board", square: "r0c1" });
    });

    expect(interaction().selected).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("selects a piece of its own that is pressed, on the board or in the reserve", () => {
    const interaction = mountInteraction({ state: COVERABLE_STATE });

    act(() => {
      choosePiece(interaction(), { kind: "board", square: "r3c3" });
    });
    expect(interaction().selected).toEqual({ kind: "board", square: "r3c3" });

    act(() => {
      choosePiece(interaction(), { kind: "reserve", owner: "light", reserveStack: 2 });
    });
    expect(interaction().selected).toEqual({
      kind: "reserve",
      owner: "light",
      reserveStack: 2,
    });
  });

  it("keeps the cursor inside the board", () => {
    const interaction = mountInteraction();

    act(() => {
      interaction().moveCursor({ rows: -5, columns: -5 });
    });
    expect(interaction().cursor).toBe("r0c0");

    act(() => {
      interaction().moveCursor({ rows: 9, columns: 9 });
    });
    expect(interaction().cursor).toBe("r3c3");

    act(() => {
      interaction().moveCursor({});
    });
    expect(interaction().cursor).toBe("r3c3");
  });

  it("steps through the movable pieces in both directions", () => {
    const interaction = mountInteraction();

    act(() => {
      expect(interaction().focusNextOrigin(1)).toEqual({
        kind: "reserve",
        owner: "light",
        reserveStack: 0,
      });
    });
    act(() => {
      interaction().choose({ kind: "reserve", owner: "light", reserveStack: 0 });
    });
    act(() => {
      expect(interaction().focusNextOrigin(1)).toEqual({
        kind: "reserve",
        owner: "light",
        reserveStack: 1,
      });
      expect(interaction().focusNextOrigin(-1)).toEqual({
        kind: "reserve",
        owner: "light",
        reserveStack: 2,
      });
    });
  });

  it("has nothing to step through when the player cannot move", () => {
    const interaction = mountInteraction({ seat: "dark" });

    act(() => {
      expect(interaction().focusNextOrigin(1)).toBeNull();
    });
  });

  it("tracks the hovered origin", () => {
    const interaction = mountInteraction();

    act(() => {
      interaction().hover({ kind: "board", square: "r1c2" });
    });
    expect(interaction().hovered).toEqual({ kind: "board", square: "r1c2" });

    act(() => {
      interaction().hover(null);
    });
    expect(interaction().hovered).toBeNull();
  });

  it("reports which keys it handled", () => {
    const interaction = mountInteraction();
    const handled = (key: string): boolean => {
      let result = false;
      act(() => {
        result = handleBoardKey(interaction(), { key });
      });
      return result;
    };

    for (const key of [
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "w",
      "W",
      "a",
      "A",
      "s",
      "S",
      "d",
      "D",
      "Enter",
      " ",
      "Escape",
    ]) {
      expect(handled(key)).toBe(true);
    }
    expect(handled("q")).toBe(false);
  });
});
