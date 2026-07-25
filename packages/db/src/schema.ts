import {
  bigserial,
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
 * Phase 2 tables from docs/product-spec.md section 15. `users`, `profiles`,
 * `ratings`, achievements and audit tables arrive with the phases that own them
 * (3, 4, 6 and 7); match participants are therefore polymorphic
 * (`actor_type` plus `actor_id`) and carry no foreign key yet.
 */

export const actorTypeEnum = pgEnum("actor_type", ["user", "guest"]);
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
export const matchEventTypeEnum = pgEnum("match_event_type", [
  "match-created",
  "move",
  "resignation",
  "timeout",
  "match-ended",
]);

export const guestSessions = pgTable(
  "guest_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull(),
    displayName: text("display_name").notNull(),
    claimedByUserId: uuid("claimed_by_user_id"),
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

export type GuestSessionRow = typeof guestSessions.$inferSelect;
export type NewGuestSessionRow = typeof guestSessions.$inferInsert;
export type MatchRow = typeof matches.$inferSelect;
export type NewMatchRow = typeof matches.$inferInsert;
export type MatchEventRow = typeof matchEvents.$inferSelect;
export type NewMatchEventRow = typeof matchEvents.$inferInsert;
