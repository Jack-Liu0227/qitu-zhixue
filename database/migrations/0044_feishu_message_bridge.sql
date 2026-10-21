-- Assistant-scoped long connections and durable, minimized message processing.
ALTER TABLE "feishu_bots" ADD COLUMN IF NOT EXISTS "inbound_enabled" boolean NOT NULL DEFAULT false;
UPDATE "feishu_bots" SET "inbound_enabled" = true
WHERE "assistant_id" = 'feishu-reporting-assistant' AND "enabled" = true;
ALTER TABLE "feishu_report_deliveries" ADD COLUMN IF NOT EXISTS "completed_recipient_hashes" jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "feishu_report_deliveries" ADD COLUMN IF NOT EXISTS "lease_id" text;
CREATE TABLE IF NOT EXISTS "feishu_inbox" (
  "id" text PRIMARY KEY NOT NULL,
  "assistant_id" text NOT NULL,
  "app_id" text NOT NULL,
  "sender_hash" text NOT NULL,
  "command" text NOT NULL CHECK ("command" IN ('report', 'help')),
  "status" text NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'processing', 'retryable', 'sent', 'failed')),
  "attempts" integer NOT NULL DEFAULT 0,
  "lease_id" text,
  "last_error" text,
  "reply_message_id" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "feishu_inbox_status_idx" ON "feishu_inbox" ("status", "updated_at");
