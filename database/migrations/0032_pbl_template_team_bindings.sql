-- 0032_pbl_template_team_bindings
-- F2 团队绑定 + F3 项目绑定快照冻结（api-spec F2.2 / F3.2）。
-- 可重跑：所有建表 / 建索引语句均带 IF NOT EXISTS。

-- Table A：团队不可变版本快照。绑定引用版本而非可变的 admin_teams 行。
CREATE TABLE IF NOT EXISTS "admin_team_versions" (
  "id" text PRIMARY KEY NOT NULL,
  "team_id" text NOT NULL REFERENCES "admin_teams"("id") ON DELETE RESTRICT,
  "version" integer NOT NULL,
  "name" text NOT NULL,
  "description" text NOT NULL DEFAULT '',
  "workspace_mode" text NOT NULL DEFAULT 'shared',
  "session_mode" text NOT NULL DEFAULT 'supervised',
  "leader_assistant_id" text NOT NULL REFERENCES "admin_assistants"("id") ON DELETE RESTRICT,
  "members" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "pbl_spec" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "enabled" boolean NOT NULL DEFAULT true,
  "created_by" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "admin_team_versions_team_version_unique_idx"
  ON "admin_team_versions" ("team_id", "version");

-- Table B：模板版本 ↔ 团队版本绑定。
CREATE TABLE IF NOT EXISTS "pbl_template_team_bindings" (
  "id" text PRIMARY KEY NOT NULL,
  "template_version_id" text NOT NULL REFERENCES "project_template_versions"("id") ON DELETE RESTRICT,
  "team_version_id" text NOT NULL REFERENCES "admin_team_versions"("id") ON DELETE RESTRICT,
  "status" text NOT NULL DEFAULT 'draft',
  "binding_hash" text NOT NULL,
  "validation" jsonb NOT NULL DEFAULT '{"valid":false,"errors":[],"warnings":[],"checkedAt":null}'::jsonb,
  "activated_at" timestamptz,
  "retired_at" timestamptz,
  "created_by" text REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
-- 局部唯一索引：一个模板版本同一时刻最多一个 active 绑定（并发双激活兜底）。
CREATE UNIQUE INDEX IF NOT EXISTS "pbl_template_team_bindings_one_active_per_template_idx"
  ON "pbl_template_team_bindings" ("template_version_id")
  WHERE "status" = 'active';
CREATE INDEX IF NOT EXISTS "pbl_template_team_bindings_template_status_idx"
  ON "pbl_template_team_bindings" ("template_version_id", "status");
CREATE INDEX IF NOT EXISTS "pbl_template_team_bindings_team_version_idx"
  ON "pbl_template_team_bindings" ("team_version_id");

-- Table C：项目创建时冻结的绑定快照。不可变：无 updated_at、无更新路径。
CREATE TABLE IF NOT EXISTS "project_binding_snapshots" (
  "project_id" text PRIMARY KEY NOT NULL REFERENCES "projects"("id") ON DELETE RESTRICT,
  "template_version_id" text NOT NULL REFERENCES "project_template_versions"("id") ON DELETE RESTRICT,
  "binding_id" text NOT NULL REFERENCES "pbl_template_team_bindings"("id") ON DELETE RESTRICT,
  "team_version_id" text NOT NULL REFERENCES "admin_team_versions"("id") ON DELETE RESTRICT,
  "binding_hash" text NOT NULL,
  "bound_at" timestamptz NOT NULL,
  "backfilled" boolean NOT NULL DEFAULT false
);
