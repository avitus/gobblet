import {
  PLAYERS,
  fromSerializableGameState,
  isReserveStackIndex,
  isSquare,
} from "@gobblet/game-core";
import type { ReserveStackIndex, SerializedGameState, Square } from "@gobblet/game-core";
import { z } from "zod";

export const playerSchema = z.enum(PLAYERS);

export const squareSchema = z.custom<Square>((value) => isSquare(value), {
  message: "expected a canonical square such as r0c3",
});

export const reserveStackIndexSchema = z.custom<ReserveStackIndex>(
  (value) => isReserveStackIndex(value),
  { message: "expected an external stack index of 0, 1 or 2" },
);

export const reserveMoveSchema = z.strictObject({
  kind: z.literal("reserve"),
  reserveStack: reserveStackIndexSchema,
  to: squareSchema,
});

export const boardMoveSchema = z.strictObject({
  kind: z.literal("board"),
  from: squareSchema,
  to: squareSchema,
});

export const moveSchema = z.discriminatedUnion("kind", [reserveMoveSchema, boardMoveSchema]);

/**
 * Delegates to the rules engine rather than re-modelling the state, so board and
 * reserve invariants keep exactly one implementation (docs/adr/0012).
 */
export const serializedGameStateSchema = z.custom<SerializedGameState>(
  (value) => {
    try {
      fromSerializableGameState(value);
      return true;
    } catch {
      return false;
    }
  },
  { message: "expected a game state produced by @gobblet/game-core" },
);

export type {
  BoardMove,
  Move,
  Player,
  ReserveMove,
  ReserveStackIndex,
  SerializedGameState,
  Square,
} from "@gobblet/game-core";
