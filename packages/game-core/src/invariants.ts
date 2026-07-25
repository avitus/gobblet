import { getWinningLines } from "./board";
import { SQUARES } from "./board-geometry";
import { GAME_STATE_VERSION, PIECES_PER_PLAYER, REPETITION_LIMIT } from "./constants";
import { GameCoreInvariantError, GameCoreTransitionError } from "./errors";
import {
  PIECES,
  PIECE_BY_ID,
  RESERVE_STACK_INDEXES,
  isPieceId,
  reserveStackPieceIds,
} from "./pieces";
import { PLAYERS, isPlayer } from "./players";
import type {
  GameState,
  InvariantViolation,
  InvariantViolationCode,
  Piece,
  TransitionViolation,
  TransitionViolationCode,
} from "./types";

/**
 * Structural invariants that must hold for every game state the engine produces
 * or accepts (docs/product-spec.md section 6.3).
 */
export function collectInvariantViolations(state: GameState): readonly InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const report = (code: InvariantViolationCode, message: string): void => {
    violations.push({ code, message });
  };

  // Invariants also guard states that arrive from storage, so the declared types
  // are treated as claims rather than facts.
  const declaredVersion: unknown = state.version;
  if (declaredVersion !== GAME_STATE_VERSION) {
    report(
      "unsupported-state-version",
      `expected version ${GAME_STATE_VERSION}, received ${String(declaredVersion)}`,
    );
  }

  if (!Number.isInteger(state.ply) || state.ply < 0) {
    report("invalid-ply", `ply must be a non-negative integer, received ${String(state.ply)}`);
  }

  if (!isPlayer(state.activePlayer)) {
    report("invalid-active-player", `unknown active player ${String(state.activePlayer)}`);
  }

  const occurrences = new Map<string, number>();
  const perPlayer = { light: 0, dark: 0 };

  const account = (id: unknown, location: string): void => {
    if (!isPieceId(id)) {
      report("unknown-piece", `${location} holds unknown piece ${String(id)}`);
      return;
    }
    const seen = (occurrences.get(id) ?? 0) + 1;
    occurrences.set(id, seen);
    if (seen > 1) {
      report("duplicate-piece", `piece ${id} appears ${seen} times`);
    }
    perPlayer[PIECE_BY_ID[id].owner] += 1;
  };

  let boardIsReadable = true;

  for (const square of SQUARES) {
    const stack = state.board[square];
    let below: Piece | null = null;
    for (const id of stack) {
      account(id, `square ${square}`);
      if (!isPieceId(id)) {
        below = null;
        boardIsReadable = false;
        continue;
      }
      const piece = PIECE_BY_ID[id];
      if (below !== null && piece.size <= below.size) {
        report(
          "board-stack-not-ascending",
          `square ${square} stacks ${piece.id} (size ${piece.size}) on ${below.id} (size ${below.size})`,
        );
      }
      below = piece;
    }
  }

  for (const player of PLAYERS) {
    for (const index of RESERVE_STACK_INDEXES) {
      const stack = state.reserves[player][index];
      for (const id of stack) {
        account(id, `${player} reserve stack ${index}`);
      }
      const expected = reserveStackPieceIds(player, index).slice(0, stack.length);
      if (expected.join(",") !== stack.join(",")) {
        report(
          "invalid-reserve-stack-contents",
          `${player} reserve stack ${index} is [${stack.join(",")}], expected [${expected.join(",")}]`,
        );
      }
    }
  }

  for (const piece of PIECES) {
    if (!occurrences.has(piece.id)) {
      report("missing-piece", `piece ${piece.id} is not in play`);
    }
  }

  for (const player of PLAYERS) {
    if (perPlayer[player] !== PIECES_PER_PLAYER) {
      report(
        "piece-count-per-player",
        `${player} owns ${perPlayer[player]} pieces, expected ${PIECES_PER_PLAYER}`,
      );
    }
  }

  for (const [key, count] of Object.entries(state.repetition.counts)) {
    if (!Number.isInteger(count) || count < 1) {
      report("invalid-repetition-count", `position ${key} has count ${String(count)}`);
    }
  }

  if (
    state.status.kind === "draw" &&
    !Object.values(state.repetition.counts).some((count) => count >= REPETITION_LIMIT)
  ) {
    report(
      "draw-without-repetition",
      `draw recorded without a position reaching ${REPETITION_LIMIT} occurrences`,
    );
  }

  // Line based checks need every board piece to be identifiable.
  if (boardIsReadable) {
    if (state.status.kind === "in-progress") {
      if (getWinningLines(state, "light").length > 0 || getWinningLines(state, "dark").length > 0) {
        report(
          "in-progress-with-winning-line",
          "a visible line of four exists but the game is marked in progress",
        );
      }
    } else if (state.status.kind === "win") {
      if (getWinningLines(state, state.status.winner).length === 0) {
        report(
          "win-without-winning-line",
          `${state.status.winner} is recorded as the winner without a visible line of four`,
        );
      }
    }
  }

  return violations;
}

export function assertGameStateInvariants(state: GameState): void {
  const violations = collectInvariantViolations(state);
  if (violations.length > 0) {
    throw new GameCoreInvariantError(violations);
  }
}

/**
 * Turn and ply invariants for a single accepted transition. The active player
 * alternates only after a nonterminal move; terminal states keep the last mover
 * as `activePlayer` so callers can attribute the final move.
 */
export function collectTransitionViolations(
  before: GameState,
  after: GameState,
): readonly TransitionViolation[] {
  const violations: TransitionViolation[] = [];
  const report = (code: TransitionViolationCode, message: string): void => {
    violations.push({ code, message });
  };

  if (after.ply !== before.ply + 1) {
    report("ply-not-incremented", `ply went from ${before.ply} to ${after.ply}`);
  }

  if (before.status.kind !== "in-progress") {
    report("terminal-state-reopened", `a move was applied to a ${before.status.kind} state`);
  }

  if (after.status.kind === "in-progress") {
    if (after.activePlayer === before.activePlayer) {
      report(
        "active-player-not-alternated",
        `${after.activePlayer} stayed on turn after a nonterminal move`,
      );
    }
  } else if (after.activePlayer !== before.activePlayer) {
    report(
      "active-player-changed-on-terminal-move",
      `active player changed from ${before.activePlayer} to ${after.activePlayer} on a terminal move`,
    );
  }

  return violations;
}

export function assertTransitionInvariants(before: GameState, after: GameState): void {
  const violations = collectTransitionViolations(before, after);
  if (violations.length > 0) {
    throw new GameCoreTransitionError(violations);
  }
}
