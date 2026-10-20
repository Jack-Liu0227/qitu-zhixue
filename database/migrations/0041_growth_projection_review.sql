ALTER TABLE "agent_projection_candidates"
  ADD COLUMN IF NOT EXISTS "review_error_code" text,
  ADD COLUMN IF NOT EXISTS "superseded_by_candidate_id" text;

CREATE INDEX IF NOT EXISTS "agent_projection_candidates_review_idx"
  ON "agent_projection_candidates" ("student_user_id", "projection_type", "status", "created_at");
