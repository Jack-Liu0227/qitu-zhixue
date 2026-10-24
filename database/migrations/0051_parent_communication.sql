CREATE TABLE IF NOT EXISTS parent_message_receipts (
  id text PRIMARY KEY,
  parent_id text NOT NULL REFERENCES users(id),
  child_id text NOT NULL REFERENCES users(id),
  message_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('read', 'mute')),
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS parent_message_receipts_key_unique ON parent_message_receipts(parent_id, idempotency_key);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS parent_message_receipts_scope_idx ON parent_message_receipts(parent_id, child_id, message_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS parent_encouragements (
  id text PRIMARY KEY,
  parent_id text NOT NULL REFERENCES users(id),
  child_id text NOT NULL REFERENCES users(id),
  message text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 200),
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS parent_encouragements_key_unique ON parent_encouragements(parent_id, idempotency_key);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS parent_encouragements_inbox_idx ON parent_encouragements(child_id, created_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS teacher_support_receipts (
  evidence_id text PRIMARY KEY REFERENCES project_evidence(id) ON DELETE CASCADE,
  teacher_id text NOT NULL REFERENCES users(id),
  status text NOT NULL CHECK (status IN ('acknowledged', 'resolved')),
  note text CHECK (char_length(note) <= 1000),
  updated_at timestamptz NOT NULL DEFAULT now()
);
