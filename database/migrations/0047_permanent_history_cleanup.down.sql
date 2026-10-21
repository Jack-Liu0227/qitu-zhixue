-- Schema rollback is safe only before permanent deletion has been used.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM answer_attempts WHERE tutor_session_id IS NULL)
    OR EXISTS (SELECT 1 FROM projects WHERE tutor_conversation_generation > 0) THEN
    RAISE EXCEPTION 'Permanent history cleanup has been used; retain the compatible schema.';
  END IF;
END $$;
ALTER TABLE projects DROP COLUMN tutor_conversation_generation;
ALTER TABLE answer_attempts DROP CONSTRAINT answer_attempts_tutor_session_id_fkey;
ALTER TABLE answer_attempts ALTER COLUMN tutor_session_id SET NOT NULL;
ALTER TABLE answer_attempts ADD CONSTRAINT answer_attempts_tutor_session_id_fkey
  FOREIGN KEY (tutor_session_id) REFERENCES tutor_sessions(id) ON DELETE RESTRICT;
