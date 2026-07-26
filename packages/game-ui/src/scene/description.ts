import type { Player, Square } from "@gobblet/game-core";
import type { BoardInteraction } from "../interaction/use-board-interaction";
import type { Origin } from "../interaction/board-model";
import { sameOrigin } from "../interaction/board-model";
import { PIECE_DIMENSIONS, lift, reservePosition, squarePosition } from "./layout";
import type { PieceSizeKey, Vector3 } from "./layout";

/**
 * What the WebGL tiers draw, as data. Keeping the decision here means the scene
 * component is a mapping with nothing to test in a browser, and the rule that only
 * the top piece of a stack is ever drawn is enforced in one place (appendix P5.5).
 */
export type SquareNode = Readonly<{
  square: Square;
  position: Vector3;
  /** `legal`, `warning` for a reveal loss, `cursor` for the keyboard, or `none`. */
  highlight: "none" | "legal" | "warning" | "cursor";
  focusable: boolean;
}>;

export type PieceNode = Readonly<{
  key: string;
  owner: Player;
  size: PieceSizeKey;
  radius: number;
  height: number;
  position: Vector3;
  raised: boolean;
  origin: Origin;
}>;

export type SceneDescription = Readonly<{
  squares: readonly SquareNode[];
  pieces: readonly PieceNode[];
}>;

function isSelected(interaction: BoardInteraction, origin: Origin): boolean {
  const { selected } = interaction;
  return selected !== null && sameOrigin(selected, origin);
}

export function describeScene(interaction: BoardInteraction): SceneDescription {
  const { model } = interaction;

  const squares = model.squares.map((visible): SquareNode => {
    const destination = interaction.destinationAt(visible.square);
    const highlight = ((): SquareNode["highlight"] => {
      if (destination) {
        return destination.losesByReveal ? "warning" : "legal";
      }
      return interaction.cursor === visible.square ? "cursor" : "none";
    })();

    return {
      square: visible.square,
      position: squarePosition(visible.square),
      highlight,
      focusable:
        !interaction.locked &&
        (destination !== null || interaction.isMovable({ kind: "board", square: visible.square })),
    };
  });

  const boardPieces = model.squares.flatMap((visible): PieceNode[] => {
    if (visible.piece === null) {
      return [];
    }
    const origin: Origin = { kind: "board", square: visible.square };
    const dimensions = PIECE_DIMENSIONS[visible.piece.size];
    const base = squarePosition(visible.square);
    const raised = isSelected(interaction, origin) || interaction.isHovered(origin);

    return [
      {
        key: `board-${visible.square}`,
        owner: visible.piece.owner,
        size: visible.piece.size,
        radius: dimensions.radius,
        height: dimensions.height,
        position: raised ? lift(base) : base,
        raised,
        origin,
      },
    ];
  });

  const reservePieces = model.reserves.flatMap((stack): PieceNode[] => {
    if (stack.piece === null) {
      return [];
    }
    const origin: Origin = {
      kind: "reserve",
      owner: stack.owner,
      reserveStack: stack.reserveStack,
    };
    const dimensions = PIECE_DIMENSIONS[stack.piece.size];
    const base = reservePosition(stack.owner, stack.reserveStack);
    const raised = isSelected(interaction, origin) || interaction.isHovered(origin);

    return [
      {
        key: `reserve-${stack.owner}-${String(stack.reserveStack)}`,
        owner: stack.owner,
        size: stack.piece.size,
        radius: dimensions.radius,
        height: dimensions.height,
        position: raised ? lift(base) : base,
        raised,
        origin,
      },
    ];
  });

  return { squares, pieces: [...boardPieces, ...reservePieces] };
}
