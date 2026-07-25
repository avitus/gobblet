import { z } from "zod";
import { COMMAND_REJECTION_REASONS } from "./constants";
import { matchSnapshotSchema, movePayloadSchema, resignPayloadSchema } from "./match";
import { epochMillisSchema, matchVersionSchema, uuidSchema } from "./primitives";

const envelopeShape = {
  commandId: uuidSchema,
  matchId: uuidSchema,
  expectedVersion: matchVersionSchema,
  /** Diagnostics and latency metrics only, never used for clock arithmetic (docs/adr/0009). */
  sentAtClient: epochMillisSchema,
};

export const commandEnvelopeMetadataSchema = z.strictObject(envelopeShape);

export function commandEnvelopeSchema<TPayload extends z.ZodType>(payload: TPayload) {
  return z.strictObject({ ...envelopeShape, payload });
}

export const commandAckSuccessSchema = z.strictObject({
  ok: z.literal(true),
  commandId: uuidSchema,
  newVersion: matchVersionSchema,
});

export const commandAckRejectionSchema = z.strictObject({
  ok: z.literal(false),
  commandId: uuidSchema,
  reason: z.enum(COMMAND_REJECTION_REASONS),
  snapshot: matchSnapshotSchema.optional(),
});

export const commandAckSchema = z.discriminatedUnion("ok", [
  commandAckSuccessSchema,
  commandAckRejectionSchema,
]);

export const matchMoveCommandSchema = commandEnvelopeSchema(movePayloadSchema);

export const matchResignCommandSchema = commandEnvelopeSchema(resignPayloadSchema);

export type CommandEnvelopeMetadata = z.infer<typeof commandEnvelopeMetadataSchema>;
export type CommandEnvelope<TPayload> = CommandEnvelopeMetadata & { payload: TPayload };
export type CommandAckSuccess = z.infer<typeof commandAckSuccessSchema>;
export type CommandAckRejection = z.infer<typeof commandAckRejectionSchema>;
export type CommandAck = z.infer<typeof commandAckSchema>;
export type MatchMoveCommand = z.infer<typeof matchMoveCommandSchema>;
export type MatchResignCommand = z.infer<typeof matchResignCommandSchema>;
