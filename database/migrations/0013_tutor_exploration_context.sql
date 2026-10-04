ALTER TABLE "tutor_sessions" ADD COLUMN IF NOT EXISTS "exploration_id" text;
--> statement-breakpoint
ALTER TABLE "tutor_sessions" ADD CONSTRAINT "tutor_sessions_exploration_id_exploration_sessions_id_fk" FOREIGN KEY ("exploration_id") REFERENCES "public"."exploration_sessions"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tutor_sessions_exploration_idx" ON "tutor_sessions" USING btree ("exploration_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tutor_sessions_project_unique_idx" ON "tutor_sessions" ("project_id") WHERE "project_id" IS NOT NULL AND "archived_at" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tutor_sessions_exploration_unique_idx" ON "tutor_sessions" ("exploration_id") WHERE "exploration_id" IS NOT NULL AND "archived_at" IS NULL;
