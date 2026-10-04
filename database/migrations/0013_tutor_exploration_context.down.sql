DROP INDEX IF EXISTS "tutor_sessions_exploration_unique_idx";
DROP INDEX IF EXISTS "tutor_sessions_project_unique_idx";
DROP INDEX IF EXISTS "tutor_sessions_exploration_idx";
ALTER TABLE "tutor_sessions" DROP CONSTRAINT IF EXISTS "tutor_sessions_exploration_id_exploration_sessions_id_fk";
ALTER TABLE "tutor_sessions" DROP COLUMN IF EXISTS "exploration_id";
