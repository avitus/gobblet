/**
 * Domain types for standard 4x4 Gobblet.
 *
 * See docs/rules.md for the formal rule statement these types encode.
 */

export type Player = "light" | "dark";

export type PlayerCode = "L" | "D";

export type PieceSize = 1 | 2 | 3 | 4;

export type ReserveStackIndex = 0 | 1 | 2;

export type RowIndex = 0 | 1 | 2 | 3;

export type ColumnIndex = 0 | 1 | 2 | 3;

/** Stable canonical square key, for example `r0c3` (row 0, column 3). */
export type Square = `r${RowIndex}c${ColumnIndex}`;

/**
 * Immutable piece identity: owner code, originating external stack, size.
 * `L24` is the light size-4 piece that started in external stack 2.
 */
export type PieceId = `${PlayerCode}${ReserveStackIndex}${PieceSize}`;

export type Piece = Readonly<{
  id: PieceId;
  owner: Player;
  size: PieceSize;
  reserveStack: ReserveStackIndex;
}>;

export type LineKind = "row" | "column" | "diagonal";

export type LineId = `row-${RowIndex}` | `column-${ColumnIndex}` | `diagonal-${0 | 1}`;

export type LineSquares = readonly [Square, Square, Square, Square];

export type Line = Readonly<{
  id: LineId;
  kind: LineKind;
  index: number;
  squares: LineSquares;
}>;

/** A completed line of four visible pieces owned by one player. */
export type WinningLine = Readonly<{
  id: LineId;
  kind: LineKind;
  index: number;
  squares: LineSquares;
  player: Player;
  pieces: readonly [PieceId, PieceId, PieceId, PieceId];
}>;

/** Pieces on one board square, ordered bottom to top. Only the last entry is visible. */
export type SquareStack = readonly PieceId[];

export type BoardState = Readonly<Record<Square, SquareStack>>;

/** Pieces in one external stack, ordered bottom to top. The last entry is exposed. */
export type ReserveStack = readonly PieceId[];

export type PlayerReserves = readonly [ReserveStack, ReserveStack, ReserveStack];

export type ReserveState = Readonly<Record<Player, PlayerReserves>>;

export type WinReason =
  /** The player completed a visible line of four. */
  | "line"
  /** The opponent lifted a piece, revealed this player's line of four and failed to block it. */
  | "revealed-line";

export type DrawReason = "threefold-repetition";

export type GameStatus =
  | Readonly<{ kind: "in-progress" }>
  | Readonly<{ kind: "win"; winner: Player; reason: WinReason }>
  | Readonly<{ kind: "draw"; reason: DrawReason }>;

/**
 * Occurrence counter for canonical positions, keyed by
 * {@link canonicalPositionKey}. Clocks are never part of a position key.
 */
export type RepetitionState = Readonly<{
  counts: Readonly<Record<string, number>>;
}>;

export type GameState = Readonly<{
  version: 1;
  board: BoardState;
  reserves: ReserveState;
  activePlayer: Player;
  ply: number;
  repetition: RepetitionState;
  status: GameStatus;
}>;

/** Entering a piece from one of the player's external stacks. */
export type ReserveMove = Readonly<{
  kind: "reserve";
  reserveStack: ReserveStackIndex;
  to: Square;
}>;

/** Moving a visible piece that is already on the board. */
export type BoardMove = Readonly<{
  kind: "board";
  from: Square;
  to: Square;
}>;

export type Move = ReserveMove | BoardMove;

export type IllegalMoveReason =
  /** The match already reached a terminal state. */
  | "game-over"
  /** A square reference is not one of the sixteen canonical squares. */
  | "invalid-square"
  /** A reserve stack reference is not 0, 1 or 2. */
  | "invalid-reserve-stack"
  /** The referenced external stack has no pieces left. */
  | "empty-reserve-stack"
  /** The source square holds no pieces. */
  | "empty-source-square"
  /** The visible piece on the source square belongs to the opponent. */
  | "piece-not-owned"
  /** Source and destination are the same square. */
  | "same-square"
  /** The visible piece on the destination square is the same size or larger. */
  | "destination-piece-not-smaller"
  /** A reserve piece may never be placed on top of one of the mover's own pieces. */
  | "reserve-cannot-cover-own-piece"
  /**
   * A reserve piece may only cover an opponent piece that is part of a line where
   * the opponent already has three visible pieces (official defensive exception).
   */
  | "reserve-cover-requires-opponent-three-line";

export type MoveConsequence = "continues" | "wins" | "loses-by-reveal" | "draws-by-repetition";

export type LegalMoveEvaluation = Readonly<{
  move: Move;
  legal: true;
  consequence: MoveConsequence;
  /** Opponent lines of four exposed by lifting the moving piece. */
  revealedOpponentLines: readonly WinningLine[];
  /** Revealed opponent lines that the destination placement breaks. */
  blockedOpponentLines: readonly WinningLine[];
  /** Lines of four visible after the move, belonging to the player named by the resulting status. */
  resultingWinningLines: readonly WinningLine[];
  /** Canonical key of the resulting position, with the opponent to move. */
  positionKey: string;
}>;

export type IllegalMoveEvaluation = Readonly<{
  move: Move;
  legal: false;
  reason: IllegalMoveReason;
}>;

export type MoveEvaluation = LegalMoveEvaluation | IllegalMoveEvaluation;

/**
 * Structurally possible move plus its terminal consequence, as returned by
 * `enumerateMoves`. Losing moves are enumerated on purpose so the UI can warn
 * instead of hiding them.
 */
export type EvaluatedMove = LegalMoveEvaluation;

export type MoveResult =
  | Readonly<{ ok: true; state: GameState; evaluation: LegalMoveEvaluation }>
  | Readonly<{ ok: false; reason: IllegalMoveReason }>;

export type InvariantViolationCode =
  | "unsupported-state-version"
  | "invalid-ply"
  | "invalid-active-player"
  | "unknown-piece"
  | "duplicate-piece"
  | "missing-piece"
  | "piece-count-per-player"
  | "board-stack-not-ascending"
  | "invalid-reserve-stack-contents"
  | "in-progress-with-winning-line"
  | "win-without-winning-line"
  | "draw-without-repetition"
  | "invalid-repetition-count";

export type InvariantViolation = Readonly<{
  code: InvariantViolationCode;
  message: string;
}>;

export type TransitionViolationCode =
  | "ply-not-incremented"
  | "active-player-changed-on-terminal-move"
  | "active-player-not-alternated"
  | "terminal-state-reopened";

export type TransitionViolation = Readonly<{
  code: TransitionViolationCode;
  message: string;
}>;

export type SerializedGameState = Readonly<{
  version: 1;
  board: Readonly<Record<string, readonly string[]>>;
  reserves: Readonly<Record<string, readonly (readonly string[])[]>>;
  activePlayer: string;
  ply: number;
  repetition: Readonly<{ counts: Readonly<Record<string, number>> }>;
  status: Readonly<{ kind: string; winner?: string; reason?: string }>;
}>;
