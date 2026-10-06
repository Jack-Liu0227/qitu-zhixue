ALTER TABLE "agent_configs"
  ADD COLUMN IF NOT EXISTS "model_provider_id" text,
  ADD COLUMN IF NOT EXISTS "model_id" text;

-- Existing agents inherit the model that was previously selected for tutor.chat.
UPDATE "agent_configs" AS agent
SET "model_provider_id" = binding."provider_id",
    "model_id" = binding."model_id"
FROM "model_usage_bindings" AS binding
WHERE binding."usage_id" = agent."model_usage"
  AND agent."model_provider_id" IS NULL
  AND agent."model_id" IS NULL;

CREATE INDEX IF NOT EXISTS "agent_configs_model_idx"
  ON "agent_configs" ("model_provider_id", "model_id");
