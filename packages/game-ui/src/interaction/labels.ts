import type { Player } from "@gobblet/game-core";
import type { VisibleReserveStack, VisibleSquare } from "./board-model";

const SIZE_LABELS: Readonly<Record<1 | 2 | 3 | 4, string>> = Object.freeze({
  1: "smallest",
  2: "small",
  3: "large",
  4: "largest",
});

export function pieceLabel(owner: Player, size: 1 | 2 | 3 | 4): string {
  return `${owner} ${SIZE_LABELS[size]}`;
}

/**
 * Names only what is visible. The height of a stack is describable because a player
 * can see it, but the identity of a covered piece is not (appendix P5.5). Every tier
 * shares these labels, so a player hears the same board whichever tier draws it.
 */
export function squareLabel(square: VisibleSquare, losesByReveal: boolean): string {
  const place = `Square ${square.square}`;
  const content =
    square.piece === null
      ? "empty"
      : `${pieceLabel(square.piece.owner, square.piece.size)}${
          square.height > 1 ? `, covering ${String(square.height - 1)}` : ""
        }`;
  return losesByReveal ? `${place}, ${content}, loses by reveal` : `${place}, ${content}`;
}

export function reserveLabel(stack: VisibleReserveStack): string {
  if (stack.piece === null) {
    return `${stack.owner} reserve stack ${String(stack.reserveStack + 1)}, empty`;
  }
  return `${pieceLabel(stack.owner, stack.piece.size)}, ${String(stack.remaining)} left`;
}
