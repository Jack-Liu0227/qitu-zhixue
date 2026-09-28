CREATE TABLE IF NOT EXISTS "feedback_ticket_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"seq" integer NOT NULL,
	"kind" text NOT NULL,
	"author_role" text NOT NULL,
	"author_id" text NOT NULL,
	"author_display_name" text NOT NULL,
	"content" text NOT NULL,
	"attachment_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"resolved" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "feedback_tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"child_user_id" text,
	"parent_user_id" text NOT NULL,
	"source" text NOT NULL,
	"project_id" text,
	"project_title" text,
	"message_id" text,
	"status" text NOT NULL,
	"problem" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "feedback_ticket_entries" ADD CONSTRAINT "feedback_ticket_entries_ticket_id_feedback_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."feedback_tickets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "feedback_tickets" ADD CONSTRAINT "feedback_tickets_child_user_id_users_id_fk" FOREIGN KEY ("child_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "feedback_tickets" ADD CONSTRAINT "feedback_tickets_parent_user_id_users_id_fk" FOREIGN KEY ("parent_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "feedback_ticket_entries_ticket_seq_unique_idx" ON "feedback_ticket_entries" USING btree ("ticket_id","seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feedback_ticket_entries_ticket_idx" ON "feedback_ticket_entries" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feedback_tickets_child_idx" ON "feedback_tickets" USING btree ("child_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feedback_tickets_parent_idx" ON "feedback_tickets" USING btree ("parent_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feedback_tickets_status_idx" ON "feedback_tickets" USING btree ("status");