import { z } from "zod";
import {
  ACTOR_TYPES,
  MATCH_END_REASONS,
  MATCH_MODES,
  MATCH_RESULTS,
  MATCH_STATUSES,
  TIME_CONTROL_SECONDS,
} from "./constants";
import { moveSchema, playerSchema, serializedGameStateSchema } from "./game-state";
import {
  displayNameSchema,
  epochMillisSchema,
  matchVersionSchema,
  remainingMillisSchema,
  uuidSchema,
} from "./primitives";

export const timeControlSecondsSchema = z.literal(TIME_CONTROL_SECONDS);

export const matchPlayerSchema = z.strictObject({
  actorId: uuidSchema,
  actorType: z.enum(ACTOR_TYPES),
  displayName: displayNameSchema,
  isGuest: z.boolean(),
  rating: z.int().nullable(),
});

export const matchPlayersSchema = z.strictObject({
  light: matchPlayerSchema,
  dark: matchPlayerSchema,
});

export const matchClocksSchema = z.strictObject({
  lightRemainingMs: remainingMillisSchema,
  darkRemainingMs: remainingMillisSchema,
  turnStartedAt: epochMillisSchema.nullable(),
  serverTime: epochMillisSchema,
});

export const matchResultSchema = z.strictObject({
  outcome: z.enum(MATCH_RESULTS),
  reason: z.enum(MATCH_END_REASONS),
});

export const matchLastMoveSchema = z.strictObject({
  move: moveSchema,
  version: matchVersionSchema,
});

export const matchSnapshotSchema = z.strictObject({
  matchId: uuidSchema,
  version: matchVersionSchema,
  status: z.enum(MATCH_STATUSES),
  mode: z.enum(MATCH_MODES),
  timeControlSeconds: timeControlSecondsSchema,
  players: matchPlayersSchema,
  state: serializedGameStateSchema,
  activePlayer: playerSchema,
  clocks: matchClocksSchema,
  result: matchResultSchema.nullable(),
  lastMove: matchLastMoveSchema.nullable(),
});

export const movePayloadSchema = z.strictObject({ move: moveSchema });

export const resignPayloadSchema = z.strictObject({});

export type TimeControl = z.infer<typeof timeControlSecondsSchema>;
export type MatchPlayer = z.infer<typeof matchPlayerSchema>;
export type MatchPlayers = z.infer<typeof matchPlayersSchema>;
export type MatchClocks = z.infer<typeof matchClocksSchema>;
export type MatchResult = z.infer<typeof matchResultSchema>;
export type MatchLastMove = z.infer<typeof matchLastMoveSchema>;
export type MatchSnapshot = z.infer<typeof matchSnapshotSchema>;
export type MovePayload = z.infer<typeof movePayloadSchema>;
export type ResignPayload = z.infer<typeof resignPayloadSchema>;
