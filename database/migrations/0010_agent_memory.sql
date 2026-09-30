CREATE TABLE IF NOT EXISTS "agent_memory_records" (
  "id" text PRIMARY KEY NOT NULL,
  "student_id" text,
  "partner_id" text NOT NULL,
  "scope" text NOT NULL,
  "kind" text NOT NULL,
  "content" text NOT NULL,
  "source_ref" text NOT NULL,
  "source_event_id" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "expires_at" timestamp with time zone,
  "index_backend" text,
  "index_id" text,
  "index_status" text DEFAULT 'pending' NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_memory_relation_idx" ON "agent_memory_records" USING btree ("student_id", "partner_id", "status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_memory_source_unique_idx" ON "agent_memory_records" USING btree ("source_event_id", "version");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_memory_index_status_idx" ON "agent_memory_records" USING btree ("index_status");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_memory_records" ADD CONSTRAINT "agent_memory_records_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
