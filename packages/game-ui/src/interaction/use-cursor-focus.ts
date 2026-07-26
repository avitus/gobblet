import type { Square } from "@gobblet/game-core";
import { useEffect, useRef } from "react";
import type { RefObject } from "react";

export type SquareElements = RefObject<Map<Square, HTMLElement | null>>;

/**
 * Keeps browser focus on the square the keyboard cursor names, but only while the
 * board already holds focus, so arrow keys move the focus ring with the cursor
 * (section 13.3) and a board nobody is using never steals it.
 */
export function useCursorFocus(
  container: RefObject<HTMLElement | null>,
  cursor: Square,
): SquareElements {
  const elements = useRef<Map<Square, HTMLElement | null>>(new Map());

  useEffect(() => {
    const root = container.current;
    const target = elements.current.get(cursor) ?? null;
    if (root === null || target === null || !root.contains(document.activeElement)) {
      return;
    }
    if (document.activeElement !== target) {
      target.focus();
    }
  }, [container, cursor]);

  return elements;
}
