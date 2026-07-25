import { z } from "zod";
import { ACTOR_TYPES, MATCH_MODES, MATCH_STATUSES } from "./constants";
import { playerSchema } from "./game-state";
import {
  matchPlayersSchema,
  matchResultSchema,
  matchSnapshotSchema,
  timeControlSecondsSchema,
} from "./match";
import { displayNameSchema, isoTimestampSchema, uuidSchema } from "./primitives";

export const createGuestRequestSchema = z.strictObject({
  displayName: displayNameSchema.optional(),
});

export const createGuestResponseSchema = z.strictObject({
  guestId: uuidSchema,
  displayName: displayNameSchema,
  sessionToken: z.string().min(1),
  expiresAt: isoTimestampSchema,
});

export const matchSummarySchema = z.strictObject({
  matchId: uuidSchema,
  mode: z.enum(MATCH_MODES),
  timeControlSeconds: timeControlSecondsSchema,
  status: z.enum(MATCH_STATUSES),
  result: matchResultSchema.nullable(),
  players: matchPlayersSchema,
  createdAt: isoTimestampSchema,
  startedAt: isoTimestampSchema.nullable(),
  endedAt: isoTimestampSchema.nullable(),
});

export const devMatchParticipantSchema = z.strictObject({
  actorType: z.enum(ACTOR_TYPES),
  actorId: uuidSchema,
  displayName: displayNameSchema,
});

export const createDevMatchRequestSchema = z.strictObject({
  mode: z.enum(MATCH_MODES),
  timeControlSeconds: timeControlSecondsSchema,
  light: devMatchParticipantSchema,
  dark: devMatchParticipantSchema,
  firstPlayer: playerSchema.optional(),
});

export const createDevMatchResponseSchema = z.strictObject({
  matchId: uuidSchema,
  snapshot: matchSnapshotSchema,
});

export type CreateGuestRequest = z.infer<typeof createGuestRequestSchema>;
export type CreateGuestResponse = z.infer<typeof createGuestResponseSchema>;
export type MatchSummary = z.infer<typeof matchSummarySchema>;
export type DevMatchParticipant = z.infer<typeof devMatchParticipantSchema>;
export type CreateDevMatchRequest = z.infer<typeof createDevMatchRequestSchema>;
export type CreateDevMatchResponse = z.infer<typeof createDevMatchResponseSchema>;
