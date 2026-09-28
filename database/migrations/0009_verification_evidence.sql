CREATE TABLE IF NOT EXISTS "pending_questions" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" text,
	"student_user_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"session_id" text NOT NULL,
	"objective_id" text NOT NULL,
	"question_type" text NOT NULL,
	"prompt" text NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expected_answer" text DEFAULT '' NOT NULL,
	"explanation" text DEFAULT '' NOT NULL,
	"difficulty" text,
	"assessment_type" text DEFAULT 'quiz' NOT NULL,
	"status" text DEFAULT 'awaiting' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"hints_used" integer DEFAULT 0 NOT NULL,
	"idempotency_key" text NOT NULL,
	"asked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "template_verification_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"school_id" text,
	"check_key" text NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" text NOT NULL,
	"student_user_id" text,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "template_verification_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" text,
	"template_version_id" text NOT NULL,
	"passed" boolean DEFAULT false NOT NULL,
	"checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence_count" integer DEFAULT 0 NOT NULL,
	"evaluated_by" text,
	"idempotency_key" text NOT NULL,
	"evaluated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "artifact_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"artifact_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"title" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"object_key" text,
	"thumbnail_ref" text,
	"captured_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" text,
	"student_user_id" text NOT NULL,
	"project_id" text,
	"template_version_id" text,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"visibility" text DEFAULT 'student_private' NOT NULL,
	"current_version_index" integer DEFAULT 0 NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" text,
	"project_id" text NOT NULL,
	"student_user_id" text NOT NULL,
	"artifact_id" text,
	"column_kind" text NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" text NOT NULL,
	"label" text NOT NULL,
	"detail" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pending_questions" ADD CONSTRAINT "pending_questions_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pending_questions" ADD CONSTRAINT "pending_questions_student_user_id_users_id_fk" FOREIGN KEY ("student_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pending_questions" ADD CONSTRAINT "pending_questions_plan_id_learning_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."learning_plans"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pending_questions" ADD CONSTRAINT "pending_questions_session_id_learning_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."learning_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pending_questions" ADD CONSTRAINT "pending_questions_objective_id_learning_objectives_id_fk" FOREIGN KEY ("objective_id") REFERENCES "public"."learning_objectives"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "template_verification_evidence" ADD CONSTRAINT "template_verification_evidence_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "template_verification_evidence" ADD CONSTRAINT "template_verification_evidence_student_user_id_users_id_fk" FOREIGN KEY ("student_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "template_verification_evidence" ADD CONSTRAINT "template_verification_evidence_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."template_verification_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "template_verification_runs" ADD CONSTRAINT "template_verification_runs_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "template_verification_runs" ADD CONSTRAINT "template_verification_runs_evaluated_by_users_id_fk" FOREIGN KEY ("evaluated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "template_verification_runs" ADD CONSTRAINT "template_verification_runs_template_version_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."project_template_versions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "artifact_versions" ADD CONSTRAINT "artifact_versions_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_student_user_id_users_id_fk" FOREIGN KEY ("student_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_template_version_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."project_template_versions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_evidence" ADD CONSTRAINT "project_evidence_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_evidence" ADD CONSTRAINT "project_evidence_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_evidence" ADD CONSTRAINT "project_evidence_student_user_id_users_id_fk" FOREIGN KEY ("student_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_evidence" ADD CONSTRAINT "project_evidence_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pending_questions_idempotency_unique_idx" ON "pending_questions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pending_questions_awaiting_unique_idx" ON "pending_questions" USING btree ("student_user_id","plan_id") WHERE "pending_questions"."status" = 'awaiting';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pending_questions_student_status_idx" ON "pending_questions" USING btree ("student_user_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pending_questions_plan_idx" ON "pending_questions" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pending_questions_session_idx" ON "pending_questions" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pending_questions_objective_idx" ON "pending_questions" USING btree ("objective_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "template_verification_evidence_ref_unique_idx" ON "template_verification_evidence" USING btree ("run_id","check_key","source_kind","source_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "template_verification_evidence_run_idx" ON "template_verification_evidence" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "template_verification_evidence_source_idx" ON "template_verification_evidence" USING btree ("source_kind","source_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "template_verification_evidence_school_idx" ON "template_verification_evidence" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "template_verification_runs_idempotency_unique_idx" ON "template_verification_runs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "template_verification_runs_version_evaluated_idx" ON "template_verification_runs" USING btree ("template_version_id","evaluated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "template_verification_runs_passed_idx" ON "template_verification_runs" USING btree ("passed");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "template_verification_runs_school_idx" ON "template_verification_runs" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "artifact_versions_artifact_ordinal_unique_idx" ON "artifact_versions" USING btree ("artifact_id","ordinal");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artifact_versions_artifact_idx" ON "artifact_versions" USING btree ("artifact_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "artifacts_idempotency_unique_idx" ON "artifacts" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artifacts_student_status_idx" ON "artifacts" USING btree ("student_user_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artifacts_project_idx" ON "artifacts" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artifacts_visibility_idx" ON "artifacts" USING btree ("visibility");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_evidence_fact_unique_idx" ON "project_evidence" USING btree ("project_id","column_kind","source_kind","source_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_evidence_project_column_idx" ON "project_evidence" USING btree ("project_id","column_kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_evidence_student_idx" ON "project_evidence" USING btree ("student_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_evidence_source_idx" ON "project_evidence" USING btree ("source_kind","source_id");