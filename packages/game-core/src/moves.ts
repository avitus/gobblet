import { hasThreeInLineThrough, winningLinesOnBoard } from "./board";
import { SQUARES, isSquare } from "./board-geometry";
import { GAME_STATE_VERSION, REPETITION_LIMIT } from "./constants";
import { deepFreeze } from "./freeze";
import { isGameOver } from "./game";
import { assertGameStateInvariants, assertTransitionInvariants } from "./invariants";
import { PIECE_BY_ID, RESERVE_STACK_INDEXES, isReserveStackIndex } from "./pieces";
import { otherPlayer } from "./players";
import { positionKeyOf } from "./position-key";
import type {
  BoardMove,
  BoardState,
  EvaluatedMove,
  GameState,
  GameStatus,
  IllegalMoveEvaluation,
  IllegalMoveReason,
  LegalMoveEvaluation,
  Move,
  MoveConsequence,
  MoveEvaluation,
  MoveResult,
  Player,
  PlayerReserves,
  ReserveMove,
  ReserveStackIndex,
  ReserveState,
  Square,
  SquareStack,
  WinningLine,
} from "./types";

const NO_LINES: readonly WinningLine[] = Object.freeze([]);

type Simulation = Readonly<{
  nextState: GameState;
  consequence: MoveConsequence;
  revealedOpponentLines: readonly WinningLine[];
  blockedOpponentLines: readonly WinningLine[];
  resultingWinningLines: readonly WinningLine[];
  positionKey: string;
}>;

type SimulationOutcome =
  | Readonly<{ ok: true; simulation: Simulation }>
  | Readonly<{ ok: false; reason: IllegalMoveReason }>;

function illegal(reason: IllegalMoveReason): SimulationOutcome {
  return { ok: false, reason };
}

function withSquare(board: BoardState, square: Square, stack: SquareStack): BoardState {
  const next = { ...board } as Record<Square, SquareStack>;
  next[square] = stack;
  return next;
}

function withoutExposedReservePiece(
  reserves: ReserveState,
  player: Player,
  reserveStack: ReserveStackIndex,
): ReserveState {
  const stacks = reserves[player];
  const updated: PlayerReserves = [
    reserveStack === 0 ? stacks[0].slice(0, -1) : stacks[0],
    reserveStack === 1 ? stacks[1].slice(0, -1) : stacks[1],
    reserveStack === 2 ? stacks[2].slice(0, -1) : stacks[2],
  ];

  return player === "light"
    ? { light: updated, dark: reserves.dark }
    : { light: reserves.light, dark: updated };
}

/**
 * Shared terminal evaluation for both move kinds, following the outcome priority
 * of docs/rules.md section 9.
 */
function completeMove(
  state: GameState,
  board: BoardState,
  reserves: ReserveState,
  revealedOpponentLines: readonly WinningLine[],
): SimulationOutcome {
  const mover = state.activePlayer;
  const opponent = otherPlayer(mover);

  const opponentLines = winningLinesOnBoard(board, opponent);
  const moverLines = winningLinesOnBoard(board, mover);
  const blockedOpponentLines = revealedOpponentLines.filter(
    (revealed) => !opponentLines.some((remaining) => remaining.id === revealed.id),
  );

  const positionKey = positionKeyOf(board, reserves, opponent);
  const occurrences = (state.repetition.counts[positionKey] ?? 0) + 1;

  let status: GameStatus;
  let consequence: MoveConsequence;
  let resultingWinningLines: readonly WinningLine[];

  if (opponentLines.length > 0) {
    status = { kind: "win", winner: opponent, reason: "revealed-line" };
    consequence = "loses-by-reveal";
    resultingWinningLines = opponentLines;
  } else if (moverLines.length > 0) {
    status = { kind: "win", winner: mover, reason: "line" };
    consequence = "wins";
    resultingWinningLines = moverLines;
  } else if (occurrences >= REPETITION_LIMIT) {
    status = { kind: "draw", reason: "threefold-repetition" };
    consequence = "draws-by-repetition";
    resultingWinningLines = NO_LINES;
  } else {
    status = { kind: "in-progress" };
    consequence = "continues";
    resultingWinningLines = NO_LINES;
  }

  const nextState: GameState = {
    version: GAME_STATE_VERSION,
    board,
    reserves,
    activePlayer: status.kind === "in-progress" ? opponent : mover,
    ply: state.ply + 1,
    repetition: { counts: { ...state.repetition.counts, [positionKey]: occurrences } },
    status,
  };

  return {
    ok: true,
    simulation: {
      nextState,
      consequence,
      revealedOpponentLines,
      blockedOpponentLines,
      resultingWinningLines,
      positionKey,
    },
  };
}

function simulateReserveMove(state: GameState, move: ReserveMove): SimulationOutcome {
  if (!isReserveStackIndex(move.reserveStack)) {
    return illegal("invalid-reserve-stack");
  }
  if (!isSquare(move.to)) {
    return illegal("invalid-square");
  }

  const mover = state.activePlayer;
  const opponent = otherPlayer(mover);
  const entering = state.reserves[mover][move.reserveStack].at(-1);
  if (entering === undefined) {
    return illegal("empty-reserve-stack");
  }

  const destination = state.board[move.to];
  const coveredId = destination.at(-1);

  if (coveredId !== undefined) {
    const covered = PIECE_BY_ID[coveredId];
    if (covered.owner === mover) {
      return illegal("reserve-cannot-cover-own-piece");
    }
    if (PIECE_BY_ID[entering].size <= covered.size) {
      return illegal("destination-piece-not-smaller");
    }
    if (!hasThreeInLineThrough(state.board, opponent, move.to)) {
      return illegal("reserve-cover-requires-opponent-three-line");
    }
  }

  return completeMove(
    state,
    withSquare(state.board, move.to, [...destination, entering]),
    withoutExposedReservePiece(state.reserves, mover, move.reserveStack),
    NO_LINES,
  );
}

function simulateBoardMove(state: GameState, move: BoardMove): SimulationOutcome {
  if (!isSquare(move.from)) {
    return illegal("invalid-square");
  }
  if (!isSquare(move.to)) {
    return illegal("invalid-square");
  }
  if (move.from === move.to) {
    return illegal("same-square");
  }

  const mover = state.activePlayer;
  const opponent = otherPlayer(mover);
  const source = state.board[move.from];
  const movingId = source.at(-1);
  if (movingId === undefined) {
    return illegal("empty-source-square");
  }

  const moving = PIECE_BY_ID[movingId];
  if (moving.owner !== mover) {
    return illegal("piece-not-owned");
  }

  const destination = state.board[move.to];
  const coveredId = destination.at(-1);
  if (coveredId !== undefined && PIECE_BY_ID[coveredId].size >= moving.size) {
    return illegal("destination-piece-not-smaller");
  }

  // Phase one: lift the piece, which can expose an opponent line of four.
  const lifted = withSquare(state.board, move.from, source.slice(0, -1));
  const revealedOpponentLines = winningLinesOnBoard(lifted, opponent);

  // Phase two: place the piece, which may break the exposed line again.
  const placed = withSquare(lifted, move.to, [...destination, movingId]);

  return completeMove(state, placed, state.reserves, revealedOpponentLines);
}

function simulateMove(state: GameState, move: Move): SimulationOutcome {
  if (isGameOver(state)) {
    return illegal("game-over");
  }
  return move.kind === "reserve"
    ? simulateReserveMove(state, move)
    : simulateBoardMove(state, move);
}

function toEvaluation(move: Move, simulation: Simulation): LegalMoveEvaluation {
  return {
    move,
    legal: true,
    consequence: simulation.consequence,
    revealedOpponentLines: simulation.revealedOpponentLines,
    blockedOpponentLines: simulation.blockedOpponentLines,
    resultingWinningLines: simulation.resultingWinningLines,
    positionKey: simulation.positionKey,
  };
}

/**
 * Legality and terminal consequence of a single move, without applying it.
 * Never throws for malformed moves: it reports the reason instead.
 */
export function evaluateMove(state: GameState, move: Move): MoveEvaluation {
  const outcome = simulateMove(state, move);
  if (!outcome.ok) {
    const rejection: IllegalMoveEvaluation = { move, legal: false, reason: outcome.reason };
    return deepFreeze(rejection);
  }
  return deepFreeze(toEvaluation(move, outcome.simulation));
}

/**
 * Every structurally legal move for the active player, including moves that lose
 * immediately because they leave an exposed opponent line unblocked.
 */
export function enumerateMoves(state: GameState): readonly EvaluatedMove[] {
  const moves: EvaluatedMove[] = [];
  if (isGameOver(state)) {
    return moves;
  }

  for (const reserveStack of RESERVE_STACK_INDEXES) {
    for (const to of SQUARES) {
      const move: ReserveMove = { kind: "reserve", reserveStack, to };
      const outcome = simulateReserveMove(state, move);
      if (outcome.ok) {
        moves.push(deepFreeze(toEvaluation(move, outcome.simulation)));
      }
    }
  }

  for (const from of SQUARES) {
    for (const to of SQUARES) {
      const move: BoardMove = { kind: "board", from, to };
      const outcome = simulateBoardMove(state, move);
      if (outcome.ok) {
        moves.push(deepFreeze(toEvaluation(move, outcome.simulation)));
      }
    }
  }

  return moves;
}

/**
 * Applies a move and returns the resulting immutable state. State and transition
 * invariants are asserted for every accepted move.
 */
export function applyMove(state: GameState, move: Move): MoveResult {
  const outcome = simulateMove(state, move);
  if (!outcome.ok) {
    return { ok: false, reason: outcome.reason };
  }

  const nextState = deepFreeze(outcome.simulation.nextState);
  assertGameStateInvariants(nextState);
  assertTransitionInvariants(state, nextState);

  const result: MoveResult = {
    ok: true,
    state: nextState,
    evaluation: toEvaluation(move, outcome.simulation),
  };
  return deepFreeze(result);
}
