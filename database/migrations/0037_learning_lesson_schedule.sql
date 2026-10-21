-- Add explicit lesson-first schedule fields while preserving legacy weekly rows.
ALTER TABLE learning_plans ALTER COLUMN weeks DROP NOT NULL;
ALTER TABLE learning_plans ADD COLUMN lesson_count integer;
ALTER TABLE learning_plans ADD COLUMN lesson_minutes integer;
ALTER TABLE learning_modules ALTER COLUMN week_index DROP NOT NULL;
ALTER TABLE learning_modules ADD COLUMN lesson_index integer;
ALTER TABLE learning_sessions ADD COLUMN lesson_index integer;

ALTER TABLE learning_plans
  ADD CONSTRAINT learning_plans_schedule_shape_check
  CHECK (
    (weeks IS NOT NULL AND lesson_count IS NULL AND lesson_minutes IS NULL)
    OR (
      weeks IS NULL
      AND lesson_count IS NOT NULL
      AND lesson_count BETWEEN 1 AND 128
      AND lesson_minutes IS NOT NULL
      AND lesson_minutes IN (60, 120)
      AND minutes_per_session = lesson_minutes
    )
  );

ALTER TABLE learning_modules
  ADD CONSTRAINT learning_modules_placement_check
  CHECK (
    (week_index IS NOT NULL AND lesson_index IS NULL)
    OR (week_index IS NULL AND lesson_index IS NOT NULL AND lesson_index > 0)
  );
