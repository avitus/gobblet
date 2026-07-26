import { z } from "zod";
import { COMMUNICATION_REJECTION_REASONS, PRESET_MESSAGE_KEYS, REACTION_KEYS } from "./constants";
import { playerSchema } from "./game-state";
import { epochMillisSchema, uuidSchema } from "./primitives";

/**
 * Preset messages and reactions (docs/product-spec.md section 12). Every payload is
 * a key from a closed set, so there is no free text to moderate and nothing to
 * sanitise. Nothing sent here is stored
 * (docs/adr/0026-communication-is-relayed-never-stored.md).
 */
export const presetMessageKeySchema = z.enum(PRESET_MESSAGE_KEYS);

export const reactionKeySchema = z.enum(REACTION_KEYS);

export const presetMessageRequestSchema = z.strictObject({
  matchId: uuidSchema,
  messageKey: presetMessageKeySchema,
});

export const reactionRequestSchema = z.strictObject({
  matchId: uuidSchema,
  reactionKey: reactionKeySchema,
});

/**
 * The two channels are muted independently (section 12.3). Sound mute is absent
 * because it is never sent: nothing plays across the wire.
 */
export const muteStateSchema = z.strictObject({
  presetMessagesMuted: z.boolean(),
  reactionsMuted: z.boolean(),
});

export const muteStateRequestSchema = muteStateSchema.extend({ matchId: uuidSchema });

const communicationOriginSchema = z.strictObject({
  matchId: uuidSchema,
  /** The seat that sent it, which is how a client tells its own echo from the opponent. */
  from: playerSchema,
  actorId: uuidSchema,
  sentAt: epochMillisSchema,
});

export const presetMessageEventSchema = communicationOriginSchema.extend({
  messageKey: presetMessageKeySchema,
});

export const reactionEventSchema = communicationOriginSchema.extend({
  reactionKey: reactionKeySchema,
});

/**
 * Acknowledgements carry no payload on success: a delivered message is the event
 * the sender receives back, not a field of the acknowledgement.
 */
export const communicationAckSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true) }),
  z.strictObject({ ok: z.literal(false), reason: z.enum(COMMUNICATION_REJECTION_REASONS) }),
]);

export type PresetMessageRequest = z.infer<typeof presetMessageRequestSchema>;
export type ReactionRequest = z.infer<typeof reactionRequestSchema>;
export type MuteState = z.infer<typeof muteStateSchema>;
export type MuteStateRequest = z.infer<typeof muteStateRequestSchema>;
export type PresetMessageEvent = z.infer<typeof presetMessageEventSchema>;
export type ReactionEvent = z.infer<typeof reactionEventSchema>;
export type CommunicationAck = z.infer<typeof communicationAckSchema>;
