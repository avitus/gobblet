import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Move, Player, SerializedGameState } from "@gobblet/game-core";
import { FlatBoard } from "../src/flat/FlatBoard";
import { useBoardInteraction } from "../src/interaction/use-board-interaction";
import { OPENING_STATE, serializedAfter } from "./helpers/state";

/**
 * Light covers a dark size three on `r0c0` while dark holds the rest of row 0, so
 * lifting the cover reveals a dark line of four.
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

type HarnessProps = Readonly<{
  state?: SerializedGameState;
  seat?: Player | null;
  locked?: boolean;
  onSubmit?: (move: Move) => void;
}>;

function Harness({
  state = OPENING_STATE,
  seat = "light",
  locked = false,
  onSubmit = () => undefined,
}: HarnessProps): React.JSX.Element {
  const interaction = useBoardInteraction({ state, seat, locked, onSubmit });
  return <FlatBoard interaction={interaction} seat={seat} />;
}

describe("the flat board", () => {
  it("draws sixteen squares and six reserve stacks without any WebGL", () => {
    render(<Harness />);

    expect(screen.getByTestId("flat-board")).toHaveAttribute("data-tier", "flat");
    expect(screen.getAllByRole("gridcell")).toHaveLength(16);
    expect(screen.getByTestId("reserve-light-0")).toBeEnabled();
    expect(screen.getByTestId("reserve-dark-0")).toBeDisabled();
  });

  it("never draws or names a covered piece", () => {
    render(<Harness state={REVEAL_STATE} />);

    const covered = screen.getByTestId("square-r0c0");

    expect(covered).toHaveAttribute("data-owner", "light");
    expect(covered).toHaveAttribute("data-size", "4");
    expect(covered.getAttribute("aria-label")).toBe("Square r0c0, light largest, covering 1");
    expect(document.body.textContent).not.toContain("D03");
  });

  it("lifts a selected reserve piece and lights every legal destination", async () => {
    render(<Harness />);

    await userEvent.click(screen.getByTestId("reserve-light-0"));

    expect(screen.getByTestId("reserve-light-0")).toHaveAttribute("data-selected", "true");
    expect(
      screen.getAllByRole("gridcell").filter((cell) => cell.dataset.destination === "true"),
    ).toHaveLength(16);
  });

  it("warns on a destination that loses by reveal", async () => {
    render(<Harness state={REVEAL_STATE} />);

    await userEvent.click(screen.getByTestId("square-r0c0"));

    const warned = screen
      .getAllByRole("gridcell")
      .filter((cell) => cell.dataset.revealLoss === "true");

    expect(warned.length).toBeGreaterThan(0);
    expect(warned[0]?.getAttribute("aria-label")).toContain("loses by reveal");
  });

  it("submits the move when a destination is clicked", async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    await userEvent.click(screen.getByTestId("reserve-light-0"));
    await userEvent.click(screen.getByTestId("square-r2c3"));

    expect(onSubmit).toHaveBeenCalledWith({ kind: "reserve", reserveStack: 0, to: "r2c3" });
  });

  it("cancels an unsubmitted selection with Escape", async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    await userEvent.click(screen.getByTestId("reserve-light-0"));
    await userEvent.keyboard("{Escape}");

    expect(screen.getByTestId("reserve-light-0")).toHaveAttribute("data-selected", "false");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("moves a cursor with the arrow keys and submits with Enter", async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    await userEvent.click(screen.getByTestId("reserve-light-0"));
    await userEvent.keyboard("{ArrowDown}{ArrowRight}{Enter}");

    expect(onSubmit).toHaveBeenCalledWith({ kind: "reserve", reserveStack: 0, to: "r1c1" });
  });

  it("moves the cursor with WASD as well", async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    await userEvent.click(screen.getByTestId("reserve-light-0"));
    await userEvent.keyboard("ss d{Enter}");

    expect(onSubmit).toHaveBeenCalledWith({ kind: "reserve", reserveStack: 0, to: "r2c0" });
  });

  it("moves the focus ring with the cursor", async () => {
    render(<Harness />);

    await userEvent.click(screen.getByTestId("reserve-light-0"));
    screen.getByTestId("square-r0c0").focus();

    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByTestId("square-r1c0")).toHaveFocus();
    expect(screen.getByTestId("square-r1c0")).toHaveAttribute("data-cursor", "true");

    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByTestId("square-r1c1")).toHaveFocus();
  });

  it("takes the cursor from the square the player tabbed to", async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    await userEvent.click(screen.getByTestId("reserve-light-0"));
    screen.getByTestId("square-r2c2").focus();
    await userEvent.keyboard("{Enter}");

    expect(onSubmit).toHaveBeenCalledWith({ kind: "reserve", reserveStack: 0, to: "r2c2" });
  });

  it("leaves the focus alone while nothing on the board holds it", async () => {
    render(
      <div>
        <button type="button" data-testid="outside">
          outside
        </button>
        <Harness />
      </div>,
    );

    screen.getByTestId("outside").focus();
    await userEvent.keyboard("{ArrowDown}");

    expect(screen.getByTestId("outside")).toHaveFocus();
  });

  it("refuses every input while a command is pending", async () => {
    const onSubmit = vi.fn();
    render(<Harness locked onSubmit={onSubmit} />);

    expect(screen.getByTestId("reserve-light-0")).toBeDisabled();
    await userEvent.keyboard("{Enter}");

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("seats the local player's reserve nearest", () => {
    const { rerender } = render(<Harness seat="light" />);
    const groups = () =>
      screen.getAllByRole("group").map((group) => group.getAttribute("aria-label"));

    expect(groups()).toEqual(["dark reserve", "light reserve"]);

    rerender(<Harness seat="dark" state={OPENING_STATE} />);
    expect(groups()).toEqual(["light reserve", "dark reserve"]);
  });

  it("seats an onlooker behind the light reserve and offers no input", async () => {
    const onSubmit = vi.fn();
    render(<Harness seat={null} onSubmit={onSubmit} />);

    expect(screen.getAllByRole("group").map((group) => group.getAttribute("aria-label"))).toEqual([
      "dark reserve",
      "light reserve",
    ]);
    await userEvent.click(screen.getByTestId("reserve-light-0"));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("raises the piece under the pointer and drops it again", async () => {
    render(<Harness />);

    const stack = screen.getByTestId("reserve-light-0");
    await userEvent.hover(stack);
    expect(stack).toHaveAttribute("data-hovered", "true");

    await userEvent.unhover(stack);
    expect(stack).toHaveAttribute("data-hovered", "false");

    const square = screen.getByTestId("square-r1c1");
    await userEvent.hover(square);
    await userEvent.unhover(square);
    expect(square).toHaveAttribute("data-hovered", "false");
  });

  it("describes an empty reserve stack as empty", () => {
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

    render(<Harness state={emptied} />);

    expect(screen.getByTestId("reserve-light-0")).toHaveAttribute(
      "aria-label",
      "light reserve stack 1, empty",
    );
  });
});
