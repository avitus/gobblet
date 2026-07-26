import { z } from "zod";
import { achievementSchema } from "./achievements";
import {
  ADMIN_PAGE_SIZE,
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
  MATCH_END_REASONS,
  MATCH_MODES,
  MATCH_STATUSES,
  USER_ROLES,
  USER_STATUSES,
} from "./constants";
import { matchSummarySchema } from "./http";
import { emailSchema } from "./identity";
import { matchClocksSchema, timeControlSecondsSchema } from "./match";
import { isoTimestampSchema, matchVersionSchema, uuidSchema } from "./primitives";
import { ratingValueSchema } from "./rating";

/**
 * The administrative surface of docs/product-spec.md sections 14.4 and 16. Every
 * route requires the `admin` role on the calling account and every mutation names a
 * reason, because the reason is part of the audit record rather than of the screen
 * (docs/adr/0029-administration-is-a-role-on-the-account.md).
 */

/** A reason is required, and long enough to be a sentence rather than a shrug. */
export const auditReasonSchema = z.string().trim().min(8).max(500);

export const adminUserSummarySchema = z.strictObject({
  userId: uuidSchema,
  username: z.string().min(1),
  status: z.enum(USER_STATUSES),
  role: z.enum(USER_ROLES),
  emailVerified: z.boolean(),
  rating: ratingValueSchema.nullable(),
  createdAt: isoTimestampSchema,
  lastSeenAt: isoTimestampSchema,
});

/**
 * A search matches a username prefix, an internal id, or an email address in full.
 * A partial address matches nothing, so the surface cannot be used to enumerate
 * addresses (appendix P7.2).
 */
export const adminUserSearchQuerySchema = z.strictObject({
  query: z.string().trim().min(1).max(254).optional(),
  status: z.enum(USER_STATUSES).optional(),
  limit: z.int().positive().max(ADMIN_PAGE_SIZE).optional(),
  cursor: z.string().min(1).optional(),
});

export const adminUserListResponseSchema = z.strictObject({
  users: z.array(adminUserSummarySchema),
  nextCursor: z.string().min(1).nullable(),
});

export const adminModerationEntrySchema = z.strictObject({
  action: z.enum(AUDIT_ACTIONS),
  adminUsername: z.string().min(1).nullable(),
  reason: z.string().min(1),
  createdAt: isoTimestampSchema,
});

export const adminUserDetailSchema = z.strictObject({
  user: adminUserSummarySchema,
  /** Shown on one account's page only, never in a list (appendix P7.2). */
  email: emailSchema,
  displayName: z.string().min(1),
  suspendedAt: isoTimestampSchema.nullable(),
  suspendedReason: z.string().min(1).nullable(),
  casual: z.strictObject({
    wins: z.int().nonnegative(),
    losses: z.int().nonnegative(),
    draws: z.int().nonnegative(),
    played: z.int().nonnegative(),
  }),
  ranked: z
    .strictObject({
      rating: ratingValueSchema,
      wins: z.int().nonnegative(),
      losses: z.int().nonnegative(),
      draws: z.int().nonnegative(),
      played: z.int().nonnegative(),
      currentStreak: z.int(),
      bestStreak: z.int().nonnegative(),
      ratedAt: isoTimestampSchema,
    })
    .nullable(),
  recentMatches: z.array(matchSummarySchema),
  moderation: z.array(adminModerationEntrySchema),
  activeSessions: z.int().nonnegative(),
});

export const adminSuspendRequestSchema = z.strictObject({ reason: auditReasonSchema });

export const adminRatingAdjustRequestSchema = z.strictObject({
  rating: ratingValueSchema,
  reason: auditReasonSchema,
});

export const adminRatingAdjustResponseSchema = z.strictObject({
  userId: uuidSchema,
  ratingBefore: ratingValueSchema,
  ratingAfter: ratingValueSchema,
  adjustedAt: isoTimestampSchema,
});

/**
 * Match inspection (section 16). The event log is the internal one, payloads and
 * state hashes included, and the connection history sits beside it because a socket
 * attaching changes no game state and must not consume a match version (P7.5).
 */
export const adminMatchEventSchema = z.strictObject({
  sequence: matchVersionSchema,
  type: z.string().min(1),
  actorType: z.string().min(1).nullable(),
  actorId: uuidSchema.nullable(),
  commandId: uuidSchema.nullable(),
  payload: z.unknown(),
  stateHash: z.string().min(1),
  revealedAndBlocked: z.boolean(),
  createdAt: isoTimestampSchema,
});

export const adminConnectionEventSchema = z.strictObject({
  kind: z.enum(["attached", "detached"]),
  actorType: z.string().min(1),
  actorId: uuidSchema,
  socketId: z.string().min(1),
  reason: z.string().min(1).nullable(),
  createdAt: isoTimestampSchema,
});

export const adminMatchDetailSchema = z.strictObject({
  match: matchSummarySchema,
  version: matchVersionSchema,
  clocks: matchClocksSchema,
  events: z.array(adminMatchEventSchema),
  connections: z.array(adminConnectionEventSchema),
});

/**
 * The catalogue as an administrator manages it: metadata and a flag over rules that
 * live in code, so a row can only be created for a code the server can evaluate
 * (appendix P7.3).
 */
export const adminAchievementSchema = achievementSchema.extend({
  achievementId: uuidSchema,
  enabled: z.boolean(),
  awarded: z.int().nonnegative(),
  updatedAt: isoTimestampSchema,
});

export const adminAchievementListResponseSchema = z.strictObject({
  achievements: z.array(adminAchievementSchema),
});

export const adminAchievementCreateRequestSchema = achievementSchema
  .omit({ ruleVersion: true })
  .extend({
    enabled: z.boolean().optional(),
    reason: auditReasonSchema,
  });

export const adminAchievementUpdateRequestSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().min(1).max(300).optional(),
    badge: achievementSchema.shape.badge.optional(),
    enabled: z.boolean().optional(),
    reason: auditReasonSchema,
  })
  .refine((value) => Object.keys(value).length > 1, {
    error: "must change at least one field",
  });

/**
 * The operational summary of section 16. It is SQL over the product tables rather
 * than a read of the metrics registry, so a deployment does not reset it
 * (docs/adr/0031-metrics-are-a-prometheus-exposition.md).
 */
export const adminQueueDepthSchema = z.strictObject({
  mode: z.enum(MATCH_MODES),
  timeControlSeconds: timeControlSecondsSchema,
  waiting: z.int().nonnegative(),
});

export const adminRecentErrorSchema = z.strictObject({
  code: z.string().min(1),
  route: z.string().min(1),
  count: z.int().positive(),
  lastSeenAt: isoTimestampSchema,
});

export const adminMetricsSummarySchema = z.strictObject({
  generatedAt: isoTimestampSchema,
  windowHours: z.int().positive(),
  deployment: z.strictObject({
    appVersion: z.string().min(1),
    gitSha: z.string().min(1),
    appEnv: z.string().min(1),
    uptimeSeconds: z.int().nonnegative(),
  }),
  health: z.strictObject({
    ready: z.boolean(),
    checks: z.array(z.strictObject({ name: z.string().min(1), ok: z.boolean() })),
  }),
  activity: z.strictObject({
    dailyActiveAccounts: z.int().nonnegative(),
    dailyActiveGuests: z.int().nonnegative(),
    dailyActiveUsers: z.int().nonnegative(),
  }),
  matches: z.strictObject({
    active: z.int().nonnegative(),
    completed: z.int().nonnegative(),
    aborted: z.int().nonnegative(),
    /** `null` when nothing finished in the window, rather than a misleading zero. */
    completionRate: z.number().min(0).max(1).nullable(),
    abandonmentRate: z.number().min(0).max(1).nullable(),
    byEndReason: z.array(
      z.strictObject({
        reason: z.enum(MATCH_END_REASONS),
        count: z.int().nonnegative(),
      }),
    ),
  }),
  matchmaking: z.strictObject({
    queueDepth: z.array(adminQueueDepthSchema),
    /** `null` when no pairing happened in the window. */
    averageWaitMs: z.int().nonnegative().nullable(),
    pairings: z.int().nonnegative(),
  }),
  sockets: z.strictObject({
    connected: z.int().nonnegative(),
  }),
  errors: z.strictObject({
    total: z.int().nonnegative(),
    recent: z.array(adminRecentErrorSchema),
  }),
  /** Empty until a desktop client exists in Phase 8 (appendix P7.10). */
  clientVersions: z.array(
    z.strictObject({
      platform: z.string().min(1),
      version: z.string().min(1),
      sessions: z.int().nonnegative(),
    }),
  ),
});

export const adminAuditEntrySchema = z.strictObject({
  auditId: uuidSchema,
  action: z.enum(AUDIT_ACTIONS),
  /** `null` for the console, which is the only actor that is not an administrator. */
  adminUserId: uuidSchema.nullable(),
  adminUsername: z.string().min(1).nullable(),
  targetType: z.enum(AUDIT_TARGET_TYPES),
  targetId: uuidSchema,
  targetLabel: z.string().min(1).nullable(),
  before: z.unknown(),
  after: z.unknown(),
  reason: z.string().min(1),
  createdAt: isoTimestampSchema,
});

export const adminAuditQuerySchema = z.strictObject({
  action: z.enum(AUDIT_ACTIONS).optional(),
  targetId: uuidSchema.optional(),
  limit: z.int().positive().max(ADMIN_PAGE_SIZE).optional(),
  cursor: z.string().min(1).optional(),
});

export const adminAuditResponseSchema = z.strictObject({
  entries: z.array(adminAuditEntrySchema),
  nextCursor: z.string().min(1).nullable(),
});

export const adminActiveMatchSchema = z.strictObject({
  matchId: uuidSchema,
  mode: z.enum(MATCH_MODES),
  status: z.enum(MATCH_STATUSES),
  timeControlSeconds: timeControlSecondsSchema,
  version: matchVersionSchema,
  lightDisplayName: z.string().min(1),
  darkDisplayName: z.string().min(1),
  startedAt: isoTimestampSchema.nullable(),
});

export const adminActiveMatchesResponseSchema = z.strictObject({
  matches: z.array(adminActiveMatchSchema),
});

export type AuditReason = z.infer<typeof auditReasonSchema>;
export type AdminUserSummary = z.infer<typeof adminUserSummarySchema>;
export type AdminUserSearchQuery = z.infer<typeof adminUserSearchQuerySchema>;
export type AdminUserListResponse = z.infer<typeof adminUserListResponseSchema>;
export type AdminModerationEntry = z.infer<typeof adminModerationEntrySchema>;
export type AdminUserDetail = z.infer<typeof adminUserDetailSchema>;
export type AdminSuspendRequest = z.infer<typeof adminSuspendRequestSchema>;
export type AdminRatingAdjustRequest = z.infer<typeof adminRatingAdjustRequestSchema>;
export type AdminRatingAdjustResponse = z.infer<typeof adminRatingAdjustResponseSchema>;
export type AdminMatchEvent = z.infer<typeof adminMatchEventSchema>;
export type AdminConnectionEvent = z.infer<typeof adminConnectionEventSchema>;
export type AdminMatchDetail = z.infer<typeof adminMatchDetailSchema>;
export type AdminAchievement = z.infer<typeof adminAchievementSchema>;
export type AdminAchievementListResponse = z.infer<typeof adminAchievementListResponseSchema>;
export type AdminAchievementCreateRequest = z.infer<typeof adminAchievementCreateRequestSchema>;
export type AdminAchievementUpdateRequest = z.infer<typeof adminAchievementUpdateRequestSchema>;
export type AdminQueueDepth = z.infer<typeof adminQueueDepthSchema>;
export type AdminRecentError = z.infer<typeof adminRecentErrorSchema>;
export type AdminMetricsSummary = z.infer<typeof adminMetricsSummarySchema>;
export type AdminAuditEntry = z.infer<typeof adminAuditEntrySchema>;
export type AdminAuditQuery = z.infer<typeof adminAuditQuerySchema>;
export type AdminAuditResponse = z.infer<typeof adminAuditResponseSchema>;
export type AdminActiveMatch = z.infer<typeof adminActiveMatchSchema>;
export type AdminActiveMatchesResponse = z.infer<typeof adminActiveMatchesResponseSchema>;
