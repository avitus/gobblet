import { z } from "zod";
import { ACTOR_TYPES, MATCH_MODES, QUEUE_REJECTION_REASONS } from "./constants";
import { playerSchema } from "./game-state";
import { matchSnapshotSchema, timeControlSecondsSchema } from "./match";
import { displayNameSchema, epochMillisSchema, uuidSchema } from "./primitives";

/**
 * Matchmaking payloads (docs/product-spec.md section 9). A queue is identified by
 * the pair a player chooses, so the same shape names a queue everywhere.
 */
export const queueKeySchema = z.strictObject({
  mode: z.enum(MATCH_MODES),
  timeControlSeconds: timeControlSecondsSchema,
});

export const queueJoinRequestSchema = queueKeySchema;

export const queueLeaveRequestSchema = z.strictObject({});

/**
 * The window a ranked search is currently using. `null` in casual, where pairing
 * takes the longest waiting opponent instead of a rating band (appendix P4).
 */
export const ratingWindowSchema = z.strictObject({
  minimum: z.int(),
  maximum: z.int(),
});

export const queueStatusSchema = z.strictObject({
  mode: z.enum(MATCH_MODES),
  timeControlSeconds: timeControlSecondsSchema,
  /** Rating used for pairing: a guest is queued as the unrated default. */
  rating: z.int(),
  waitingMs: z.int().nonnegative(),
  ratingWindow: ratingWindowSchema.nullable(),
  /** How many players are waiting in this queue, including the recipient. */
  depth: z.int().positive(),
  serverTime: epochMillisSchema,
});

export const queueJoinAckSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), status: queueStatusSchema }),
  z.strictObject({ ok: z.literal(false), reason: z.enum(QUEUE_REJECTION_REASONS) }),
]);

export const queueLeaveAckSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true) }),
  z.strictObject({ ok: z.literal(false), reason: z.enum(QUEUE_REJECTION_REASONS) }),
]);

export const queueOpponentSchema = z.strictObject({
  actorType: z.enum(ACTOR_TYPES),
  displayName: displayNameSchema,
  rating: z.int().nullable(),
});

/**
 * Sent to both players the moment a match exists. It names the recipient's colour,
 * so a client never has to work out which seat it holds, and carries the snapshot
 * so play can start without a separate `match:sync`.
 */
export const matchFoundEventSchema = z.strictObject({
  matchId: uuidSchema,
  mode: z.enum(MATCH_MODES),
  timeControlSeconds: timeControlSecondsSchema,
  yourColor: playerSchema,
  opponent: queueOpponentSchema,
  waitedMs: z.int().nonnegative(),
  snapshot: matchSnapshotSchema,
});

export type QueueKey = z.infer<typeof queueKeySchema>;
export type QueueJoinRequest = z.infer<typeof queueJoinRequestSchema>;
export type QueueLeaveRequest = z.infer<typeof queueLeaveRequestSchema>;
export type RatingWindow = z.infer<typeof ratingWindowSchema>;
export type QueueStatus = z.infer<typeof queueStatusSchema>;
export type QueueJoinAck = z.infer<typeof queueJoinAckSchema>;
export type QueueLeaveAck = z.infer<typeof queueLeaveAckSchema>;
export type QueueOpponent = z.infer<typeof queueOpponentSchema>;
export type MatchFoundEvent = z.infer<typeof matchFoundEventSchema>;
