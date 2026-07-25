import { z } from "zod";
import { FATAL_ERROR_ACTIONS, MATCH_END_REASONS, MATCH_RESULTS } from "./constants";
import { moveSchema, playerSchema } from "./game-state";
import { matchClocksSchema, matchSnapshotSchema } from "./match";
import {
  epochMillisSchema,
  matchVersionSchema,
  remainingMillisSchema,
  uuidSchema,
} from "./primitives";

export const matchSyncRequestSchema = z.strictObject({ matchId: uuidSchema });

export const matchSnapshotEventSchema = matchSnapshotSchema;

export const matchMoveCommittedEventSchema = z.strictObject({
  matchId: uuidSchema,
  version: matchVersionSchema,
  move: moveSchema,
  activePlayer: playerSchema,
  clocks: matchClocksSchema,
  /** The side that made the move, which is not derivable from `activePlayer` on a terminal move. */
  actor: playerSchema,
});

export const matchClockSyncEventSchema = z.strictObject({
  matchId: uuidSchema,
  version: matchVersionSchema,
  activePlayer: playerSchema,
  lightRemainingMs: remainingMillisSchema,
  darkRemainingMs: remainingMillisSchema,
  serverTime: epochMillisSchema,
});

export const matchEndedEventSchema = z.strictObject({
  matchId: uuidSchema,
  version: matchVersionSchema,
  result: z.enum(MATCH_RESULTS),
  reason: z.enum(MATCH_END_REASONS),
});

export const recoverableErrorSchema = z.strictObject({
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.literal(true),
  context: z.record(z.string(), z.unknown()).optional(),
});

export const fatalErrorSchema = z.strictObject({
  code: z.string().min(1),
  message: z.string().min(1),
  action: z.enum(FATAL_ERROR_ACTIONS),
});

export type MatchSyncRequest = z.infer<typeof matchSyncRequestSchema>;
export type MatchSnapshotEvent = z.infer<typeof matchSnapshotEventSchema>;
export type MatchMoveCommittedEvent = z.infer<typeof matchMoveCommittedEventSchema>;
export type MatchClockSyncEvent = z.infer<typeof matchClockSyncEventSchema>;
export type MatchEndedEvent = z.infer<typeof matchEndedEventSchema>;
export type RecoverableError = z.infer<typeof recoverableErrorSchema>;
export type FatalError = z.infer<typeof fatalErrorSchema>;
