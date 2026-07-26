import { z } from "zod";
import { profileBadgeSchema } from "./achievements";
import { USERNAME_UNAVAILABLE_REASONS, USER_STATUSES } from "./constants";
import { playerMatchSummarySchema } from "./http";
import {
  avatarUrlSchema,
  countryCodeSchema,
  emailSchema,
  passwordSchema,
  usernameSchema,
} from "./identity";
import { displayNameSchema, isoTimestampSchema, uuidSchema } from "./primitives";
import { rankedRecordSchema } from "./rating";

/**
 * Account, session and profile payloads for the first-party credential flow
 * (docs/adr/0017-first-party-email-password-authentication.md). The private view
 * (`GET /v1/me`) may show the email; the public profile must not
 * (docs/product-spec.md section 11.1).
 */

export const accountSchema = z.strictObject({
  userId: uuidSchema,
  username: z.string().min(1),
  email: emailSchema,
  emailVerified: z.boolean(),
  status: z.enum(USER_STATUSES),
  createdAt: isoTimestampSchema,
});

/** A session token is shown once, in the response that created it. */
export const issuedSessionSchema = z.strictObject({
  sessionToken: z.string().min(1),
  expiresAt: isoTimestampSchema,
});

export const profileSettingsSchema = z.strictObject({
  avatarUrl: z.string().min(1).nullable(),
  countryCode: z.string().length(2).nullable(),
  presetMessagesMuted: z.boolean(),
  reactionsMuted: z.boolean(),
  gameSoundMuted: z.boolean(),
  reducedMotion: z.boolean(),
});

/** Casual results, which are tracked separately from ranked ones (spec section 2.6). */
export const casualRecordSchema = z.strictObject({
  wins: z.int().nonnegative(),
  losses: z.int().nonnegative(),
  draws: z.int().nonnegative(),
  played: z.int().nonnegative(),
});

export const publicProfileSchema = z.strictObject({
  username: z.string().min(1),
  avatarUrl: z.string().min(1).nullable(),
  countryCode: z.string().length(2).nullable(),
  /** Creation month, not the exact day: section 11.1 shows month and year only. */
  memberSince: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  casual: casualRecordSchema,
  /** `null` until the account has finished a ranked match, so nothing is invented. */
  ranked: rankedRecordSchema.nullable(),
  /** The all-time board position, `null` for an account with no rating (appendix P6.13). */
  rank: z.int().positive().nullable(),
  badges: z.array(profileBadgeSchema),
  /** The most recent completed matches, without the move log (appendix P6.12). */
  recentMatches: z.array(playerMatchSummarySchema),
});

export const registerRequestSchema = z.strictObject({
  email: emailSchema,
  password: passwordSchema,
  username: usernameSchema,
  displayName: displayNameSchema.optional(),
});

export const signInRequestSchema = z.strictObject({
  email: emailSchema,
  password: passwordSchema,
});

/**
 * The verification token is returned only outside production, where no mail
 * sender exists (appendix P3). It is never logged.
 */
export const emailVerificationHandoffSchema = z.strictObject({
  token: z.string().min(1),
  expiresAt: isoTimestampSchema,
});

export const authResponseSchema = z.strictObject({
  account: accountSchema,
  session: issuedSessionSchema,
  emailVerification: emailVerificationHandoffSchema.optional(),
});

export const verifyEmailRequestSchema = z.strictObject({
  token: z.string().min(1),
});

export const meResponseSchema = z.strictObject({
  account: accountSchema,
  profile: profileSettingsSchema,
  casual: casualRecordSchema,
  ranked: rankedRecordSchema.nullable(),
  /** The all-time board position, as a public profile shows it (appendix P6.13). */
  rank: z.int().positive().nullable(),
});

/**
 * Every field is optional and `null` clears an optional value, so a client can
 * send only what changed.
 */
export const updateProfileRequestSchema = z
  .strictObject({
    avatarUrl: avatarUrlSchema.nullable().optional(),
    countryCode: countryCodeSchema.nullable().optional(),
    presetMessagesMuted: z.boolean().optional(),
    reactionsMuted: z.boolean().optional(),
    gameSoundMuted: z.boolean().optional(),
    reducedMotion: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { error: "must change at least one field" });

export const checkUsernameRequestSchema = z.strictObject({
  /** Deliberately lenient: an unusable name is an answer, not a request error. */
  username: z.string().min(1).max(64),
});

export const checkUsernameResponseSchema = z.strictObject({
  username: z.string().min(1),
  available: z.boolean(),
  reason: z.enum(USERNAME_UNAVAILABLE_REASONS).nullable(),
});

/**
 * Claiming turns the guest session used for the request into an account and
 * moves the guest's match history to it (docs/product-spec.md section 2.3).
 */
export const claimGuestRequestSchema = z.strictObject({
  email: emailSchema,
  password: passwordSchema,
  username: usernameSchema,
});

export const claimGuestResponseSchema = z.strictObject({
  account: accountSchema,
  session: issuedSessionSchema,
  emailVerification: emailVerificationHandoffSchema.optional(),
  claimedMatches: z.int().nonnegative(),
});

export type Account = z.infer<typeof accountSchema>;
export type IssuedSession = z.infer<typeof issuedSessionSchema>;
export type ProfileSettings = z.infer<typeof profileSettingsSchema>;
export type CasualRecord = z.infer<typeof casualRecordSchema>;
export type PublicProfile = z.infer<typeof publicProfileSchema>;
export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type SignInRequest = z.infer<typeof signInRequestSchema>;
export type EmailVerificationHandoff = z.infer<typeof emailVerificationHandoffSchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;
export type VerifyEmailRequest = z.infer<typeof verifyEmailRequestSchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;
export type CheckUsernameRequest = z.infer<typeof checkUsernameRequestSchema>;
export type CheckUsernameResponse = z.infer<typeof checkUsernameResponseSchema>;
export type ClaimGuestRequest = z.infer<typeof claimGuestRequestSchema>;
export type ClaimGuestResponse = z.infer<typeof claimGuestResponseSchema>;
