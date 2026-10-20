-- Lesson-first schedules do not persist a calendar placement on sessions.
ALTER TABLE learning_sessions DROP COLUMN IF EXISTS scheduled_for;
