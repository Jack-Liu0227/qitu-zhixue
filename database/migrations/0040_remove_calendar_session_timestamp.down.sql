-- Rollback only for local migration tooling; production remains lesson-first.
ALTER TABLE learning_sessions ADD COLUMN IF NOT EXISTS scheduled_for timestamp with time zone;
