CREATE TYPE "public"."actor_type" AS ENUM('user', 'guest');--> statement-breakpoint
CREATE TYPE "public"."match_end_reason" AS ENUM('line', 'revealed-line', 'timeout', 'resignation', 'repetition', 'admin');--> statement-breakpoint
CREATE TYPE "public"."match_event_type" AS ENUM('match-created', 'move', 'resignation', 'timeout', 'match-ended');--> statement-breakpoint
CREATE TYPE "public"."match_mode" AS ENUM('casual', 'ranked');--> statement-breakpoint
CREATE TYPE "public"."match_result" AS ENUM('light', 'dark', 'draw');--> statement-breakpoint
CREATE TYPE "public"."match_status" AS ENUM('queued', 'active', 'completed', 'aborted');--> statement-breakpoint
CREATE TYPE "public"."player_side" AS ENUM('light', 'dark');--> statement-breakpoint
CREATE TABLE "guest_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"claimed_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"match_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"command_id" uuid,
	"type" "match_event_type" NOT NULL,
	"actor_type" "actor_type",
	"actor_id" uuid,
	"payload" jsonb NOT NULL,
	"state_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mode" "match_mode" NOT NULL,
	"time_control_seconds" integer NOT NULL,
	"status" "match_status" DEFAULT 'queued' NOT NULL,
	"result" "match_result",
	"end_reason" "match_end_reason",
	"light_player_type" "actor_type" NOT NULL,
	"light_player_id" uuid NOT NULL,
	"light_display_name" text NOT NULL,
	"dark_player_type" "actor_type" NOT NULL,
	"dark_player_id" uuid NOT NULL,
	"dark_display_name" text NOT NULL,
	"game_state" jsonb NOT NULL,
	"state_version" integer DEFAULT 0 NOT NULL,
	"light_remaining_ms" integer NOT NULL,
	"dark_remaining_ms" integer NOT NULL,
	"active_player" "player_side" NOT NULL,
	"turn_started_at" timestamp with time zone,
	"last_clock_commit_at" timestamp with time zone,
	"move_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "match_events" ADD CONSTRAINT "match_events_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "guest_sessions_token_hash_key" ON "guest_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "match_events_match_sequence_key" ON "match_events" USING btree ("match_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "match_events_match_command_key" ON "match_events" USING btree ("match_id","command_id") WHERE "match_events"."command_id" is not null;--> statement-breakpoint
CREATE INDEX "matches_status_idx" ON "matches" USING btree ("status");--> statement-breakpoint
CREATE INDEX "matches_light_player_idx" ON "matches" USING btree ("light_player_type","light_player_id");--> statement-breakpoint
CREATE INDEX "matches_dark_player_idx" ON "matches" USING btree ("dark_player_type","dark_player_id");