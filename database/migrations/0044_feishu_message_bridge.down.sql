DROP TABLE IF EXISTS "feishu_inbox";
ALTER TABLE "feishu_report_deliveries" DROP COLUMN IF EXISTS "lease_id";
ALTER TABLE "feishu_report_deliveries" DROP COLUMN IF EXISTS "completed_recipient_hashes";
ALTER TABLE "feishu_bots" DROP COLUMN IF EXISTS "inbound_enabled";
