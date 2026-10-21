CREATE TABLE learning_session_progress (
  id text PRIMARY KEY,
  student_user_id text NOT NULL REFERENCES users(id),
  project_id text NOT NULL REFERENCES projects(id),
  plan_id text NOT NULL REFERENCES learning_plans(id) ON DELETE CASCADE,
  plan_revision integer NOT NULL CHECK (plan_revision > 0),
  learning_session_id text NOT NULL REFERENCES learning_sessions(id) ON DELETE CASCADE,
  evidence_refs jsonb NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  completed_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX learning_session_progress_session_revision_unique ON learning_session_progress (plan_id, plan_revision, learning_session_id);
CREATE UNIQUE INDEX learning_session_progress_key_unique ON learning_session_progress (idempotency_key);
