CREATE TABLE IF NOT EXISTS "parent_growth_exports" (
	"id" text PRIMARY KEY NOT NULL,
	"parent_user_id" text NOT NULL,
	"child_user_id" text NOT NULL,
	"child_display_name" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text NOT NULL,
	"document" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ready_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"downloaded_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "parent_growth_exports" ADD CONSTRAINT "parent_growth_exports_parent_user_id_users_id_fk" FOREIGN KEY ("parent_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "parent_growth_exports" ADD CONSTRAINT "parent_growth_exports_child_user_id_users_id_fk" FOREIGN KEY ("child_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "parent_growth_exports_parent_idx" ON "parent_growth_exports" USING btree ("parent_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "parent_growth_exports_child_idx" ON "parent_growth_exports" USING btree ("child_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "parent_growth_exports_expires_at_idx" ON "parent_growth_exports" USING btree ("expires_at");