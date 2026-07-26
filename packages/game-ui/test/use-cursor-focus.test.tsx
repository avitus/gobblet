import { render, screen } from "@testing-library/react";
import { useRef } from "react";
import type { Square } from "@gobblet/game-core";
import { describe, expect, it } from "vitest";
import { useCursorFocus } from "../src/interaction/use-cursor-focus";

type HarnessProps = Readonly<{
  cursor: Square;
  /** Squares that exist in the document, so a cursor can name a missing one. */
  squares?: readonly Square[];
}>;

function Harness({ cursor, squares = ["r0c0", "r1c0"] }: HarnessProps): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null);
  const elements = useCursorFocus(container, cursor);

  return (
    <div ref={container} data-testid="container">
      {squares.map((square) => (
        <button
          key={square}
          type="button"
          data-testid={square}
          ref={(element) => {
            elements.current.set(square, element);
          }}
        >
          {square}
        </button>
      ))}
    </div>
  );
}

describe("useCursorFocus", () => {
  it("does nothing while the container holds no focus", () => {
    const { rerender } = render(<Harness cursor="r0c0" />);

    rerender(<Harness cursor="r1c0" />);

    expect(document.body).toHaveFocus();
  });

  it("follows the cursor once the container has focus", () => {
    const { rerender } = render(<Harness cursor="r0c0" />);

    screen.getByTestId("r0c0").focus();
    rerender(<Harness cursor="r1c0" />);

    expect(screen.getByTestId("r1c0")).toHaveFocus();
  });

  it("leaves the focus where it is when the cursor names nothing rendered", () => {
    const { rerender } = render(<Harness cursor="r0c0" squares={["r0c0"]} />);

    screen.getByTestId("r0c0").focus();
    rerender(<Harness cursor="r2c3" squares={["r0c0"]} />);

    expect(screen.getByTestId("r0c0")).toHaveFocus();
  });

  it("does not refocus the element the player just reached", () => {
    const { rerender } = render(<Harness cursor="r0c0" />);

    const target = screen.getByTestId("r1c0");
    target.focus();
    let refocused = 0;
    target.addEventListener("focus", () => {
      refocused += 1;
    });

    rerender(<Harness cursor="r1c0" />);

    expect(target).toHaveFocus();
    expect(refocused).toBe(0);
  });
});
