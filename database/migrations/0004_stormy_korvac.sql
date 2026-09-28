CREATE TABLE IF NOT EXISTS "exploration_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"student_user_id" text NOT NULL,
	"source" text NOT NULL,
	"template_version_id" text,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "intent_confirmations" (
	"id" text PRIMARY KEY NOT NULL,
	"exploration_id" text NOT NULL,
	"goal_user" text,
	"core_interests" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preferred_form" text,
	"target_beneficiary" text,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"student_user_id" text NOT NULL,
	"template_version_id" text,
	"source_exploration_id" text,
	"status" text NOT NULL,
	"current_stage_index" integer DEFAULT 0 NOT NULL,
	"stage_total" integer NOT NULL,
	"progress_percent" integer DEFAULT 0 NOT NULL,
	"title" text NOT NULL,
	"subtitle" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "exploration_sessions" ADD CONSTRAINT "exploration_sessions_student_user_id_users_id_fk" FOREIGN KEY ("student_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "intent_confirmations" ADD CONSTRAINT "intent_confirmations_exploration_id_exploration_sessions_id_fk" FOREIGN KEY ("exploration_id") REFERENCES "public"."exploration_sessions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "projects" ADD CONSTRAINT "projects_student_user_id_users_id_fk" FOREIGN KEY ("student_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "projects" ADD CONSTRAINT "projects_source_exploration_id_exploration_sessions_id_fk" FOREIGN KEY ("source_exploration_id") REFERENCES "public"."exploration_sessions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "exploration_sessions_student_idx" ON "exploration_sessions" USING btree ("student_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "exploration_sessions_status_idx" ON "exploration_sessions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "intent_confirmations_exploration_unique_idx" ON "intent_confirmations" USING btree ("exploration_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "projects_source_exploration_unique_idx" ON "projects" USING btree ("source_exploration_id") WHERE "projects"."source_exploration_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_student_idx" ON "projects" USING btree ("student_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_status_idx" ON "projects" USING btree ("status");