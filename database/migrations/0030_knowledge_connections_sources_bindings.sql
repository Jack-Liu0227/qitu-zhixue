BEGIN;

CREATE TABLE knowledge_base_connections (
  id text PRIMARY KEY,
  kb_id text NOT NULL UNIQUE REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  flavour text NOT NULL CHECK (flavour IN ('obsidian','linked','subagent','lightrag_server','ima','weknora','marginnote4','kiwix')),
  provider text NOT NULL,
  external_ref jsonb NOT NULL DEFAULT '{}'::jsonb,
  credential_ref text,
  status text NOT NULL CHECK (status IN ('unconfigured','probing','ready','stale','unreachable','unauthorized','revoked','unsupported','error')),
  last_check_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX knowledge_base_connections_provider_idx ON knowledge_base_connections(provider,status);

CREATE TABLE knowledge_sources (
  id text PRIMARY KEY,
  kb_id text NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('folder','github','web')),
  source_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  credential_ref text,
  schedule_hours integer CHECK (schedule_hours IS NULL OR (schedule_hours BETWEEN 1 AND 168)),
  next_sync_at timestamptz,
  last_sync_at timestamptz,
  last_source_revision text,
  status text NOT NULL CHECK (status IN ('active','paused','syncing','stale','failed','revoked')),
  last_error_code text,
  created_by text NOT NULL,
  source_fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX knowledge_sources_kb_kind_fingerprint_idx ON knowledge_sources(kb_id,kind,source_fingerprint);
CREATE INDEX knowledge_sources_sync_idx ON knowledge_sources(status,next_sync_at);

CREATE TABLE knowledge_sync_runs (
  id text PRIMARY KEY,
  source_id text NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  budget_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  state text NOT NULL CHECK (state IN ('queued','running','ready','failed','cancelled')),
  discovered_count integer NOT NULL DEFAULT 0,
  accepted_count integer NOT NULL DEFAULT 0,
  rejected_count integer NOT NULL DEFAULT 0,
  bytes_read bigint NOT NULL DEFAULT 0,
  pages_read integer NOT NULL DEFAULT 0,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX knowledge_sync_runs_source_key_idx ON knowledge_sync_runs(source_id,idempotency_key);

ALTER TABLE knowledge_jobs ADD COLUMN source_id text REFERENCES knowledge_sources(id) ON DELETE SET NULL;
ALTER TABLE knowledge_jobs ADD COLUMN request_hash text;
ALTER TABLE knowledge_jobs ADD COLUMN budget_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE knowledge_jobs ADD CONSTRAINT knowledge_jobs_operation_check CHECK (operation IN ('index','prepare','sync'));
CREATE UNIQUE INDEX knowledge_jobs_source_request_unique_idx ON knowledge_jobs(source_id,request_hash) WHERE source_id IS NOT NULL AND request_hash IS NOT NULL;

CREATE TABLE knowledge_base_agent_bindings (
  kb_id text NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  agent_kind text NOT NULL CHECK (agent_kind IN ('admin_assistant','tutor_partner','runtime_agent')),
  agent_id text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('retrieve','materialize')),
  enabled boolean NOT NULL DEFAULT true,
  revision integer NOT NULL DEFAULT 1,
  created_by text NOT NULL,
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kb_id,agent_kind,agent_id,mode)
);
CREATE INDEX knowledge_base_agent_bindings_agent_idx ON knowledge_base_agent_bindings(agent_kind,agent_id,enabled);

COMMIT;
