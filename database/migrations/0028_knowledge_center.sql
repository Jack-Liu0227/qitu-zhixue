BEGIN;
CREATE TABLE platform_configuration_revisions (
  revision integer PRIMARY KEY, parent_revision integer, config jsonb NOT NULL,
  updated_by text, idempotency_key text, request_hash text,
  updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(updated_by,idempotency_key)
);
CREATE TABLE knowledge_bases (
  id text PRIMARY KEY, name text NOT NULL, kind text NOT NULL CHECK(kind IN ('platform','school','student','project')),
  school_id text, owner_user_id text, project_id text UNIQUE REFERENCES projects(id),
  engine_instance_id text, lifecycle text NOT NULL DEFAULT 'active', build_state text NOT NULL DEFAULT 'queued',
  active_index_version_id text, revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind='project') = (project_id IS NOT NULL))
);
CREATE TABLE project_knowledge_bindings (
  project_id text PRIMARY KEY REFERENCES projects(id), kb_id text UNIQUE NOT NULL REFERENCES knowledge_bases(id),
  mode text NOT NULL DEFAULT 'project_only' CHECK(mode='project_only'), revision integer NOT NULL DEFAULT 1
);
CREATE TABLE knowledge_base_members (
  id text PRIMARY KEY, kb_id text NOT NULL REFERENCES knowledge_bases(id), document_id text REFERENCES knowledge_documents(id),
  title text NOT NULL, content text NOT NULL, checksum text NOT NULL, source_revision text NOT NULL,
  origin jsonb NOT NULL, visibility text NOT NULL DEFAULT 'active', created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(kb_id,checksum)
);
CREATE TABLE knowledge_index_versions (
  id text PRIMARY KEY, kb_id text NOT NULL REFERENCES knowledge_bases(id), status text NOT NULL,
  config_snapshot jsonb NOT NULL, artifact_ref text, manifest jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE knowledge_jobs (
  id text PRIMARY KEY, kb_id text NOT NULL REFERENCES knowledge_bases(id), operation text NOT NULL,
  input_revision integer NOT NULL, state text NOT NULL DEFAULT 'queued', attempts integer NOT NULL DEFAULT 0,
  fencing_token integer NOT NULL DEFAULT 0, lease_until timestamptz, next_attempt_at timestamptz NOT NULL DEFAULT now(),
  error_code text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(kb_id,operation,input_revision)
);
CREATE TABLE knowledge_job_events (
  job_id text NOT NULL REFERENCES knowledge_jobs(id), event_seq integer NOT NULL,
  state text NOT NULL, detail jsonb NOT NULL DEFAULT '{}', occurred_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(job_id,event_seq)
);
CREATE TABLE knowledge_engine_checks (
  instance_id text PRIMARY KEY, config_revision integer NOT NULL, health_status text NOT NULL,
  capabilities jsonb NOT NULL DEFAULT '{}', error_code text, checked_at timestamptz NOT NULL DEFAULT now()
);
-- Map legacy documents by real scope identifiers, never by title.
INSERT INTO knowledge_bases(id,name,kind,school_id,owner_user_id,project_id,build_state)
SELECT 'legacy-'||md5(jsonb_build_array(scope,school_id,owner_user_id,project_id)::text),
  CASE WHEN scope='project' THEN coalesce((SELECT title FROM projects p WHERE p.id=d.project_id),'项目')||'知识库'
    WHEN scope='school' THEN '校本资料库' WHEN scope='student' THEN '个人资料库' ELSE '平台资料库' END,
  CASE WHEN scope='system' THEN 'platform' ELSE scope END, school_id, owner_user_id, project_id,'unindexed'
FROM knowledge_documents d GROUP BY scope,school_id,owner_user_id,project_id ON CONFLICT DO NOTHING;
INSERT INTO knowledge_base_members(id,kb_id,document_id,title,content,checksum,source_revision,origin)
SELECT 'legacy-member-'||d.id, 'legacy-'||md5(jsonb_build_array(scope,school_id,owner_user_id,project_id)::text),
  d.id,d.title,d.content,encode(sha256(convert_to(d.content,'UTF8')),'hex'),d.version,
  jsonb_build_object('kind','legacy','documentId',d.id,'revision',d.version,'canMaterialize',false)
FROM knowledge_documents d ON CONFLICT DO NOTHING;
INSERT INTO project_knowledge_bindings(project_id,kb_id)
SELECT project_id,id FROM knowledge_bases WHERE kind='project' ON CONFLICT DO NOTHING;
-- Repair historical projects through the same durable queue.
INSERT INTO knowledge_bases(id,name,kind,owner_user_id,project_id)
SELECT 'pkb-'||p.id,p.title||'知识库','project',p.student_user_id,p.id FROM projects p
WHERE NOT EXISTS(SELECT 1 FROM knowledge_bases k WHERE k.project_id=p.id);
INSERT INTO project_knowledge_bindings(project_id,kb_id)
SELECT project_id,id FROM knowledge_bases WHERE kind='project' ON CONFLICT DO NOTHING;
INSERT INTO knowledge_jobs(id,kb_id,operation,input_revision)
SELECT 'prepare-'||id,id,'prepare',revision FROM knowledge_bases WHERE kind='project' ON CONFLICT DO NOTHING;
COMMIT;
