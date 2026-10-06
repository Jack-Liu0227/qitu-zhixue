DROP INDEX IF EXISTS "agent_configs_model_idx";
ALTER TABLE "agent_configs"
  DROP COLUMN IF EXISTS "model_provider_id",
  DROP COLUMN IF EXISTS "model_id";
