import { z } from "zod";
import {
  AUTH_METHODS,
  CLIENT_PLATFORMS,
  CLIENT_RENDER_TIERS,
  CLIENT_SETTING_NAMES,
  MATCH_END_REASONS,
  MATCH_MODES,
  MATCH_RESULTS,
  RENDER_TIER_SOURCES,
  TELEMETRY_BATCH_MAX,
  TELEMETRY_MESSAGE_MAX_LENGTH,
  TELEMETRY_STACK_MAX_LENGTH,
  UPDATE_OUTCOMES,
  type ClientAnalyticsEventName,
} from "./constants";
import { timeControlSecondsSchema } from "./match";
import { uuidSchema } from "./primitives";

/**
 * The analytics contract of docs/product-spec.md section 17.1. Every event is named
 * and every property is a scalar from a fixed vocabulary, so the free-form data,
 * addresses and tokens that section forbids have nowhere to sit
 * (docs/adr/0030-telemetry-behind-ports-relayed-through-the-server.md).
 */

const durationMsSchema = z.int().nonnegative().max(86_400_000);

const appLaunchedSchema = z.strictObject({
  name: z.literal("app-launched"),
  platform: z.enum(CLIENT_PLATFORMS),
  clientVersion: z.string().min(1).max(32),
});

const renderTierSelectedSchema = z.strictObject({
  name: z.literal("render-tier-selected"),
  tier: z.enum(CLIENT_RENDER_TIERS),
  source: z.enum(RENDER_TIER_SOURCES),
});

const settingChangedSchema = z.strictObject({
  name: z.literal("setting-changed"),
  setting: z.enum(CLIENT_SETTING_NAMES),
  /** A setting's new value as a flag or a tier, never as free text. */
  enabled: z.boolean().optional(),
  tier: z.enum(CLIENT_RENDER_TIERS).optional(),
});

/**
 * The subset a browser may report about itself. A client cannot announce a match it
 * did not finish, because the server owns those events.
 */
export const clientAnalyticsEventSchema = z.discriminatedUnion("name", [
  appLaunchedSchema,
  renderTierSelectedSchema,
  settingChangedSchema,
]);

export const analyticsEventSchema = z.discriminatedUnion("name", [
  appLaunchedSchema,
  renderTierSelectedSchema,
  settingChangedSchema,
  z.strictObject({ name: z.literal("guest-created") }),
  z.strictObject({
    name: z.literal("sign-up-completed"),
    /** Whether the account came from a guest session that was claimed. */
    fromGuest: z.boolean(),
  }),
  z.strictObject({
    name: z.literal("signed-in"),
    method: z.enum(AUTH_METHODS),
  }),
  z.strictObject({
    name: z.literal("queue-joined"),
    mode: z.enum(MATCH_MODES),
    timeControlSeconds: timeControlSecondsSchema,
  }),
  z.strictObject({
    name: z.literal("match-found"),
    mode: z.enum(MATCH_MODES),
    timeControlSeconds: timeControlSecondsSchema,
    /** How long the player waited, which section 17.1 tracks beside the pairing. */
    waitMs: durationMsSchema,
  }),
  z.strictObject({
    name: z.literal("match-started"),
    mode: z.enum(MATCH_MODES),
    timeControlSeconds: timeControlSecondsSchema,
  }),
  z.strictObject({
    name: z.literal("match-completed"),
    mode: z.enum(MATCH_MODES),
    timeControlSeconds: timeControlSecondsSchema,
    result: z.enum(MATCH_RESULTS),
    endReason: z.enum(MATCH_END_REASONS),
    moveCount: z.int().nonnegative(),
    durationMs: durationMsSchema,
  }),
  z.strictObject({ name: z.literal("rematch-requested"), mode: z.enum(MATCH_MODES) }),
  z.strictObject({ name: z.literal("rematch-accepted"), mode: z.enum(MATCH_MODES) }),
  z.strictObject({
    name: z.literal("desktop-update-completed"),
    outcome: z.enum(UPDATE_OUTCOMES),
    /** Emitted from Phase 8 onwards; the schema exists so the sink is ready. */
    fromVersion: z.string().min(1).max(32),
    toVersion: z.string().min(1).max(32),
  }),
]);

export type AnalyticsEvent = z.infer<typeof analyticsEventSchema>;
export type ClientAnalyticsEvent = Extract<AnalyticsEvent, { name: ClientAnalyticsEventName }>;

export const telemetryEventsRequestSchema = z.strictObject({
  events: z.array(clientAnalyticsEventSchema).min(1).max(TELEMETRY_BATCH_MAX),
});

/**
 * A browser error, reported through the server so that no provider software ships
 * to a client. The message and the stack are bounded, and neither is ever logged
 * with a token in it: the client sends what it has, the server sends nothing on.
 */
export const telemetryErrorRequestSchema = z.strictObject({
  name: z.string().min(1).max(120),
  message: z.string().min(1).max(TELEMETRY_MESSAGE_MAX_LENGTH),
  stack: z.string().max(TELEMETRY_STACK_MAX_LENGTH).optional(),
  /** Where it happened, as a route pattern the client owns rather than a full URL. */
  route: z.string().min(1).max(120),
  matchId: uuidSchema.optional(),
});

export type TelemetryEventsRequest = z.infer<typeof telemetryEventsRequestSchema>;
export type TelemetryErrorRequest = z.infer<typeof telemetryErrorRequestSchema>;

/** Accepted counts, so a client can tell a refusal from a partial acceptance. */
export const telemetryAcceptedResponseSchema = z.strictObject({
  accepted: z.int().nonnegative(),
});

export type TelemetryAcceptedResponse = z.infer<typeof telemetryAcceptedResponseSchema>;
