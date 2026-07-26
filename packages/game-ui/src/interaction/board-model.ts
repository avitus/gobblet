import {
  SQUARES,
  enumerateMoves,
  fromSerializableGameState,
  getPiece,
  getReserveStack,
  topPieceOnBoard,
} from "@gobblet/game-core";
import type {
  EvaluatedMove,
  GameState,
  Move,
  PieceId,
  Player,
  ReserveStackIndex,
  SerializedGameState,
  Square,
} from "@gobblet/game-core";

/**
 * The board as a tier may draw it: only what is visible on a physical board. A
 * covered piece never appears here, so no tier can leak it (appendix P5.5).
 */
export type VisibleSquare = Readonly<{
  square: Square;
  piece: Readonly<{ id: PieceId; owner: Player; size: 1 | 2 | 3 | 4 }> | null;
  /** How many pieces the square holds, which a player can also see and count. */
  height: number;
}>;

export type VisibleReserveStack = Readonly<{
  owner: Player;
  reserveStack: ReserveStackIndex;
  /** The exposed piece, or `null` for an empty stack. */
  piece: Readonly<{ id: PieceId; size: 1 | 2 | 3 | 4 }> | null;
  remaining: number;
}>;

export type Origin =
  | Readonly<{ kind: "reserve"; owner: Player; reserveStack: ReserveStackIndex }>
  | Readonly<{ kind: "board"; square: Square }>;

export type Destination = Readonly<{
  square: Square;
  move: Move;
  /** Set when playing here loses immediately by revealing an opponent line. */
  losesByReveal: boolean;
  /** Set when playing here completes a line of four and wins. */
  wins: boolean;
  /** Set when the destination covers a piece already on the square. */
  gobbles: boolean;
}>;

export type BoardModel = Readonly<{
  squares: readonly VisibleSquare[];
  reserves: readonly VisibleReserveStack[];
  activePlayer: Player;
  /** The origins the player may pick up, in the order `Tab` visits them. */
  movableOrigins: readonly Origin[];
  destinationsFor: (origin: Origin) => readonly Destination[];
}>;

function originKey(origin: Origin): string {
  return origin.kind === "reserve"
    ? `reserve:${origin.owner}:${String(origin.reserveStack)}`
    : `board:${origin.square}`;
}

export function sameOrigin(left: Origin, right: Origin): boolean {
  return originKey(left) === originKey(right);
}

function originOf(move: Move, owner: Player): Origin {
  return move.kind === "reserve"
    ? { kind: "reserve", owner, reserveStack: move.reserveStack }
    : { kind: "board", square: move.from };
}

function toDestination(state: GameState, evaluated: EvaluatedMove): Destination {
  return {
    square: evaluated.move.to,
    move: evaluated.move,
    losesByReveal: evaluated.consequence === "loses-by-reveal",
    wins: evaluated.consequence === "wins",
    gobbles: topPieceOnBoard(state.board, evaluated.move.to) !== null,
  };
}

/**
 * Derives everything a tier and the interaction layer need from one snapshot, with
 * `@gobblet/game-core` as the only source of rules (docs/adr/0012). Losing moves
 * are kept so the interface can warn instead of hiding them.
 */
export function buildBoardModel(serialized: SerializedGameState, seat: Player | null): BoardModel {
  const state = fromSerializableGameState(serialized);
  const squares = SQUARES.map((square): VisibleSquare => {
    const top = topPieceOnBoard(state.board, square);
    return {
      square,
      piece:
        top === null ? null : { id: top, owner: getPiece(top).owner, size: getPiece(top).size },
      height: state.board[square].length,
    };
  });

  const reserves = (["light", "dark"] as const).flatMap((owner) =>
    ([0, 1, 2] as const).map((reserveStack): VisibleReserveStack => {
      const stack = getReserveStack(state, owner, reserveStack);
      const top = stack.at(-1) ?? null;
      return {
        owner,
        reserveStack,
        piece: top === null ? null : { id: top, size: getPiece(top).size },
        remaining: stack.length,
      };
    }),
  );

  const canMove =
    seat !== null && seat === state.activePlayer && state.status.kind === "in-progress";
  const moves = canMove ? enumerateMoves(state) : [];
  const grouped = new Map<string, Destination[]>();
  const order: Origin[] = [];

  for (const evaluated of moves) {
    const origin = originOf(evaluated.move, state.activePlayer);
    const key = originKey(origin);
    const existing = grouped.get(key);
    if (existing) {
      existing.push(toDestination(state, evaluated));
      continue;
    }
    grouped.set(key, [toDestination(state, evaluated)]);
    order.push(origin);
  }

  return {
    squares,
    reserves,
    activePlayer: state.activePlayer,
    movableOrigins: order,
    destinationsFor: (origin) => grouped.get(originKey(origin)) ?? [],
  };
}

/** The square a destination list contains, if any, for a quick membership test. */
export function findDestination(
  destinations: readonly Destination[],
  square: Square,
): Destination | null {
  return destinations.find((destination) => destination.square === square) ?? null;
}
