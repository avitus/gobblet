CREATE TYPE "public"."color_assignment" AS ENUM('random', 'alternated');--> statement-breakpoint
CREATE TYPE "public"."rating_outcome" AS ENUM('win', 'loss', 'draw');--> statement-breakpoint
CREATE TABLE "rating_changes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"match_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"side" "player_side" NOT NULL,
	"rating_before" integer NOT NULL,
	"rating_after" integer NOT NULL,
	"delta" integer NOT NULL,
	"opponent_rating_before" integer NOT NULL,
	"outcome" "rating_outcome" NOT NULL,
	"formula_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ratings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"rating" integer NOT NULL,
	"games_played" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"draws" integer DEFAULT 0 NOT NULL,
	"current_streak" integer DEFAULT 0 NOT NULL,
	"best_streak" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "color_assignment" "color_assignment" DEFAULT 'random' NOT NULL;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "rematch_of_match_id" uuid;--> statement-breakpoint
ALTER TABLE "rating_changes" ADD CONSTRAINT "rating_changes_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_changes" ADD CONSTRAINT "rating_changes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rating_changes_match_user_key" ON "rating_changes" USING btree ("match_id","user_id");--> statement-breakpoint
CREATE INDEX "rating_changes_user_idx" ON "rating_changes" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_rematch_of_match_id_matches_id_fk" FOREIGN KEY ("rematch_of_match_id") REFERENCES "public"."matches"("id") ON DELETE set null ON UPDATE no action;