-- Rollback is intentionally blocked: restoring weeks would invent calendar data.
DO $$ BEGIN
  RAISE EXCEPTION 'Cannot roll back lesson-only schedules without inventing weeks';
END $$;
