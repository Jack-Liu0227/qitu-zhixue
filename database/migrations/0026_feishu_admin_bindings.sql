-- Explicitly map a Feishu/Lark channel identity to the authenticated Qitu admin
-- who completed the device flow. open_id itself is never treated as a Qitu identity.
CREATE TABLE IF NOT EXISTS "feishu_admin_bindings" (
  "id" text PRIMARY KEY NOT NULL,
  "assistant_id" text NOT NULL,
  "open_id_hash" text NOT NULL,
  "admin_user_id" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "feishu_admin_bindings_channel_identity_unique_idx" ON "feishu_admin_bindings" ("assistant_id", "open_id_hash");
CREATE UNIQUE INDEX IF NOT EXISTS "feishu_admin_bindings_admin_assistant_unique_idx" ON "feishu_admin_bindings" ("assistant_id", "admin_user_id");
