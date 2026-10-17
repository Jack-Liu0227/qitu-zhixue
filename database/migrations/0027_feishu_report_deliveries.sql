-- Durable delivery ledger for Feishu report idempotency across worker restarts.
CREATE TABLE IF NOT EXISTS "feishu_report_deliveries" (
  "id" text PRIMARY KEY NOT NULL,
  "assistant_id" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "recipient_hashes" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "request_id" text,
  "attempts" integer NOT NULL DEFAULT 0,
  "last_error" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "sent_at" timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "feishu_report_deliveries_assistant_key_unique_idx"
  ON "feishu_report_deliveries" ("assistant_id", "idempotency_key");
CREATE INDEX IF NOT EXISTS "feishu_report_deliveries_status_idx"
  ON "feishu_report_deliveries" ("status");
