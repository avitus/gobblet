CREATE TABLE "achievements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"badge_asset" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"rule_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_achievements" (
	"user_id" uuid NOT NULL,
	"achievement_id" uuid NOT NULL,
	"earned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_match_id" uuid,
	CONSTRAINT "user_achievements_user_id_achievement_id_pk" PRIMARY KEY("user_id","achievement_id")
);
--> statement-breakpoint
ALTER TABLE "match_events" ADD COLUMN "revealed_and_blocked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "winning_line_ids" text[];--> statement-breakpoint
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_achievement_id_achievements_id_fk" FOREIGN KEY ("achievement_id") REFERENCES "public"."achievements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_source_match_id_matches_id_fk" FOREIGN KEY ("source_match_id") REFERENCES "public"."matches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "achievements_code_key" ON "achievements" USING btree ("code");--> statement-breakpoint
CREATE INDEX "user_achievements_user_idx" ON "user_achievements" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "rating_changes_created_at_idx" ON "rating_changes" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ratings_leaderboard_idx" ON "ratings" USING btree ("rating" DESC NULLS LAST,"updated_at");--> statement-breakpoint
INSERT INTO "achievements" ("code", "name", "description", "badge_asset", "rule_version") VALUES
	('first-victory', 'First Victory', 'Win your first match.', 'bronze', 1),
	('getting-started', 'Getting Started', 'Complete ten matches.', 'bronze', 1),
	('contender', 'Contender', 'Win ten ranked matches.', 'silver', 1),
	('on-a-roll', 'On a Roll', 'Win three ranked matches in a row.', 'silver', 1),
	('century-club', 'Century Club', 'Complete one hundred matches.', 'gold', 1),
	('time-keeper', 'Time Keeper', 'Win a ranked match on the opponent''s clock.', 'silver', 1),
	('uncovered', 'Uncovered', 'Win a match in which you revealed an opponent line and blocked it in one move.', 'gold', 1),
	('four-ways', 'Four Ways', 'Win with a row, a column and both diagonals.', 'gold', 1)
ON CONFLICT ("code") DO NOTHING;
