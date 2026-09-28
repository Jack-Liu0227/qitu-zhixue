CREATE TABLE IF NOT EXISTS "user_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"font_size" text DEFAULT 'md' NOT NULL,
	"theme" text DEFAULT 'default' NOT NULL,
	"reduced_motion" boolean DEFAULT false NOT NULL,
	"notifications" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
