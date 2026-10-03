ALTER TABLE "mastery_records"
  ADD COLUMN IF NOT EXISTS "knowledge_point_id" text,
  ADD COLUMN IF NOT EXISTS "course_version" text,
  ADD COLUMN IF NOT EXISTS "source_event_id" text,
  ADD COLUMN IF NOT EXISTS "source_sequence" integer,
  ADD COLUMN IF NOT EXISTS "assessment_version" text,
  ADD COLUMN IF NOT EXISTS "valid_from" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mastery_records_student_knowledge_point_idx"
  ON "mastery_records" USING btree ("student_user_id", "knowledge_point_id", "course_version");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mastery_events" (
  "id" text PRIMARY KEY NOT NULL,
  "school_id" text,
  "student_user_id" text NOT NULL,
  "knowledge_point_id" text NOT NULL,
  "course_version" text NOT NULL,
  "objective_id" text,
  "plan_id" text,
  "project_id" text,
  "event_type" text NOT NULL,
  "knowledge_type" text NOT NULL,
  "score_basis_points" integer,
  "confidence_basis_points" integer,
  "qualitative_mastered" boolean,
  "valid_from" timestamp with time zone NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
  "sequence" integer NOT NULL,
  "evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "source_type" text NOT NULL,
  "source_event_id" text NOT NULL,
  "causation_id" text,
  "correlation_id" text,
  "supersedes_event_id" text,
  "assessment_version" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mastery_events_idempotency_unique_idx"
  ON "mastery_events" USING btree ("idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mastery_events_aggregate_sequence_unique_idx"
  ON "mastery_events" USING btree ("student_user_id", "knowledge_point_id", "course_version", "sequence");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mastery_events_aggregate_idx"
  ON "mastery_events" USING btree ("student_user_id", "knowledge_point_id", "course_version", "valid_from");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mastery_events_known_at_idx"
  ON "mastery_events" USING btree ("student_user_id", "recorded_at");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mastery_events" ADD CONSTRAINT "mastery_events_school_id_schools_id_fk"
   FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mastery_events" ADD CONSTRAINT "mastery_events_student_user_id_users_id_fk"
   FOREIGN KEY ("student_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mastery_events" ADD CONSTRAINT "mastery_events_objective_id_learning_objectives_id_fk"
   FOREIGN KEY ("objective_id") REFERENCES "public"."learning_objectives"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mastery_events" ADD CONSTRAINT "mastery_events_plan_id_learning_plans_id_fk"
   FOREIGN KEY ("plan_id") REFERENCES "public"."learning_plans"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mastery_events" ADD CONSTRAINT "mastery_events_project_id_projects_id_fk"
   FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mastery_objective_mappings" (
  "id" text PRIMARY KEY NOT NULL,
  "school_id" text,
  "plan_id" text NOT NULL,
  "objective_id" text NOT NULL,
  "template_version" text NOT NULL,
  "content_version" text NOT NULL,
  "knowledge_point_id" text NOT NULL,
  "course_version" text NOT NULL,
  "source" text DEFAULT 'explicit' NOT NULL,
  "mapped_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mastery_objective_mapping_unique_idx"
  ON "mastery_objective_mappings" USING btree ("plan_id", "objective_id", "template_version", "content_version");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mastery_objective_mapping_kp_idx"
  ON "mastery_objective_mappings" USING btree ("knowledge_point_id", "course_version");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mastery_objective_mappings" ADD CONSTRAINT "mastery_mapping_school_id_schools_id_fk"
   FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mastery_objective_mappings" ADD CONSTRAINT "mastery_mapping_plan_id_learning_plans_id_fk"
   FOREIGN KEY ("plan_id") REFERENCES "public"."learning_plans"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mastery_objective_mappings" ADD CONSTRAINT "mastery_mapping_objective_id_learning_objectives_id_fk"
   FOREIGN KEY ("objective_id") REFERENCES "public"."learning_objectives"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
