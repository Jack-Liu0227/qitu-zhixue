-- Feishu/Lark administrator reporting bot configuration and QR binding sessions.
CREATE TABLE IF NOT EXISTS "feishu_bots" (
  "id" text PRIMARY KEY NOT NULL,
  "enabled" boolean NOT NULL DEFAULT false,
  "app_id" text,
  "app_secret_encrypted" text,
  "verification_token_encrypted" text,
  "encrypt_key_encrypted" text,
  "domain" text NOT NULL DEFAULT 'feishu',
  "report_assistant_id" text,
  "report_recipients" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "updated_by" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "feishu_qr_sessions" (
  "id" text PRIMARY KEY NOT NULL,
  "bot_id" text NOT NULL REFERENCES "feishu_bots"("id") ON DELETE CASCADE,
  "state" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "bound_open_id" text,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "feishu_qr_sessions_state_idx" ON "feishu_qr_sessions" ("state");
CREATE INDEX IF NOT EXISTS "feishu_qr_sessions_expiry_idx" ON "feishu_qr_sessions" ("expires_at");
