import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * The canvas needs a real graphics context, which jsdom has none of, so it is
 * replaced here by a stub that reports its lifecycle. What the scene draws is
 * proved by the scene description tests and by the browser suite (docs/adr/0021).
 */
const { lostContext } = vi.hoisted(() => ({ lostContext: { fire: () => undefined } }));

vi.mock("@react-three/fiber", () => ({
  Canvas: (props: Readonly<{ onCreated?: (state: { gl: unknown }) => void }>) => {
    const listeners: (() => void)[] = [];
    const domElement = {
      addEventListener: (_event: string, listener: (event: Event) => void) => {
        listeners.push(() => {
          listener({ preventDefault: () => undefined } as Event);
        });
      },
    };
    props.onCreated?.({ gl: { domElement } });
    lostContext.fire = () => {
      for (const listener of listeners) {
        listener();
      }
    };
    return <div data-testid="canvas" />;
  },
}));

const { BoardView } = await import("../src/BoardView");
const { OPENING_STATE } = await import("./helpers/state");

describe("BoardView", () => {
  it("falls back to the flat board when the machine offers no WebGL", () => {
    render(
      <BoardView state={OPENING_STATE} seat="light" locked={false} onSubmit={() => undefined} />,
    );

    expect(screen.getByTestId("flat-board")).toBeInTheDocument();
  });

  it("renders the scene for a tier that needs a canvas", () => {
    render(
      <BoardView
        state={OPENING_STATE}
        seat="light"
        locked={false}
        onSubmit={() => undefined}
        initialTier="full"
      />,
    );

    expect(screen.getByTestId("board-scene")).toHaveAttribute("data-tier", "full");
    expect(screen.getByTestId("canvas")).toBeInTheDocument();
    expect(screen.getByTestId("scene-square-r0c0")).toBeInTheDocument();
  });

  it("downgrades without losing the match view when the context is lost", async () => {
    render(
      <BoardView
        state={OPENING_STATE}
        seat="light"
        locked={false}
        onSubmit={() => undefined}
        initialTier="reduced"
      />,
    );

    expect(screen.getByTestId("board-scene")).toHaveAttribute("data-tier", "reduced");

    lostContext.fire();

    expect(await screen.findByTestId("flat-board")).toBeInTheDocument();
  });
});
