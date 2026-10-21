-- Conversation deletion removes text and sessions while preserving assessment facts.
ALTER TABLE answer_attempts DROP CONSTRAINT answer_attempts_tutor_session_id_fkey;
ALTER TABLE answer_attempts ALTER COLUMN tutor_session_id DROP NOT NULL;
ALTER TABLE answer_attempts ADD CONSTRAINT answer_attempts_tutor_session_id_fkey
  FOREIGN KEY (tutor_session_id) REFERENCES tutor_sessions(id) ON DELETE SET NULL;
-- A new conversation must never reuse deleted turn IDs or stale in-flight requests.
ALTER TABLE projects ADD COLUMN tutor_conversation_generation integer NOT NULL DEFAULT 0;
