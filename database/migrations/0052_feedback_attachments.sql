CREATE TABLE IF NOT EXISTS feedback_attachments (
  id text PRIMARY KEY,
  owner_user_id text NOT NULL REFERENCES users(id),
  child_user_id text NOT NULL REFERENCES users(id),
  ticket_id text REFERENCES feedback_tickets(id),
  file_name text NOT NULL, content_type text NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 2097152),
  content_hash text NOT NULL, request_hash text NOT NULL, idempotency_key text NOT NULL,
  bytes bytea NOT NULL CHECK (octet_length(bytes) = size_bytes),
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS feedback_attachments_owner_key_idx ON feedback_attachments(owner_user_id,idempotency_key);
CREATE INDEX IF NOT EXISTS feedback_attachments_owner_idx ON feedback_attachments(owner_user_id);
CREATE INDEX IF NOT EXISTS feedback_attachments_ticket_idx ON feedback_attachments(ticket_id);
