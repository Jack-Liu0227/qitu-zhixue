CREATE TABLE IF NOT EXISTS "idempotency_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
-- Backward-compatible additive column (nullable); replay-safe with IF NOT EXISTS.
ALTER TABLE "outbox" ADD COLUMN IF NOT EXISTS "last_error" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idempotency_keys_scope_key_idx" ON "idempotency_keys" USING btree ("scope","key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idempotency_keys_expires_at_idx" ON "idempotency_keys" USING btree ("expires_at");
