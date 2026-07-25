import { SQUARES } from "./board-geometry";
import { GAME_STATE_VERSION, RESERVE_STACKS_PER_PLAYER } from "./constants";
import { GameCoreSerializationError } from "./errors";
import { deepFreeze } from "./freeze";
import { assertGameStateInvariants } from "./invariants";
import { isPieceId } from "./pieces";
import { PLAYERS, isPlayer } from "./players";
import type {
  GameState,
  GameStatus,
  PieceId,
  Player,
  PlayerReserves,
  SerializedGameState,
  Square,
  SquareStack,
  WinReason,
} from "./types";

/**
 * JSON-safe mirror of a game state with a deterministic property order, so that
 * `serializeGameState` is byte-for-byte stable for equal states.
 */
export function toSerializableGameState(state: GameState): SerializedGameState {
  const board: Record<string, readonly string[]> = {};
  for (const square of SQUARES) {
    board[square] = [...state.board[square]];
  }

  const reserves: Record<string, readonly (readonly string[])[]> = {};
  for (const player of PLAYERS) {
    reserves[player] = state.reserves[player].map((stack) => [...stack]);
  }

  const counts: Record<string, number> = {};
  for (const [key, count] of Object.entries(state.repetition.counts).sort()) {
    counts[key] = count;
  }

  const status = ((): SerializedGameState["status"] => {
    switch (state.status.kind) {
      case "in-progress":
        return { kind: "in-progress" };
      case "win":
        return { kind: "win", winner: state.status.winner, reason: state.status.reason };
      case "draw":
        return { kind: "draw", reason: state.status.reason };
    }
  })();

  return {
    version: state.version,
    board,
    reserves,
    activePlayer: state.activePlayer,
    ply: state.ply,
    repetition: { counts },
    status,
  };
}

export function serializeGameState(state: GameState): string {
  return JSON.stringify(toSerializableGameState(state));
}

function expectRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new GameCoreSerializationError(path, "expected an object");
  }
  return value as Record<string, unknown>;
}

function expectPieceIds(value: unknown, path: string): readonly PieceId[] {
  if (!Array.isArray(value)) {
    throw new GameCoreSerializationError(path, "expected an array of piece ids");
  }
  return value.map((entry: unknown, index: number): PieceId => {
    if (!isPieceId(entry)) {
      throw new GameCoreSerializationError(`${path}[${index}]`, `unknown piece ${String(entry)}`);
    }
    return entry;
  });
}

function expectPlayer(value: unknown, path: string): Player {
  if (!isPlayer(value)) {
    throw new GameCoreSerializationError(path, `expected light or dark, received ${String(value)}`);
  }
  return value;
}

function expectNonNegativeInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new GameCoreSerializationError(
      path,
      `expected a non-negative integer, received ${String(value)}`,
    );
  }
  return value;
}

function expectWinReason(value: unknown, path: string): WinReason {
  if (value !== "line" && value !== "revealed-line") {
    throw new GameCoreSerializationError(path, `unknown win reason ${String(value)}`);
  }
  return value;
}

function expectStatus(value: unknown, path: string): GameStatus {
  const record = expectRecord(value, path);

  if (record.kind === "in-progress") {
    return { kind: "in-progress" };
  }
  if (record.kind === "win") {
    return {
      kind: "win",
      winner: expectPlayer(record.winner, `${path}.winner`),
      reason: expectWinReason(record.reason, `${path}.reason`),
    };
  }
  if (record.kind === "draw") {
    if (record.reason !== "threefold-repetition") {
      throw new GameCoreSerializationError(
        `${path}.reason`,
        `unknown draw reason ${String(record.reason)}`,
      );
    }
    return { kind: "draw", reason: "threefold-repetition" };
  }

  throw new GameCoreSerializationError(
    `${path}.kind`,
    `unknown status kind ${String(record.kind)}`,
  );
}

/**
 * Reads a state produced by {@link toSerializableGameState}. Structure is validated
 * before the state invariants are asserted, so corrupt stored state fails loudly
 * instead of silently producing an impossible position.
 */
export function fromSerializableGameState(input: unknown): GameState {
  const record = expectRecord(input, "$");

  if (record.version !== GAME_STATE_VERSION) {
    throw new GameCoreSerializationError(
      "$.version",
      `expected version ${GAME_STATE_VERSION}, received ${String(record.version)}`,
    );
  }

  const boardRecord = expectRecord(record.board, "$.board");
  const board = {} as Record<Square, SquareStack>;
  for (const square of SQUARES) {
    board[square] = expectPieceIds(boardRecord[square], `$.board.${square}`);
  }

  const reservesRecord = expectRecord(record.reserves, "$.reserves");
  const reserves = {} as Record<Player, PlayerReserves>;
  for (const player of PLAYERS) {
    const stacks: unknown = reservesRecord[player];
    if (!Array.isArray(stacks) || stacks.length !== RESERVE_STACKS_PER_PLAYER) {
      throw new GameCoreSerializationError(
        `$.reserves.${player}`,
        `expected ${RESERVE_STACKS_PER_PLAYER} external stacks`,
      );
    }
    reserves[player] = [
      expectPieceIds(stacks[0], `$.reserves.${player}[0]`),
      expectPieceIds(stacks[1], `$.reserves.${player}[1]`),
      expectPieceIds(stacks[2], `$.reserves.${player}[2]`),
    ];
  }

  const repetition = expectRecord(record.repetition, "$.repetition");
  const countsRecord = expectRecord(repetition.counts, "$.repetition.counts");
  const counts: Record<string, number> = {};
  for (const [key, count] of Object.entries(countsRecord).sort()) {
    counts[key] = expectNonNegativeInteger(count, `$.repetition.counts.${key}`);
  }

  const state: GameState = deepFreeze({
    version: GAME_STATE_VERSION,
    board,
    reserves,
    activePlayer: expectPlayer(record.activePlayer, "$.activePlayer"),
    ply: expectNonNegativeInteger(record.ply, "$.ply"),
    repetition: { counts },
    status: expectStatus(record.status, "$.status"),
  });

  assertGameStateInvariants(state);
  return state;
}

export function deserializeGameState(json: string): GameState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new GameCoreSerializationError("$", `invalid JSON: ${String(error)}`);
  }
  return fromSerializableGameState(parsed);
}
