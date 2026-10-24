-- Teaching content and delivery receipts, never learning mastery or project state.
CREATE TABLE knowledge_courseware_versions (
  id text PRIMARY KEY,
  asset_id text NOT NULL,
  parent_version_id text REFERENCES knowledge_courseware_versions(id),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  status text NOT NULL CHECK (status IN ('candidate','published','withdrawn')),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX knowledge_courseware_asset_idx ON knowledge_courseware_versions(asset_id,created_at);
--> statement-breakpoint
CREATE INDEX knowledge_courseware_status_idx ON knowledge_courseware_versions(status,created_at);
--> statement-breakpoint

CREATE TABLE tutor_courseware_instances (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  plan_id text NOT NULL REFERENCES learning_plans(id) ON DELETE CASCADE,
  plan_revision integer NOT NULL CHECK (plan_revision > 0),
  session_id text NOT NULL,
  activity_id text NOT NULL,
  request_hash text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX tutor_courseware_scope_idx ON tutor_courseware_instances(project_id,plan_id,plan_revision,session_id);
--> statement-breakpoint

CREATE TABLE knowledge_courseware_operations (
  id text PRIMARY KEY,
  project_id text REFERENCES projects(id) ON DELETE CASCADE,
  request_hash text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
