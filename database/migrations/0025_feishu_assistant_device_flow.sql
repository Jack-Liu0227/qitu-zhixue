ALTER TABLE "feishu_bots" ADD COLUMN IF NOT EXISTS "assistant_id" text;
UPDATE "feishu_bots" SET "assistant_id" = COALESCE("report_assistant_id", 'feishu-reporting-assistant') WHERE "assistant_id" IS NULL;
ALTER TABLE "feishu_bots" ALTER COLUMN "assistant_id" SET DEFAULT 'feishu-reporting-assistant';
ALTER TABLE "feishu_bots" ALTER COLUMN "assistant_id" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "feishu_bots_assistant_unique_idx" ON "feishu_bots" ("assistant_id");
ALTER TABLE "feishu_qr_sessions" ADD COLUMN IF NOT EXISTS "bound_admin_id" text;
ALTER TABLE "feishu_qr_sessions" ADD COLUMN IF NOT EXISTS "device_code_encrypted" text;
ALTER TABLE "feishu_qr_sessions" ADD COLUMN IF NOT EXISTS "poll_interval_seconds" integer NOT NULL DEFAULT 5;
ALTER TABLE "feishu_qr_sessions" ADD COLUMN IF NOT EXISTS "created_by" text;

