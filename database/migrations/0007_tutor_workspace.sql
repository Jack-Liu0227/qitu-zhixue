CREATE TABLE IF NOT EXISTS "tutor_growth_signals" (
	"id" text PRIMARY KEY NOT NULL,
	"idempotency_key" text NOT NULL,
	"student_id" text NOT NULL,
	"project_id" text,
	"kind" text NOT NULL,
	"summary" text NOT NULL,
	"evidence_ref" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tutor_knowledge_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"student_id" text,
	"project_id" text,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"content" text NOT NULL,
	"source" text NOT NULL,
	"scope" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tutor_learner_profiles" (
	"student_id" text PRIMARY KEY NOT NULL,
	"prior_knowledge" text,
	"target_level" text,
	"time_budget_minutes_per_week" integer,
	"preferences" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"interests" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"strengths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"next_questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tutor_memories" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"partner_id" text NOT NULL,
	"kind" text NOT NULL,
	"content" text NOT NULL,
	"confidence_basis_points" integer DEFAULT 600 NOT NULL,
	"source" text NOT NULL,
	"visibility" text DEFAULT 'student_private' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tutor_partners" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"soul" text NOT NULL,
	"model_usage" text DEFAULT 'tutor.chat' NOT NULL,
	"prompt_version" text NOT NULL,
	"capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tutor_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"partner_id" text NOT NULL,
	"project_id" text,
	"source" text NOT NULL,
	"last_seq" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tutor_template_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"student_id" text,
	"project_id" text,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stage" text NOT NULL,
	"content" text NOT NULL,
	"scope" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tutor_turns" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"student_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text,
	"blocks" jsonb NOT NULL,
	"seq" integer NOT NULL,
	"hint_level" integer,
	"pedagogic_move" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tutor_growth_signals" ADD CONSTRAINT "tutor_growth_signals_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tutor_growth_signals" ADD CONSTRAINT "tutor_growth_signals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tutor_knowledge_documents" ADD CONSTRAINT "tutor_knowledge_documents_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tutor_knowledge_documents" ADD CONSTRAINT "tutor_knowledge_documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tutor_learner_profiles" ADD CONSTRAINT "tutor_learner_profiles_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tutor_memories" ADD CONSTRAINT "tutor_memories_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tutor_memories" ADD CONSTRAINT "tutor_memories_partner_id_tutor_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."tutor_partners"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tutor_sessions" ADD CONSTRAINT "tutor_sessions_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tutor_sessions" ADD CONSTRAINT "tutor_sessions_partner_id_tutor_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."tutor_partners"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tutor_sessions" ADD CONSTRAINT "tutor_sessions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tutor_template_documents" ADD CONSTRAINT "tutor_template_documents_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tutor_template_documents" ADD CONSTRAINT "tutor_template_documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tutor_turns" ADD CONSTRAINT "tutor_turns_session_id_tutor_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."tutor_sessions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tutor_turns" ADD CONSTRAINT "tutor_turns_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tutor_growth_signals_idempotency_unique_idx" ON "tutor_growth_signals" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tutor_growth_signals_student_idx" ON "tutor_growth_signals" USING btree ("student_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tutor_knowledge_documents_active_idx" ON "tutor_knowledge_documents" USING btree ("active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tutor_knowledge_documents_student_idx" ON "tutor_knowledge_documents" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tutor_knowledge_documents_project_idx" ON "tutor_knowledge_documents" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tutor_memories_relation_idx" ON "tutor_memories" USING btree ("student_id","partner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tutor_memories_updated_idx" ON "tutor_memories" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tutor_sessions_student_idx" ON "tutor_sessions" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tutor_sessions_project_idx" ON "tutor_sessions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tutor_template_documents_active_idx" ON "tutor_template_documents" USING btree ("active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tutor_template_documents_student_idx" ON "tutor_template_documents" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tutor_template_documents_project_idx" ON "tutor_template_documents" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tutor_turns_session_seq_unique_idx" ON "tutor_turns" USING btree ("session_id","seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tutor_turns_session_idx" ON "tutor_turns" USING btree ("session_id");