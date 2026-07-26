import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Move, Player, SerializedGameState } from "@gobblet/game-core";

vi.mock("@react-three/fiber", () => ({
  Canvas: () => <div data-testid="canvas" />,
}));

const { BoardScene } = await import("../src/scene/BoardScene");
const { placeCamera } = await import("../src/scene/camera");
const { projectStops } = await import("../src/scene/projection");
const { useBoardInteraction } = await import("../src/interaction/use-board-interaction");
const { tierSettings } = await import("../src/tier");
const { OPENING_STATE, serializedAfter } = await import("./helpers/state");

/** Light covers a dark size three on `r0c0`, over a dark row waiting to be revealed. */
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
  return <BoardScene interaction={interaction} seat={seat} settings={tierSettings("full")} />;
}

describe("the scene's keyboard surface", () => {
  it("offers the same focus stops the flat tier offers", () => {
    render(<Harness />);

    expect(screen.getAllByRole("gridcell")).toHaveLength(16);
    expect(screen.getAllByRole("row")).toHaveLength(4);
    expect(screen.getByTestId("scene-reserve-light-0")).toBeEnabled();
    expect(screen.getByTestId("scene-reserve-dark-0")).toBeDisabled();
  });

  it("lays every stop over the square the camera draws", () => {
    render(<Harness />);
    const stops = projectStops(placeCamera("light"));

    for (const { square, box } of stops.squares) {
      const element = screen.getByTestId(`scene-square-${square}`);
      expect(element.style.left).toBe(`${String(box.left)}%`);
      expect(element.style.top).toBe(`${String(box.top)}%`);
      expect(element.style.width).toBe(`${String(box.width)}%`);
      expect(element.style.height).toBe(`${String(box.height)}%`);
    }

    for (const { owner, reserveStack, box } of stops.reserves) {
      const element = screen.getByTestId(`scene-reserve-${owner}-${String(reserveStack)}`);
      expect(element.style.left).toBe(`${String(box.left)}%`);
      expect(element.style.top).toBe(`${String(box.top)}%`);
    }
  });

  it("follows the seat, because the rig turns for a player seated as dark", () => {
    render(<Harness seat="dark" />);
    const expected = projectStops(placeCamera("dark")).squares.find(
      (stop) => stop.square === "r0c0",
    );

    expect(expected).toBeDefined();
    expect(screen.getByTestId("scene-square-r0c0").style.top).toBe(
      `${String(expected?.box.top ?? 0)}%`,
    );
  });

  it("names a square exactly as the flat tier names it", () => {
    render(<Harness state={REVEAL_STATE} />);

    expect(screen.getByTestId("scene-square-r0c0")).toHaveAccessibleName(
      "Square r0c0, light largest, covering 1",
    );
    expect(screen.getByTestId("scene-reserve-light-0")).toHaveAccessibleName("light small, 2 left");
  });

  it("warns on a destination that loses by reveal", async () => {
    render(<Harness state={REVEAL_STATE} seat="light" />);

    await userEvent.click(screen.getByTestId("scene-square-r0c0"));

    expect(screen.getByTestId("scene-square-r1c0")).toHaveAccessibleName(
      "Square r1c0, empty, loses by reveal",
    );
    expect(screen.getByTestId("scene-square-r1c0")).toHaveAttribute("data-highlight", "warning");
  });

  it("lifts a reserve piece and submits the move a focus stop names", async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    await userEvent.click(screen.getByTestId("scene-reserve-light-0"));
    await userEvent.click(screen.getByTestId("scene-square-r2c1"));

    expect(onSubmit).toHaveBeenCalledWith({ kind: "reserve", reserveStack: 0, to: "r2c1" });
  });

  it("moves the focus ring with the cursor", async () => {
    render(<Harness />);

    await userEvent.click(screen.getByTestId("scene-reserve-light-0"));
    screen.getByTestId("scene-square-r0c0").focus();

    await userEvent.keyboard("{ArrowDown}{ArrowRight}");

    expect(screen.getByTestId("scene-square-r1c1")).toHaveFocus();
    expect(screen.getByTestId("scene-square-r1c1")).toHaveAttribute("data-cursor", "true");
  });

  it("takes the cursor from the square the player tabbed to", async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    await userEvent.click(screen.getByTestId("scene-reserve-light-0"));
    screen.getByTestId("scene-square-r3c2").focus();
    await userEvent.keyboard("{Enter}");

    expect(onSubmit).toHaveBeenCalledWith({ kind: "reserve", reserveStack: 0, to: "r3c2" });
  });

  it("offers an onlooker nothing to press", () => {
    render(<Harness seat={null} />);

    expect(screen.getByTestId("scene-square-r0c0")).toBeDisabled();
    expect(screen.getByTestId("scene-reserve-light-0")).toBeDisabled();
  });

  it("refuses every input while a command is pending", () => {
    render(<Harness locked />);

    expect(screen.getByTestId("scene-square-r0c0")).toBeDisabled();
    expect(screen.getByTestId("scene-reserve-light-0")).toBeDisabled();
  });
});
