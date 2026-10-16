DROP INDEX IF EXISTS "feishu_bots_assistant_unique_idx";
ALTER TABLE "feishu_qr_sessions" DROP COLUMN IF EXISTS "created_by";
ALTER TABLE "feishu_qr_sessions" DROP COLUMN IF EXISTS "poll_interval_seconds";
ALTER TABLE "feishu_qr_sessions" DROP COLUMN IF EXISTS "device_code_encrypted";
ALTER TABLE "feishu_qr_sessions" DROP COLUMN IF EXISTS "bound_admin_id";
ALTER TABLE "feishu_bots" DROP COLUMN IF EXISTS "assistant_id";
