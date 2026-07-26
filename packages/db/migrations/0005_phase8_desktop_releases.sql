CREATE TYPE "public"."release_channel" AS ENUM('stable', 'beta');--> statement-breakpoint
CREATE TYPE "public"."update_target" AS ENUM('darwin-aarch64', 'darwin-x86_64', 'windows-x86_64');--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'release-published';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'release-paused';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'release-resumed';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'release-promoted';--> statement-breakpoint
ALTER TYPE "public"."audit_target_type" ADD VALUE 'release';--> statement-breakpoint
CREATE TABLE "release_artifacts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"release_id" uuid NOT NULL,
	"target" "update_target" NOT NULL,
	"url" text NOT NULL,
	"download_url" text NOT NULL,
	"signature" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" text NOT NULL,
	"channel" "release_channel" NOT NULL,
	"notes" text NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"published_by" uuid,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "release_artifacts" ADD CONSTRAINT "release_artifacts_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "release_artifacts_release_target_key" ON "release_artifacts" USING btree ("release_id","target");--> statement-breakpoint
CREATE UNIQUE INDEX "releases_channel_version_key" ON "releases" USING btree ("channel","version");--> statement-breakpoint
CREATE INDEX "releases_channel_published_idx" ON "releases" USING btree ("channel","published_at");