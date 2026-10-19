DO $$
DECLARE
  has_plan_columns boolean;
  has_module_column boolean;
  has_data boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'learning_plans' AND column_name = 'lesson_count'
  ) INTO has_plan_columns;
  IF has_plan_columns THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM learning_plans WHERE weeks IS NULL OR lesson_count IS NOT NULL OR lesson_minutes IS NOT NULL)'
      INTO has_data;
    IF has_data THEN
      RAISE EXCEPTION 'Cannot roll back lesson-first schedules without losing lesson data or inventing weeks';
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'learning_modules' AND column_name = 'lesson_index'
  ) INTO has_module_column;
  IF has_module_column THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM learning_modules WHERE week_index IS NULL OR lesson_index IS NOT NULL)'
      INTO has_data;
    IF has_data THEN
      RAISE EXCEPTION 'Cannot roll back lesson-first schedules without losing lesson data or inventing weeks';
    END IF;
  END IF;
END $$;

ALTER TABLE learning_modules DROP CONSTRAINT IF EXISTS learning_modules_placement_check;
ALTER TABLE learning_plans DROP CONSTRAINT IF EXISTS learning_plans_schedule_shape_check;
ALTER TABLE learning_sessions DROP COLUMN IF EXISTS lesson_index;
ALTER TABLE learning_modules DROP COLUMN IF EXISTS lesson_index;
ALTER TABLE learning_modules ALTER COLUMN week_index SET NOT NULL;
ALTER TABLE learning_plans DROP COLUMN IF EXISTS lesson_minutes;
ALTER TABLE learning_plans DROP COLUMN IF EXISTS lesson_count;
ALTER TABLE learning_plans ALTER COLUMN weeks SET NOT NULL;
