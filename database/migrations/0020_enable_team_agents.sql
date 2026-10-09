-- Enable the built-in Team Runtime children after their direct model binding
-- has been reviewed. The provider/model pair is the same one verified by the
-- admin model test endpoint and contains no credential material in the repo.
UPDATE "agent_configs"
SET
  "enabled" = true,
  "model_provider_id" = 'qwen-token-plan-cn',
  "model_id" = 'qwen3.8-flash',
  "updated_at" = now()
WHERE "id" IN (
  'interest-confirmation',
  'pbl-orchestrator',
  'project-recommender',
  'learner-profile',
  'growth-analyst'
);

