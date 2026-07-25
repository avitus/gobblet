import {
  PIECE_BY_ID,
  PLAYER_CODES,
  RESERVE_STACK_INDEXES,
  SQUARES,
  applyMove,
  assertGameStateInvariants,
  canonicalPositionKey,
  createEmptyBoard,
  evaluateMove,
  reserveStackPieceIds,
} from "../../src/index";
import { deepFreeze } from "../../src/freeze";
import type {
  BoardMove,
  GameState,
  GameStatus,
  IllegalMoveReason,
  LegalMoveEvaluation,
  Move,
  PieceId,
  PieceSize,
  Player,
  PlayerReserves,
  ReserveMove,
  ReserveStackIndex,
  Square,
  SquareStack,
} from "../../src/index";

/** `L4` is "a light size-4 piece"; the builder picks which physical piece that is. */
export type PieceToken = `L${PieceSize}` | `D${PieceSize}`;

/** Board squares as bottom-to-top token stacks. */
export type BoardSpec = Partial<Record<Square, readonly PieceToken[]>>;

export type BuildOptions = {
  board?: BoardSpec;
  /**
   * Squares that receive the larger pieces which must leave an external stack
   * before a smaller piece of that stack can be used. One square per stack; the
   * parked pieces form a single ascending pile, so each square shows one piece.
   */
  park?: Partial<Record<Player, readonly Square[]>>;
  activePlayer?: Player;
  ply?: number;
  status?: GameStatus;
  repetition?: Readonly<Record<string, number>>;
  /** Set to false to build a deliberately broken state for invariant tests. */
  assertInvariants?: boolean;
};

function tokenOwner(token: PieceToken): Player {
  return token.startsWith("L") ? "light" : "dark";
}

function tokenSize(token: PieceToken): PieceSize {
  return Number(token.slice(1)) as PieceSize;
}

function pieceIdOf(owner: Player, stackIndex: number, size: number): PieceId {
  return `${PLAYER_CODES[owner]}${stackIndex as ReserveStackIndex}${size as PieceSize}`;
}

/** Picks the stack that wastes the fewest pieces while still holding `size`. */
function chooseStack(counts: readonly number[], size: number): number {
  let chosen = -1;
  let chosenCount = Number.POSITIVE_INFINITY;
  counts.forEach((count, index) => {
    if (count >= size && count < chosenCount) {
      chosen = index;
      chosenCount = count;
    }
  });
  return chosen;
}

/**
 * Builds a legal position from tokens, assigning concrete piece identities so
 * that every external stack keeps its required 1..k contents. Pieces are taken
 * largest first, which mirrors how a physical set is played, and the larger
 * pieces that have to come off a stack first are placed on parking squares.
 */
export function buildState(options: BuildOptions = {}): GameState {
  const requests: { square: Square; slot: number; token: PieceToken }[] = [];
  for (const square of SQUARES) {
    const specified = options.board?.[square] ?? [];
    specified.forEach((token, slot) => {
      requests.push({ square, slot, token });
    });
  }

  const remaining: Record<Player, [number, number, number]> = {
    light: [4, 4, 4],
    dark: [4, 4, 4],
  };
  const parkQueue: Record<Player, Square[]> = {
    light: [...(options.park?.light ?? [])],
    dark: [...(options.park?.dark ?? [])],
  };
  const parkSquares = new Map<string, Square>();
  const parkedPiles = new Map<Square, PieceId[]>();
  const assignments = new Map<string, PieceId>();

  const parkSquareFor = (owner: Player, stackIndex: number): Square => {
    const key = `${owner}:${stackIndex}`;
    const existing = parkSquares.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const next = parkQueue[owner].shift();
    if (next === undefined) {
      throw new Error(`no parking square left for ${owner}: extend park.${owner}`);
    }
    if (options.board?.[next] !== undefined) {
      throw new Error(`parking square ${next} is also used by the board specification`);
    }
    parkSquares.set(key, next);
    return next;
  };

  for (const request of [...requests].sort((a, b) => tokenSize(b.token) - tokenSize(a.token))) {
    const owner = tokenOwner(request.token);
    const size = tokenSize(request.token);
    const counts = remaining[owner];
    const stackIndex = chooseStack(counts, size);
    if (stackIndex === -1) {
      throw new Error(
        `cannot place ${request.token} on ${request.square}: no external stack still holds size ${size}`,
      );
    }

    const available = counts[stackIndex] ?? 0;
    if (available > size) {
      const target = parkSquareFor(owner, stackIndex);
      const pile = parkedPiles.get(target) ?? [];
      for (let surplus = available; surplus > size; surplus -= 1) {
        pile.push(pieceIdOf(owner, stackIndex, surplus));
      }
      parkedPiles.set(target, pile);
    }

    counts[stackIndex] = size - 1;
    assignments.set(`${request.square}:${request.slot}`, pieceIdOf(owner, stackIndex, size));
  }

  const board = createEmptyBoard() as Record<Square, SquareStack>;
  for (const square of SQUARES) {
    const specified = options.board?.[square];
    if (specified === undefined) {
      continue;
    }
    board[square] = specified.map((_token, slot) => {
      const pieceId = assignments.get(`${square}:${slot}`);
      if (pieceId === undefined) {
        throw new Error(`missing assignment for ${square}:${slot}`);
      }
      return pieceId;
    });
  }
  for (const [square, pile] of parkedPiles) {
    board[square] = [...pile].sort((a, b) => PIECE_BY_ID[a].size - PIECE_BY_ID[b].size);
  }

  const reservesFor = (player: Player): PlayerReserves => [
    reserveStackPieceIds(player, 0).slice(0, remaining[player][0]),
    reserveStackPieceIds(player, 1).slice(0, remaining[player][1]),
    reserveStackPieceIds(player, 2).slice(0, remaining[player][2]),
  ];

  const draft: GameState = {
    version: 1,
    board,
    reserves: { light: reservesFor("light"), dark: reservesFor("dark") },
    activePlayer: options.activePlayer ?? "light",
    ply: options.ply ?? 0,
    repetition: { counts: {} },
    status: options.status ?? { kind: "in-progress" },
  };

  const state = deepFreeze({
    ...draft,
    repetition: { counts: options.repetition ?? { [canonicalPositionKey(draft)]: 1 } },
  });

  if (options.assertInvariants !== false) {
    assertGameStateInvariants(state);
  }

  return state;
}

/** Builds a board specification from entries, so tests can use computed squares. */
export function boardSpec(
  entries: readonly (readonly [Square, readonly PieceToken[]])[],
): BoardSpec {
  const spec: Partial<Record<Square, readonly PieceToken[]>> = {};
  for (const [square, tokens] of entries) {
    spec[square] = tokens;
  }
  return spec;
}

export function boardMove(from: Square, to: Square): BoardMove {
  return { kind: "board", from, to };
}

export function reserveMove(reserveStack: ReserveStackIndex, to: Square): ReserveMove {
  return { kind: "reserve", reserveStack, to };
}

/** Applies a move that must be legal and returns the resulting state and evaluation. */
export function applyOrThrow(
  state: GameState,
  move: Move,
): { state: GameState; evaluation: LegalMoveEvaluation } {
  const result = applyMove(state, move);
  if (!result.ok) {
    throw new Error(`expected ${JSON.stringify(move)} to be legal, rejected: ${result.reason}`);
  }
  return { state: result.state, evaluation: result.evaluation };
}

export function applyAllOrThrow(state: GameState, moves: readonly Move[]): GameState {
  return moves.reduce((current, move) => applyOrThrow(current, move).state, state);
}

/** Asserts a move is rejected and returns the reason, keeping tests declarative. */
export function rejectionReason(state: GameState, move: Move): IllegalMoveReason {
  const evaluation = evaluateMove(state, move);
  if (evaluation.legal) {
    throw new Error(`expected ${JSON.stringify(move)} to be rejected`);
  }
  const applied = applyMove(state, move);
  if (applied.ok) {
    throw new Error(`evaluateMove and applyMove disagree for ${JSON.stringify(move)}`);
  }
  if (applied.reason !== evaluation.reason) {
    throw new Error(
      `evaluateMove reported ${evaluation.reason} but applyMove reported ${applied.reason}`,
    );
  }
  return evaluation.reason;
}

export function legalDestinations(state: GameState, from: Square): readonly Square[] {
  const destinations: Square[] = [];
  for (const to of SQUARES) {
    if (evaluateMove(state, boardMove(from, to)).legal) {
      destinations.push(to);
    }
  }
  return destinations;
}

export function reserveCounts(state: GameState, player: Player): readonly number[] {
  return RESERVE_STACK_INDEXES.map((index) => state.reserves[player][index].length);
}
