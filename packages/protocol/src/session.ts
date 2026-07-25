import { z } from "zod";
import { ACTOR_TYPES, APP_ENVIRONMENTS } from "./constants";
import { displayNameSchema, epochMillisSchema, uuidSchema } from "./primitives";

export const sessionAuthenticateSchema = z.strictObject({
  clientVersion: z.string().min(1),
  appEnv: z.enum(APP_ENVIRONMENTS),
  sessionToken: z.string().min(1).optional(),
});

export const sessionReadySchema = z.strictObject({
  actorId: uuidSchema,
  actorType: z.enum(ACTOR_TYPES),
  displayName: displayNameSchema,
  isGuest: z.boolean(),
  serverTime: epochMillisSchema,
  features: z.array(z.string().min(1)),
});

export type SessionAuthenticate = z.infer<typeof sessionAuthenticateSchema>;
export type SessionReady = z.infer<typeof sessionReadySchema>;
