import { z } from "zod";
import { ACTOR_TYPES, HTTP_ERROR_CODES, MATCH_MODES, MATCH_STATUSES } from "./constants";
import { playerSchema } from "./game-state";
import {
  matchPlayersSchema,
  matchResultSchema,
  matchSnapshotSchema,
  timeControlSecondsSchema,
} from "./match";
import { displayNameSchema, isoTimestampSchema, uuidSchema } from "./primitives";

/**
 * The single problem shape every HTTP error uses (docs/protocol.md section 10.1).
 * `details` is for developers and must never carry tokens or credentials.
 */
export const httpErrorDetailSchema = z.strictObject({
  path: z.string(),
  issue: z.string().min(1),
});

export const httpErrorBodySchema = z.strictObject({
  error: z.strictObject({
    code: z.enum(HTTP_ERROR_CODES),
    message: z.string().min(1),
    requestId: z.string().min(1),
    details: z.array(httpErrorDetailSchema).optional(),
  }),
});

/**
 * Turns a validation failure into wire details. It lives here because the shape
 * is part of the contract, and because it keeps consumers from having to reach
 * for Zod themselves.
 */
export function httpErrorDetails(error: z.ZodError): readonly HttpErrorDetail[] {
  return error.issues.map((issue) => ({
    path: issue.path.map((segment) => String(segment)).join("."),
    issue: issue.code,
  }));
}

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

/** The own-history listing (spec section 11.2), newest match first. */
export const matchHistoryResponseSchema = z.strictObject({
  matches: z.array(matchSummarySchema),
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

export type HttpErrorDetail = z.infer<typeof httpErrorDetailSchema>;
export type HttpErrorBody = z.infer<typeof httpErrorBodySchema>;
export type CreateGuestRequest = z.infer<typeof createGuestRequestSchema>;
export type CreateGuestResponse = z.infer<typeof createGuestResponseSchema>;
export type MatchSummary = z.infer<typeof matchSummarySchema>;
export type MatchHistoryResponse = z.infer<typeof matchHistoryResponseSchema>;
export type DevMatchParticipant = z.infer<typeof devMatchParticipantSchema>;
export type CreateDevMatchRequest = z.infer<typeof createDevMatchRequestSchema>;
export type CreateDevMatchResponse = z.infer<typeof createDevMatchResponseSchema>;
