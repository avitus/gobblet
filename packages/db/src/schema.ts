import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Tables from docs/product-spec.md section 15. Achievement and audit tables arrive
 * with the phases that own them (6 and 7); match participants are polymorphic
 * (`actor_type` plus `actor_id`) and carry no foreign key, because a participant
 * may be a guest.
 */

export const actorTypeEnum = pgEnum("actor_type", ["user", "guest"]);
export const userStatusEnum = pgEnum("user_status", ["active", "suspended", "deleted"]);
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
    /** How the seats were decided, which section 9.4 requires to be auditable. */
    colorAssignment: colorAssignmentEnum("color_assignment").notNull().default("random"),
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
export const ratings = pgTable("ratings", {
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
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("match_events_match_sequence_key").on(table.matchId, table.sequence),
    uniqueIndex("match_events_match_command_key")
      .on(table.matchId, table.commandId)
      .where(sql`${table.commandId} is not null`),
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
