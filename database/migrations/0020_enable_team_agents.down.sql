-- Restore the seeded pre-review state. No student or conversation data is
-- stored in agent_configs.
UPDATE "agent_configs"
SET
  "enabled" = false,
  "model_provider_id" = NULL,
  "model_id" = NULL,
  "updated_at" = now()
WHERE "id" IN (
  'interest-confirmation',
  'pbl-orchestrator',
  'project-recommender',
  'learner-profile',
  'growth-analyst'
);

