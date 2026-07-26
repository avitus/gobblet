import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Tables from docs/product-spec.md section 15. The audit table arrives with the
 * phase that owns it (7); match participants are polymorphic (`actor_type` plus
 * `actor_id`) and carry no foreign key, because a participant may be a guest.
 */

export const actorTypeEnum = pgEnum("actor_type", ["user", "guest"]);
export const userStatusEnum = pgEnum("user_status", ["active", "suspended", "deleted"]);
export const userRoleEnum = pgEnum("user_role", ["player", "admin"]);
export const matchModeEnum = pgEnum("match_mode", ["casual", "ranked"]);
export const matchStatusEnum = pgEnum("match_status", ["queued", "active", "completed", "aborted"]);
export const matchResultEnum = pgEnum("match_result", ["light", "dark", "draw"]);
export const matchEndReasonEnum = pgEnum("match_end_reason", [
  "line",
  "revealed-line",
  "timeout",
  "resignation",
  "repetition",
  "admin",
]);
export const playerSideEnum = pgEnum("player_side", ["light", "dark"]);
export const colorAssignmentEnum = pgEnum("color_assignment", ["random", "alternated"]);
export const ratingOutcomeEnum = pgEnum("rating_outcome", ["win", "loss", "draw"]);
export const matchEventTypeEnum = pgEnum("match_event_type", [
  "match-created",
  "move",
  "resignation",
  "timeout",
  "match-ended",
]);
export const auditActionEnum = pgEnum("audit_action", [
  "user-suspended",
  "user-unsuspended",
  "rating-adjusted",
  "achievement-created",
  "achievement-updated",
  "role-granted",
  "release-published",
  "release-paused",
  "release-resumed",
  "release-promoted",
]);
export const auditTargetTypeEnum = pgEnum("audit_target_type", ["user", "achievement", "release"]);
export const releaseChannelEnum = pgEnum("release_channel", ["stable", "beta"]);
export const updateTargetEnum = pgEnum("update_target", [
  "darwin-aarch64",
  "darwin-x86_64",
  "windows-x86_64",
]);
export const connectionEventKindEnum = pgEnum("connection_event_kind", ["attached", "detached"]);

/**
 * Section 15.1 names `auth_subject` because identity was going to be delegated.
 * It is replaced by the credential this project owns (appendix P3):
 * `email` plus `password_hash`. `username_normalized` is the column uniqueness is
 * enforced on, so two names that differ only by capitalisation cannot coexist.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    username: text("username").notNull(),
    usernameNormalized: text("username_normalized").notNull(),
    displayName: text("display_name").notNull(),
    status: userStatusEnum("status").notNull().default("active"),
    /**
     * An administrator is an ordinary account with a role, granted by a script and
     * checked on every administrative request
     * (docs/adr/0029-administration-is-a-role-on-the-account.md).
     */
    role: userRoleEnum("role").notNull().default("player"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    suspendedReason: text("suspended_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("users_email_key").on(table.email),
    uniqueIndex("users_username_normalized_key").on(table.usernameNormalized),
  ],
);

export const profiles = pgTable("profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  avatarUrl: text("avatar_url"),
  countryCode: text("country_code"),
  presetMessagesMuted: boolean("preset_messages_muted").notNull().default(false),
  reactionsMuted: boolean("reactions_muted").notNull().default(false),
  gameSoundMuted: boolean("game_sound_muted").notNull().default(false),
  reducedMotion: boolean("reduced_motion").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Account sessions, stored the same way as guest sessions: hash only. */
export const userSessions = pgTable(
  "user_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("user_sessions_token_hash_key").on(table.tokenHash),
    index("user_sessions_user_idx").on(table.userId),
  ],
);

export const emailVerificationTokens = pgTable(
  "email_verification_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    email: text("email").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("email_verification_tokens_token_hash_key").on(table.tokenHash),
    index("email_verification_tokens_user_idx").on(table.userId),
  ],
);

export const guestSessions = pgTable(
  "guest_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull(),
    displayName: text("display_name").notNull(),
    claimedByUserId: uuid("claimed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("guest_sessions_token_hash_key").on(table.tokenHash)],
);

export const matches = pgTable(
  "matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mode: matchModeEnum("mode").notNull(),
    timeControlSeconds: integer("time_control_seconds").notNull(),
    status: matchStatusEnum("status").notNull().default("queued"),
    result: matchResultEnum("result"),
    endReason: matchEndReasonEnum("end_reason"),
    lightPlayerType: actorTypeEnum("light_player_type").notNull(),
    lightPlayerId: uuid("light_player_id").notNull(),
    lightDisplayName: text("light_display_name").notNull(),
    darkPlayerType: actorTypeEnum("dark_player_type").notNull(),
    darkPlayerId: uuid("dark_player_id").notNull(),
    darkDisplayName: text("dark_display_name").notNull(),
    gameState: jsonb("game_state").notNull(),
    stateVersion: integer("state_version").notNull().default(0),
    lightRemainingMs: integer("light_remaining_ms").notNull(),
    darkRemainingMs: integer("dark_remaining_ms").notNull(),
    activePlayer: playerSideEnum("active_player").notNull(),
    turnStartedAt: timestamp("turn_started_at", { withTimezone: true }),
    lastClockCommitAt: timestamp("last_clock_commit_at", { withTimezone: true }),
    moveCount: integer("move_count").notNull().default(0),
    /**
     * The lines that ended the match, written as it completes. Recording them here
     * is what lets the "Four Ways" achievement be one aggregate query rather than a
     * replay of every match an account has played
     * (docs/adr/0027-achievements-awarded-in-the-completion-transaction.md).
     */
    winningLineIds: text("winning_line_ids").array(),
    /** How the seats were decided, which section 9.4 requires to be auditable. */
    colorAssignment: colorAssignmentEnum("color_assignment").notNull().default("random"),
    /**
     * How long the longer-waiting player waited for this pairing. Persisted so the
     * average matchmaking wait of section 16 survives a deployment, and `null` for a
     * match that was not made by a queue (a rematch, or a development fixture).
     */
    pairingWaitMs: integer("pairing_wait_ms"),
    /** The match this one alternates colours from, for a rematch (section 4.5). */
    rematchOfMatchId: uuid("rematch_of_match_id").references((): AnyPgColumn => matches.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (table) => [
    index("matches_status_idx").on(table.status),
    index("matches_light_player_idx").on(table.lightPlayerType, table.lightPlayerId),
    index("matches_dark_player_idx").on(table.darkPlayerType, table.darkPlayerId),
  ],
);

/**
 * The rating aggregate of section 15.4. A row exists once an account has finished
 * a ranked match, so an account that has never played ranked has no rating rather
 * than a fictional one.
 */
export const ratings = pgTable(
  "ratings",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    rating: integer("rating").notNull(),
    gamesPlayed: integer("games_played").notNull().default(0),
    wins: integer("wins").notNull().default(0),
    losses: integer("losses").notNull().default(0),
    draws: integer("draws").notNull().default(0),
    /** Positive while winning, negative while losing, zero after a draw. */
    currentStreak: integer("current_streak").notNull().default(0),
    bestStreak: integer("best_streak").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** The moment the rating last moved, which is the final leaderboard tie-breaker. */
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /** The leading edge of every leaderboard sort (docs/adr/0028-leaderboards-are-read-time-queries.md). */
    index("ratings_leaderboard_idx").on(table.rating.desc(), table.updatedAt),
  ],
);

/**
 * The append-only audit section 10 requires: what each player's rating was, what
 * it became, and which formula produced the delta. One row per player per match,
 * so a replay of the ledger reproduces every aggregate
 * (docs/adr/0019-elo-in-the-completion-transaction.md).
 */
export const ratingChanges = pgTable(
  "rating_changes",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    side: playerSideEnum("side").notNull(),
    ratingBefore: integer("rating_before").notNull(),
    ratingAfter: integer("rating_after").notNull(),
    delta: integer("delta").notNull(),
    opponentRatingBefore: integer("opponent_rating_before").notNull(),
    outcome: ratingOutcomeEnum("outcome").notNull(),
    formulaVersion: integer("formula_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("rating_changes_match_user_key").on(table.matchId, table.userId),
    index("rating_changes_user_idx").on(table.userId),
    /** Period leaderboards select their members by when a rating moved (appendix P6.9). */
    index("rating_changes_created_at_idx").on(table.createdAt),
  ],
);

export const matchEvents = pgTable(
  "match_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    commandId: uuid("command_id"),
    type: matchEventTypeEnum("type").notNull(),
    actorType: actorTypeEnum("actor_type"),
    actorId: uuid("actor_id"),
    payload: jsonb("payload").notNull(),
    stateHash: text("state_hash").notNull(),
    /**
     * True for a move that exposed an opponent line and blocked it in the same
     * placement, which is the fact the "Uncovered" achievement needs and the only
     * one the engine computes but the board state does not keep (appendix P6.5).
     */
    revealedAndBlocked: boolean("revealed_and_blocked").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("match_events_match_sequence_key").on(table.matchId, table.sequence),
    uniqueIndex("match_events_match_command_key")
      .on(table.matchId, table.commandId)
      .where(sql`${table.commandId} is not null`),
  ],
);

/**
 * The catalogue of section 15.7. Rows are seeded from `ACHIEVEMENT_CATALOGUE` in
 * `@gobblet/protocol`, and `enabled` is what the Phase 7 admin surface toggles;
 * `badge_asset` holds a tier code rather than an image path (appendix P6.8).
 */
export const achievements = pgTable(
  "achievements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    badgeAsset: text("badge_asset").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    ruleVersion: integer("rule_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** When an administrator last edited the metadata or the flag (section 16). */
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("achievements_code_key").on(table.code)],
);

/**
 * One row per achievement an account has earned. The composite primary key is what
 * makes awarding idempotent: a repeated completion inserts nothing
 * (docs/adr/0027-achievements-awarded-in-the-completion-transaction.md).
 */
export const userAchievements = pgTable(
  "user_achievements",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    achievementId: uuid("achievement_id")
      .notNull()
      .references(() => achievements.id, { onDelete: "cascade" }),
    earnedAt: timestamp("earned_at", { withTimezone: true }).notNull().defaultNow(),
    /** The match that earned it, kept null when the match is later deleted. */
    sourceMatchId: uuid("source_match_id").references(() => matches.id, { onDelete: "set null" }),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.achievementId] }),
    index("user_achievements_user_idx").on(table.userId),
  ],
);

/**
 * The audit record section 14.4 requires of every administrative mutation. It is
 * written in the same transaction as the change it describes, and never updated or
 * deleted (docs/adr/0029-administration-is-a-role-on-the-account.md).
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null for the console, the only actor that is not an administrator's account. */
    adminUserId: uuid("admin_user_id").references(() => users.id, { onDelete: "set null" }),
    action: auditActionEnum("action").notNull(),
    targetType: auditTargetTypeEnum("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    /** What the target was called when the action happened, for a readable log. */
    targetLabel: text("target_label"),
    before: jsonb("before").notNull(),
    after: jsonb("after").notNull(),
    /** Required by the schema, so a caller that skips the screen cannot omit it. */
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /** The reading order of the log, and the key its cursor pages by. */
    index("audit_log_created_at_idx").on(table.createdAt.desc(), table.id.desc()),
    index("audit_log_target_idx").on(table.targetId),
    index("audit_log_action_idx").on(table.action),
  ],
);

/**
 * A corrective rating change (section 16). It is deliberately not a
 * `rating_changes` row: that table is the per-match audit period leaderboards
 * aggregate, and a correction has no match, no side and no opponent (appendix P7.4).
 */
export const ratingAdjustments = pgTable(
  "rating_adjustments",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    adminUserId: uuid("admin_user_id").references(() => users.id, { onDelete: "set null" }),
    auditId: uuid("audit_id")
      .notNull()
      .references(() => auditLog.id, { onDelete: "cascade" }),
    ratingBefore: integer("rating_before").notNull(),
    ratingAfter: integer("rating_after").notNull(),
    delta: integer("delta").notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("rating_adjustments_user_idx").on(table.userId)],
);

/**
 * The reconnection history section 16 asks to inspect. It is a table of its own
 * rather than a `match_events` row, because an event consumes the sequence number
 * that is the match version and a socket changes no game state (appendix P7.5).
 */
export const matchConnectionEvents = pgTable(
  "match_connection_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    kind: connectionEventKindEnum("kind").notNull(),
    actorType: actorTypeEnum("actor_type").notNull(),
    actorId: uuid("actor_id").notNull(),
    socketId: text("socket_id").notNull(),
    /** Why a socket detached, when the transport said. */
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("match_connection_events_match_idx").on(table.matchId, table.id)],
);

/**
 * A desktop release and its artifacts (docs/adr/0034-updates-are-asked-of-our-own-server.md).
 * The bytes live in immutable release storage; these rows record where they are,
 * what they weigh, what they hash to and the signature the updater verifies. A
 * version is unique within a channel, and `paused` is what stops a rollout without
 * deleting anything.
 */
export const releases = pgTable(
  "releases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    version: text("version").notNull(),
    channel: releaseChannelEnum("channel").notNull(),
    notes: text("notes").notNull(),
    paused: boolean("paused").notNull().default(false),
    publishedBy: uuid("published_by").references(() => users.id, { onDelete: "set null" }),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("releases_channel_version_key").on(table.channel, table.version),
    index("releases_channel_published_idx").on(table.channel, table.publishedAt),
  ],
);

export const releaseArtifacts = pgTable(
  "release_artifacts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    releaseId: uuid("release_id")
      .notNull()
      .references(() => releases.id, { onDelete: "cascade" }),
    target: updateTargetEnum("target").notNull(),
    /** The update bundle the updater downloads. */
    url: text("url").notNull(),
    /** The installer a person downloads from the download page. */
    downloadUrl: text("download_url").notNull(),
    signature: text("signature").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("release_artifacts_release_target_key").on(table.releaseId, table.target),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type ProfileRow = typeof profiles.$inferSelect;
export type NewProfileRow = typeof profiles.$inferInsert;
export type UserSessionRow = typeof userSessions.$inferSelect;
export type NewUserSessionRow = typeof userSessions.$inferInsert;
export type EmailVerificationTokenRow = typeof emailVerificationTokens.$inferSelect;
export type NewEmailVerificationTokenRow = typeof emailVerificationTokens.$inferInsert;
export type GuestSessionRow = typeof guestSessions.$inferSelect;
export type NewGuestSessionRow = typeof guestSessions.$inferInsert;
export type MatchRow = typeof matches.$inferSelect;
export type NewMatchRow = typeof matches.$inferInsert;
export type MatchEventRow = typeof matchEvents.$inferSelect;
export type NewMatchEventRow = typeof matchEvents.$inferInsert;
export type RatingRow = typeof ratings.$inferSelect;
export type NewRatingRow = typeof ratings.$inferInsert;
export type RatingChangeRow = typeof ratingChanges.$inferSelect;
export type NewRatingChangeRow = typeof ratingChanges.$inferInsert;
export type AchievementRow = typeof achievements.$inferSelect;
export type NewAchievementRow = typeof achievements.$inferInsert;
export type UserAchievementRow = typeof userAchievements.$inferSelect;
export type NewUserAchievementRow = typeof userAchievements.$inferInsert;
export type AuditLogRow = typeof auditLog.$inferSelect;
export type NewAuditLogRow = typeof auditLog.$inferInsert;
export type RatingAdjustmentRow = typeof ratingAdjustments.$inferSelect;
export type NewRatingAdjustmentRow = typeof ratingAdjustments.$inferInsert;
export type MatchConnectionEventRow = typeof matchConnectionEvents.$inferSelect;
export type NewMatchConnectionEventRow = typeof matchConnectionEvents.$inferInsert;
export type ReleaseRow = typeof releases.$inferSelect;
export type NewReleaseRow = typeof releases.$inferInsert;
export type ReleaseArtifactRow = typeof releaseArtifacts.$inferSelect;
export type NewReleaseArtifactRow = typeof releaseArtifacts.$inferInsert;
