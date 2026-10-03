DROP TABLE IF EXISTS "mastery_objective_mappings";
DROP TABLE IF EXISTS "mastery_events";
DROP INDEX IF EXISTS "mastery_records_student_knowledge_point_idx";
ALTER TABLE "mastery_records"
  DROP COLUMN IF EXISTS "knowledge_point_id",
  DROP COLUMN IF EXISTS "course_version",
  DROP COLUMN IF EXISTS "source_event_id",
  DROP COLUMN IF EXISTS "source_sequence",
  DROP COLUMN IF EXISTS "assessment_version",
  DROP COLUMN IF EXISTS "valid_from";
