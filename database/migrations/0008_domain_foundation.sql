CREATE TABLE IF NOT EXISTS "growth_records" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" text,
	"student_user_id" text NOT NULL,
	"project_id" text,
	"type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"title" text NOT NULL,
	"summary_student" text NOT NULL,
	"summary_parent" text NOT NULL,
	"stage" text,
	"artifact_ref" text,
	"objective_titles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" text DEFAULT 'server' NOT NULL,
	"visibility" text DEFAULT 'student_private' NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "student_memories" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" text,
	"student_user_id" text NOT NULL,
	"partner_id" text,
	"kind" text NOT NULL,
	"content" text NOT NULL,
	"confidence_basis_points" integer DEFAULT 600 NOT NULL,
	"source" text NOT NULL,
	"visibility" text DEFAULT 'student_private' NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"content" text NOT NULL,
	"token_count" integer,
	"embedding" jsonb,
	"embedding_model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" text,
	"scope" text NOT NULL,
	"owner_user_id" text,
	"project_id" text,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"content" text NOT NULL,
	"source" text NOT NULL,
	"source_ref" text,
	"checksum" text,
	"version" text DEFAULT 'v1' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"verified_by" text,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "learning_modules" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"name" text NOT NULL,
	"week_index" integer NOT NULL,
	"objective" text DEFAULT '' NOT NULL,
	"ordinal" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "learning_objectives" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"module_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"objective" text NOT NULL,
	"prerequisite_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ordinal" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "learning_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" text,
	"student_user_id" text NOT NULL,
	"project_id" text,
	"interest" text NOT NULL,
	"goal" text NOT NULL,
	"weeks" integer NOT NULL,
	"minutes_per_session" integer DEFAULT 60 NOT NULL,
	"template_version_id" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"idempotency_key" text NOT NULL,
	"confirmed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "learning_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"module_id" text NOT NULL,
	"index" integer NOT NULL,
	"blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"theory_objective_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"practice_objective_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mode" text DEFAULT 'study' NOT NULL,
	"scheduled_for" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mastery_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" text,
	"student_user_id" text NOT NULL,
	"objective_id" text NOT NULL,
	"plan_id" text,
	"question_id" text,
	"result" text NOT NULL,
	"is_correct" boolean DEFAULT false NOT NULL,
	"assessment_type" text DEFAULT 'quiz' NOT NULL,
	"error_type" text,
	"hints_used" integer DEFAULT 0 NOT NULL,
	"attempt_count" integer DEFAULT 1 NOT NULL,
	"quality_basis_points" integer,
	"user_answer" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mastery_records" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" text,
	"student_user_id" text NOT NULL,
	"plan_id" text,
	"objective_id" text NOT NULL,
	"knowledge_type" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"mastery_basis_points" integer DEFAULT 0 NOT NULL,
	"threshold_basis_points" integer DEFAULT 9000 NOT NULL,
	"qualitative_mastered" boolean DEFAULT false NOT NULL,
	"consecutive_correct" integer DEFAULT 0 NOT NULL,
	"consecutive_wrong" integer DEFAULT 0 NOT NULL,
	"interval_index" integer DEFAULT 0 NOT NULL,
	"next_review_at" timestamp with time zone,
	"difficulty_basis_points" integer DEFAULT 0 NOT NULL,
	"stability_basis_points" integer DEFAULT 0 NOT NULL,
	"retrievability_basis_points" integer DEFAULT 0 NOT NULL,
	"desired_retention_basis_points" integer DEFAULT 9000 NOT NULL,
	"review_count" integer DEFAULT 0 NOT NULL,
	"lapse_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mentor_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" text,
	"student_user_id" text NOT NULL,
	"mentor_user_id" text NOT NULL,
	"project_id" text,
	"artifact_ref" text,
	"kind" text DEFAULT 'project' NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"decision" text,
	"comment" text,
	"idempotency_key" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_template_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"version" text NOT NULL,
	"stages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rubric" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" text,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"domain" text,
	"age_range" text,
	"difficulty" text,
	"estimated_duration_minutes" integer,
	"required_materials" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"learning_objectives" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"outcome_form" text,
	"safety_notes" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" text,
	"verified_by" text,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "schools" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "school_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "growth_records" ADD CONSTRAINT "growth_records_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "growth_records" ADD CONSTRAINT "growth_records_student_user_id_users_id_fk" FOREIGN KEY ("student_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "growth_records" ADD CONSTRAINT "growth_records_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "student_memories" ADD CONSTRAINT "student_memories_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "student_memories" ADD CONSTRAINT "student_memories_student_user_id_users_id_fk" FOREIGN KEY ("student_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_document_id_knowledge_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "learning_modules" ADD CONSTRAINT "learning_modules_plan_id_learning_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."learning_plans"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "learning_objectives" ADD CONSTRAINT "learning_objectives_plan_id_learning_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."learning_plans"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "learning_objectives" ADD CONSTRAINT "learning_objectives_module_id_learning_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."learning_modules"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "learning_plans" ADD CONSTRAINT "learning_plans_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "learning_plans" ADD CONSTRAINT "learning_plans_student_user_id_users_id_fk" FOREIGN KEY ("student_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "learning_plans" ADD CONSTRAINT "learning_plans_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "learning_plans" ADD CONSTRAINT "learning_plans_template_version_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."project_template_versions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "learning_sessions" ADD CONSTRAINT "learning_sessions_plan_id_learning_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."learning_plans"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "learning_sessions" ADD CONSTRAINT "learning_sessions_module_id_learning_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."learning_modules"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mastery_attempts" ADD CONSTRAINT "mastery_attempts_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mastery_attempts" ADD CONSTRAINT "mastery_attempts_student_user_id_users_id_fk" FOREIGN KEY ("student_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mastery_attempts" ADD CONSTRAINT "mastery_attempts_objective_id_learning_objectives_id_fk" FOREIGN KEY ("objective_id") REFERENCES "public"."learning_objectives"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mastery_attempts" ADD CONSTRAINT "mastery_attempts_plan_id_learning_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."learning_plans"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mastery_records" ADD CONSTRAINT "mastery_records_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mastery_records" ADD CONSTRAINT "mastery_records_student_user_id_users_id_fk" FOREIGN KEY ("student_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mastery_records" ADD CONSTRAINT "mastery_records_plan_id_learning_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."learning_plans"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mastery_records" ADD CONSTRAINT "mastery_records_objective_id_learning_objectives_id_fk" FOREIGN KEY ("objective_id") REFERENCES "public"."learning_objectives"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mentor_reviews" ADD CONSTRAINT "mentor_reviews_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mentor_reviews" ADD CONSTRAINT "mentor_reviews_student_user_id_users_id_fk" FOREIGN KEY ("student_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mentor_reviews" ADD CONSTRAINT "mentor_reviews_mentor_user_id_users_id_fk" FOREIGN KEY ("mentor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mentor_reviews" ADD CONSTRAINT "mentor_reviews_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_template_versions" ADD CONSTRAINT "project_template_versions_template_id_project_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."project_templates"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_template_versions" ADD CONSTRAINT "project_template_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_templates" ADD CONSTRAINT "project_templates_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_templates" ADD CONSTRAINT "project_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_templates" ADD CONSTRAINT "project_templates_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "growth_records_idempotency_unique_idx" ON "growth_records" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "growth_records_student_occurred_idx" ON "growth_records" USING btree ("student_user_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "growth_records_project_idx" ON "growth_records" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "growth_records_type_idx" ON "growth_records" USING btree ("type");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "student_memories_idempotency_unique_idx" ON "student_memories" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "student_memories_student_idx" ON "student_memories" USING btree ("student_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "student_memories_updated_idx" ON "student_memories" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_chunks_document_ordinal_unique_idx" ON "knowledge_chunks" USING btree ("document_id","ordinal");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_chunks_document_idx" ON "knowledge_chunks" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_documents_scope_idx" ON "knowledge_documents" USING btree ("school_id","scope");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_documents_project_idx" ON "knowledge_documents" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_documents_owner_idx" ON "knowledge_documents" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_documents_status_idx" ON "knowledge_documents" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "learning_modules_plan_ordinal_unique_idx" ON "learning_modules" USING btree ("plan_id","ordinal");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "learning_modules_plan_idx" ON "learning_modules" USING btree ("plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "learning_objectives_module_ordinal_unique_idx" ON "learning_objectives" USING btree ("module_id","ordinal");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "learning_objectives_module_idx" ON "learning_objectives" USING btree ("module_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "learning_plans_idempotency_unique_idx" ON "learning_plans" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "learning_plans_student_status_idx" ON "learning_plans" USING btree ("student_user_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "learning_plans_project_idx" ON "learning_plans" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "learning_sessions_plan_index_unique_idx" ON "learning_sessions" USING btree ("plan_id","index");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "learning_sessions_module_idx" ON "learning_sessions" USING btree ("module_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mastery_attempts_student_objective_idx" ON "mastery_attempts" USING btree ("student_user_id","objective_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mastery_attempts_student_created_idx" ON "mastery_attempts" USING btree ("student_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mastery_records_student_objective_unique_idx" ON "mastery_records" USING btree ("student_user_id","objective_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mastery_records_student_status_idx" ON "mastery_records" USING btree ("student_user_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mastery_records_next_review_idx" ON "mastery_records" USING btree ("next_review_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mentor_reviews_idempotency_unique_idx" ON "mentor_reviews" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mentor_reviews_mentor_status_idx" ON "mentor_reviews" USING btree ("mentor_user_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mentor_reviews_student_idx" ON "mentor_reviews" USING btree ("student_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mentor_reviews_project_idx" ON "mentor_reviews" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_template_versions_template_version_unique_idx" ON "project_template_versions" USING btree ("template_id","version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_template_versions_template_idx" ON "project_template_versions" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_template_versions_status_idx" ON "project_template_versions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_templates_platform_slug_unique_idx" ON "project_templates" USING btree ("slug") WHERE "project_templates"."school_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_templates_school_slug_unique_idx" ON "project_templates" USING btree ("school_id","slug") WHERE "project_templates"."school_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_templates_school_idx" ON "project_templates" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_templates_status_idx" ON "project_templates" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "schools_code_unique_idx" ON "schools" USING btree ("code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "schools_status_idx" ON "schools" USING btree ("status");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users" ADD CONSTRAINT "users_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "exploration_sessions" ADD CONSTRAINT "exploration_sessions_template_version_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."project_template_versions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "projects" ADD CONSTRAINT "projects_template_version_id_project_template_versions_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."project_template_versions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_school_idx" ON "users" USING btree ("school_id");