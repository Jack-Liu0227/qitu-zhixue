-- Convert legacy calendar records to an ordered lesson grid before deleting
-- the calendar columns. This uses the stored session order, never inferred weeks.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM learning_plans p
    WHERE p.weeks IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM learning_sessions s WHERE s.plan_id = p.id)
  ) THEN
    RAISE EXCEPTION 'Cannot migrate a weekly learning plan without stored sessions';
  END IF;

  IF EXISTS (
    SELECT 1 FROM learning_plans p
    WHERE p.weeks IS NOT NULL AND p.minutes_per_session NOT IN (60, 120)
  ) THEN
    RAISE EXCEPTION 'Weekly learning plan has unsupported lesson duration';
  END IF;
END $$;

CREATE TEMP TABLE _lesson_module_map AS
SELECT
  s.id AS session_id,
  s.plan_id,
  s.module_id AS old_module_id,
  s.index AS session_index,
  CASE WHEN row_number() OVER (PARTITION BY s.module_id ORDER BY s.index, s.id) = 1
       THEN s.module_id
       ELSE s.module_id || ':lesson:' || (s.index + 1)::text
  END AS new_module_id,
  m.name AS module_name,
  m.objective AS module_objective,
  row_number() OVER (PARTITION BY s.module_id ORDER BY s.index, s.id) AS module_rank,
  max(m.ordinal) OVER (PARTITION BY p.id)
    + row_number() OVER (PARTITION BY p.id ORDER BY s.index, s.id) AS temporary_ordinal
FROM learning_sessions s
JOIN learning_plans p ON p.id = s.plan_id AND p.weeks IS NOT NULL
JOIN learning_modules m ON m.id = s.module_id;

CREATE TEMP TABLE _lesson_objective_module_map AS
SELECT
  m.id AS old_module_id,
  coalesce(own.new_module_id, first_lesson.new_module_id) AS new_module_id
FROM learning_modules m
JOIN learning_plans p ON p.id = m.plan_id AND p.weeks IS NOT NULL
JOIN LATERAL (
  SELECT mapping.new_module_id
  FROM _lesson_module_map mapping
  WHERE mapping.plan_id = p.id
  ORDER BY mapping.session_index, mapping.session_id
  LIMIT 1
) first_lesson ON true
LEFT JOIN LATERAL (
  SELECT mapping.new_module_id
  FROM _lesson_module_map mapping
  WHERE mapping.old_module_id = m.id AND mapping.module_rank = 1
  LIMIT 1
) own ON true;

INSERT INTO learning_modules (id, plan_id, name, lesson_index, objective, ordinal)
SELECT
  new_module_id,
  plan_id,
  module_name || ' - Lesson ' || (session_index + 1)::text,
  session_index + 1,
  module_objective,
  temporary_ordinal
FROM _lesson_module_map
WHERE new_module_id <> old_module_id;

-- Reuse the original module for its first lesson so historical objective/answer
-- references remain valid; later lessons receive the inserted module rows.
UPDATE learning_modules m
SET name = mapping.module_name || ' - Lesson ' || (mapping.session_index + 1)::text,
    week_index = NULL,
    lesson_index = mapping.session_index + 1,
    objective = mapping.module_objective,
    ordinal = mapping.temporary_ordinal
FROM _lesson_module_map mapping
WHERE m.id = mapping.old_module_id
  AND mapping.new_module_id = mapping.old_module_id;

UPDATE learning_objectives o
SET module_id = mapping.new_module_id
FROM _lesson_objective_module_map mapping
WHERE o.module_id = mapping.old_module_id;

UPDATE learning_sessions s
SET module_id = mapping.new_module_id,
    lesson_index = mapping.session_index + 1
FROM _lesson_module_map mapping
WHERE s.id = mapping.session_id;

-- Remove only legacy modules that no longer carry objectives. Modules with
-- historical answer references remain valid because their objectives are kept.
DELETE FROM learning_modules m
USING learning_plans p
WHERE p.id = m.plan_id
  AND p.weeks IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM _lesson_module_map mapping WHERE mapping.old_module_id = m.id)
  AND NOT EXISTS (SELECT 1 FROM learning_objectives o WHERE o.module_id = m.id);

UPDATE learning_modules m
SET ordinal = mapping.session_index + 1
FROM _lesson_module_map mapping
WHERE m.id = mapping.new_module_id;

UPDATE learning_plans p
SET lesson_count = lessons.lesson_count,
    lesson_minutes = p.minutes_per_session
FROM (
  SELECT plan_id, count(*)::integer AS lesson_count
  FROM learning_sessions
  GROUP BY plan_id
) lessons
WHERE p.id = lessons.plan_id AND p.weeks IS NOT NULL;

ALTER TABLE learning_plans DROP CONSTRAINT IF EXISTS learning_plans_schedule_shape_check;
ALTER TABLE learning_modules DROP CONSTRAINT IF EXISTS learning_modules_placement_check;
ALTER TABLE learning_plans DROP COLUMN weeks;
ALTER TABLE learning_modules DROP COLUMN week_index;

ALTER TABLE learning_plans
  ALTER COLUMN lesson_count SET NOT NULL,
  ALTER COLUMN lesson_minutes SET NOT NULL;
ALTER TABLE learning_plans
  ADD CONSTRAINT learning_plans_lesson_schedule_check
  CHECK (lesson_count BETWEEN 1 AND 128 AND lesson_minutes IN (60, 120) AND minutes_per_session = lesson_minutes);

ALTER TABLE learning_modules
  ALTER COLUMN lesson_index SET NOT NULL;
ALTER TABLE learning_modules
  ADD CONSTRAINT learning_modules_lesson_index_check CHECK (lesson_index > 0);

ALTER TABLE learning_sessions
  ALTER COLUMN lesson_index SET NOT NULL;
ALTER TABLE learning_sessions
  ADD CONSTRAINT learning_sessions_lesson_index_check CHECK (lesson_index > 0);

DROP TABLE _lesson_objective_module_map;
DROP TABLE _lesson_module_map;
