import { SQUARES, squareAt } from "@gobblet/game-core";
import type { Move, Player, Square } from "@gobblet/game-core";
import { useCallback, useMemo, useState } from "react";
import { buildBoardModel, findDestination, sameOrigin } from "./board-model";
import type { BoardModel, Destination, Origin } from "./board-model";

export type BoardInteraction = Readonly<{
  model: BoardModel;
  selected: Origin | null;
  /** Keyboard cursor. The pointer does not move it, so the two never fight. */
  cursor: Square;
  destinations: readonly Destination[];
  locked: boolean;
  hovered: Origin | null;
  isMovable: (origin: Origin) => boolean;
  isHovered: (origin: Origin) => boolean;
  destinationAt: (square: Square) => Destination | null;
  hover: (origin: Origin | null) => void;
  /** Selects an origin, or submits when the origin is already selected. */
  choose: (origin: Origin) => void;
  chooseSquare: (square: Square) => void;
  cancel: () => void;
  moveCursor: (delta: Readonly<{ rows?: number; columns?: number }>) => void;
  /** Puts the cursor on a square, so browser focus and the cursor never disagree. */
  focusSquare: (square: Square) => void;
  /** `Enter` on the cursor: select the piece under it, or submit there. */
  confirmCursor: () => void;
  focusNextOrigin: (direction: 1 | -1) => Origin | null;
}>;

export type BoardInteractionOptions = Readonly<{
  state: Parameters<typeof buildBoardModel>[0];
  seat: Player | null;
  locked: boolean;
  onSubmit: (move: Move) => void;
}>;

const ROW_STRIDE = 4;

function shiftSquare(square: Square, rows: number, columns: number): Square {
  const index = SQUARES.indexOf(square);
  const row = Math.floor(index / ROW_STRIDE);
  const column = index % ROW_STRIDE;
  const nextRow = Math.min(3, Math.max(0, row + rows));
  const nextColumn = Math.min(3, Math.max(0, column + columns));
  return squareAt(nextRow as 0 | 1 | 2 | 3, nextColumn as 0 | 1 | 2 | 3);
}

/**
 * The one interaction layer above every rendering tier (docs/adr/0023). It owns
 * selection, the legal destinations, the reveal warning and the submission
 * gesture, and it contributes no rule of its own: everything comes from the model.
 */
export function useBoardInteraction(options: BoardInteractionOptions): BoardInteraction {
  const { state, seat, locked, onSubmit } = options;
  const model = useMemo(() => buildBoardModel(state, seat), [state, seat]);
  const [selected, setSelected] = useState<Origin | null>(null);
  const [hovered, setHovered] = useState<Origin | null>(null);
  const [cursor, setCursor] = useState<Square>("r0c0");

  const destinations = useMemo(
    () => (selected === null ? [] : model.destinationsFor(selected)),
    [model, selected],
  );

  const isMovable = useCallback(
    (origin: Origin) => model.movableOrigins.some((candidate) => sameOrigin(candidate, origin)),
    [model],
  );

  const isHovered = useCallback(
    (origin: Origin) => hovered !== null && sameOrigin(hovered, origin),
    [hovered],
  );

  const submit = useCallback(
    (destination: Destination) => {
      setSelected(null);
      setHovered(null);
      onSubmit(destination.move);
    },
    [onSubmit],
  );

  const choose = useCallback(
    (origin: Origin) => {
      if (locked || !isMovable(origin)) {
        return;
      }
      setSelected((current) => (current && sameOrigin(current, origin) ? null : origin));
    },
    [isMovable, locked],
  );

  const chooseSquare = useCallback(
    (square: Square) => {
      if (locked) {
        return;
      }
      const destination = findDestination(destinations, square);
      if (destination) {
        submit(destination);
        return;
      }
      choose({ kind: "board", square });
    },
    [choose, destinations, locked, submit],
  );

  const cancel = useCallback(() => {
    setSelected(null);
  }, []);

  const moveCursor = useCallback((delta: Readonly<{ rows?: number; columns?: number }>) => {
    setCursor((current) => shiftSquare(current, delta.rows ?? 0, delta.columns ?? 0));
  }, []);

  const confirmCursor = useCallback(() => {
    chooseSquare(cursor);
  }, [chooseSquare, cursor]);

  const focusSquare = useCallback((square: Square) => {
    setCursor(square);
  }, []);

  const focusNextOrigin = useCallback(
    (direction: 1 | -1): Origin | null => {
      const origins = model.movableOrigins;
      const index = selected
        ? origins.findIndex((candidate) => sameOrigin(candidate, selected))
        : -1;
      const next = origins.at((index + direction + origins.length) % (origins.length || 1));
      if (next === undefined) {
        return null;
      }
      setHovered(next);
      return next;
    },
    [model, selected],
  );

  return {
    model,
    selected,
    cursor,
    destinations,
    locked,
    hovered,
    isMovable,
    isHovered,
    destinationAt: (square) => findDestination(destinations, square),
    hover: setHovered,
    choose,
    chooseSquare,
    cancel,
    moveCursor,
    focusSquare,
    confirmCursor,
    focusNextOrigin,
  };
}

export type BoardKeyboardEvent = Readonly<{
  key: string;
  shiftKey?: boolean;
  /** True when the focused element activates itself, as a button does on Enter. */
  onControl?: boolean;
}>;

/** Every focus stop is a button, and a button is activated by the browser. */
export function activatesItself(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest("button") !== null;
}

/**
 * The keyboard model of section 13.3, kept apart from React so it can be tested
 * and reused by every tier. `Tab` is left to the browser: the focus stops are real
 * DOM elements, transparent ones over the canvas in the WebGL tiers.
 */
export function handleBoardKey(interaction: BoardInteraction, event: BoardKeyboardEvent): boolean {
  switch (event.key) {
    case "ArrowUp":
    case "w":
    case "W":
      interaction.moveCursor({ rows: -1 });
      return true;
    case "ArrowDown":
    case "s":
    case "S":
      interaction.moveCursor({ rows: 1 });
      return true;
    case "ArrowLeft":
    case "a":
    case "A":
      interaction.moveCursor({ columns: -1 });
      return true;
    case "ArrowRight":
    case "d":
    case "D":
      interaction.moveCursor({ columns: 1 });
      return true;
    case "Enter":
    case " ":
      if (event.onControl === true) {
        // The browser is about to click the focused stop, which is the same gesture.
        return false;
      }
      interaction.confirmCursor();
      return true;
    case "Escape":
      interaction.cancel();
      return true;
    default:
      return false;
  }
}
