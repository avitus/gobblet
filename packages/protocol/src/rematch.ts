import { z } from "zod";
import { REMATCH_REJECTION_REASONS, REMATCH_STATES } from "./constants";
import { epochMillisSchema, uuidSchema } from "./primitives";

/**
 * Rematch payloads (docs/product-spec.md section 4.5). An offer belongs to the
 * match that just ended, so every payload names that match rather than the offer.
 */
export const rematchRequestSchema = z.strictObject({ matchId: uuidSchema });

export const rematchRespondSchema = z.strictObject({
  matchId: uuidSchema,
  accept: z.boolean(),
});

export const rematchStatusEventSchema = z.strictObject({
  matchId: uuidSchema,
  state: z.enum(REMATCH_STATES),
  /** Who is waiting for an answer, so a client can tell an offer from a request. */
  requestedBy: uuidSchema,
  expiresAt: epochMillisSchema,
  /** The match created by an accepted offer; `null` in every other state. */
  nextMatchId: uuidSchema.nullable(),
});

export const rematchAckSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), status: rematchStatusEventSchema }),
  z.strictObject({ ok: z.literal(false), reason: z.enum(REMATCH_REJECTION_REASONS) }),
]);

export type RematchRequest = z.infer<typeof rematchRequestSchema>;
export type RematchRespond = z.infer<typeof rematchRespondSchema>;
export type RematchStatusEvent = z.infer<typeof rematchStatusEventSchema>;
export type RematchAck = z.infer<typeof rematchAckSchema>;
