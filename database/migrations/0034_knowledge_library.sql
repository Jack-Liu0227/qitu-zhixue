ALTER TABLE knowledge_bases ADD COLUMN IF NOT EXISTS library_settings jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE TABLE IF NOT EXISTS knowledge_remote_evidence (
 id text PRIMARY KEY, kb_id text NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
 assistant_id text NOT NULL, fingerprint text NOT NULL, title text NOT NULL, content text NOT NULL,
 origin jsonb NOT NULL DEFAULT '{}'::jsonb, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS knowledge_remote_evidence_expiry_idx ON knowledge_remote_evidence(expires_at);
