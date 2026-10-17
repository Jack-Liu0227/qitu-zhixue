CREATE TABLE IF NOT EXISTS knowledge_file_originals (
  member_id text PRIMARY KEY REFERENCES knowledge_base_members(id),
  file_name text NOT NULL,
  mime_type text NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size > 0 AND byte_size <= 10485760),
  checksum text NOT NULL,
  body bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (octet_length(body) = byte_size)
);
