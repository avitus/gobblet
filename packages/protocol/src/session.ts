import { z } from "zod";
import { ACTOR_TYPES, APP_ENVIRONMENTS, CLIENT_PLATFORMS } from "./constants";
import { fatalErrorSchema } from "./events";
import { displayNameSchema, epochMillisSchema, uuidSchema } from "./primitives";

export const sessionAuthenticateSchema = z.strictObject({
  clientVersion: z.string().min(1),
  appEnv: z.enum(APP_ENVIRONMENTS),
  sessionToken: z.string().min(1).optional(),
  /**
   * Which client this is. A browser may omit it, so an older client still connects;
   * it is what makes desktop adoption readable from the handshake the minimum-version
   * check already needs (appendix P7.10).
   */
  platform: z.enum(CLIENT_PLATFORMS).optional(),
});

export const sessionReadySchema = z.strictObject({
  actorId: uuidSchema,
  actorType: z.enum(ACTOR_TYPES),
  displayName: displayNameSchema,
  isGuest: z.boolean(),
  serverTime: epochMillisSchema,
  features: z.array(z.string().min(1)),
});

/**
 * Handshake acknowledgement. It carries the same payloads the server emits as
 * `session:ready` and `error:fatal`, so a client learns the outcome from the
 * acknowledgement alone and never has to race two listeners.
 */
export const sessionAuthenticateAckSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), session: sessionReadySchema }),
  z.strictObject({ ok: z.literal(false), error: fatalErrorSchema }),
]);

export type SessionAuthenticate = z.infer<typeof sessionAuthenticateSchema>;
export type SessionReady = z.infer<typeof sessionReadySchema>;
export type SessionAuthenticateAck = z.infer<typeof sessionAuthenticateAckSchema>;
