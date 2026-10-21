DROP INDEX IF EXISTS "agent_projection_candidates_review_idx";
ALTER TABLE "agent_projection_candidates"
  DROP COLUMN IF EXISTS "superseded_by_candidate_id",
  DROP COLUMN IF EXISTS "review_error_code";
