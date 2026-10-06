-- Durable server-side Team Runtime for the AI Tutor leader and child agents.
-- This migration is additive and safe to re-run during a rolling deployment.
ALTER TABLE "outbox"
  ADD COLUMN IF NOT EXISTS "lease_owner" text,
  ADD COLUMN IF NOT EXISTS "lease_until" timestamptz;
CREATE INDEX IF NOT EXISTS "outbox_lease_idx" ON "outbox" ("status", "lease_until");

CREATE TABLE IF NOT EXISTS "agent_team_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "leader_agent_id" text NOT NULL REFERENCES "agent_configs"("id") ON DELETE RESTRICT,
  "student_user_id" text REFERENCES "users"("id") ON DELETE RESTRICT,
  "project_id" text REFERENCES "projects"("id") ON DELETE RESTRICT,
  "tutor_session_id" text,
  "trigger" text NOT NULL,
  "status" text NOT NULL DEFAULT 'queued',
  "context" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "idempotency_key" text NOT NULL,
  "created_by" text,
  "lease_owner" text,
  "lease_expires_at" timestamptz,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "agent_team_runs_idempotency_unique_idx" ON "agent_team_runs" ("idempotency_key");
CREATE INDEX IF NOT EXISTS "agent_team_runs_student_idx" ON "agent_team_runs" ("student_user_id", "created_at");
CREATE INDEX IF NOT EXISTS "agent_team_runs_status_idx" ON "agent_team_runs" ("status", "created_at");
CREATE INDEX IF NOT EXISTS "agent_team_runs_lease_idx" ON "agent_team_runs" ("lease_expires_at");

CREATE TABLE IF NOT EXISTS "agent_team_tasks" (
  "id" text PRIMARY KEY NOT NULL,
  "run_id" text NOT NULL REFERENCES "agent_team_runs"("id") ON DELETE CASCADE,
  "parent_task_id" text,
  "agent_id" text NOT NULL REFERENCES "agent_configs"("id") ON DELETE RESTRICT,
  "task_type" text NOT NULL,
  "status" text NOT NULL DEFAULT 'queued',
  "input" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "output" jsonb,
  "error_code" text,
  "attempts" integer NOT NULL DEFAULT 0,
  "max_attempts" integer NOT NULL DEFAULT 3,
  "idempotency_key" text NOT NULL,
  "lease_owner" text,
  "lease_expires_at" timestamptz,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "agent_team_tasks_idempotency_unique_idx" ON "agent_team_tasks" ("idempotency_key");
CREATE INDEX IF NOT EXISTS "agent_team_tasks_run_idx" ON "agent_team_tasks" ("run_id", "created_at");
CREATE INDEX IF NOT EXISTS "agent_team_tasks_agent_status_idx" ON "agent_team_tasks" ("agent_id", "status");
CREATE INDEX IF NOT EXISTS "agent_team_tasks_lease_idx" ON "agent_team_tasks" ("lease_expires_at");

CREATE TABLE IF NOT EXISTS "agent_team_messages" (
  "id" text PRIMARY KEY NOT NULL,
  "run_id" text NOT NULL REFERENCES "agent_team_runs"("id") ON DELETE CASCADE,
  "task_id" text REFERENCES "agent_team_tasks"("id") ON DELETE CASCADE,
  "mailbox_agent_id" text NOT NULL REFERENCES "agent_configs"("id") ON DELETE RESTRICT,
  "sender_agent_id" text NOT NULL REFERENCES "agent_configs"("id") ON DELETE RESTRICT,
  "recipient_agent_id" text NOT NULL REFERENCES "agent_configs"("id") ON DELETE RESTRICT,
  "message_type" text NOT NULL,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" text NOT NULL DEFAULT 'queued',
  "correlation_id" text,
  "causation_id" text,
  "idempotency_key" text NOT NULL,
  "attempts" integer NOT NULL DEFAULT 0,
  "available_at" timestamptz NOT NULL DEFAULT now(),
  "lease_owner" text,
  "lease_expires_at" timestamptz,
  "delivered_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "agent_team_messages_idempotency_unique_idx" ON "agent_team_messages" ("idempotency_key");
CREATE INDEX IF NOT EXISTS "agent_team_messages_mailbox_idx" ON "agent_team_messages" ("mailbox_agent_id", "status", "available_at");
CREATE INDEX IF NOT EXISTS "agent_team_messages_run_idx" ON "agent_team_messages" ("run_id", "created_at");
CREATE INDEX IF NOT EXISTS "agent_team_messages_correlation_idx" ON "agent_team_messages" ("correlation_id");
CREATE INDEX IF NOT EXISTS "agent_team_messages_lease_idx" ON "agent_team_messages" ("lease_expires_at");

CREATE TABLE IF NOT EXISTS "agent_team_events" (
  "id" text PRIMARY KEY NOT NULL,
  "run_id" text REFERENCES "agent_team_runs"("id") ON DELETE CASCADE,
  "task_id" text REFERENCES "agent_team_tasks"("id") ON DELETE CASCADE,
  "topic" text NOT NULL,
  "sequence" integer NOT NULL DEFAULT 0,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "idempotency_key" text NOT NULL,
  "occurred_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "agent_team_events_idempotency_unique_idx" ON "agent_team_events" ("idempotency_key");
CREATE INDEX IF NOT EXISTS "agent_team_events_run_sequence_idx" ON "agent_team_events" ("run_id", "sequence");
CREATE INDEX IF NOT EXISTS "agent_team_events_topic_idx" ON "agent_team_events" ("topic", "created_at");

CREATE TABLE IF NOT EXISTS "agent_mailboxes" (
  "agent_id" text PRIMARY KEY NOT NULL REFERENCES "agent_configs"("id") ON DELETE CASCADE,
  "pending_count" integer NOT NULL DEFAULT 0,
  "lease_owner" text,
  "lease_expires_at" timestamptz,
  "cursor" text,
  "enabled" boolean NOT NULL DEFAULT true,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "agent_routes" (
  "id" text PRIMARY KEY NOT NULL,
  "from_agent_id" text NOT NULL REFERENCES "agent_configs"("id") ON DELETE CASCADE,
  "to_agent_id" text NOT NULL REFERENCES "agent_configs"("id") ON DELETE CASCADE,
  "trigger" text NOT NULL DEFAULT 'delegate',
  "task_type" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  "input_schema" jsonb,
  "output_schema" jsonb,
  "updated_by" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "agent_routes_route_unique_idx" ON "agent_routes" ("from_agent_id", "to_agent_id", "trigger", "task_type");
CREATE INDEX IF NOT EXISTS "agent_routes_from_idx" ON "agent_routes" ("from_agent_id", "enabled");
CREATE INDEX IF NOT EXISTS "agent_routes_to_idx" ON "agent_routes" ("to_agent_id", "enabled");

CREATE TABLE IF NOT EXISTS "agent_projection_candidates" (
  "id" text PRIMARY KEY NOT NULL,
  "run_id" text REFERENCES "agent_team_runs"("id") ON DELETE SET NULL,
  "task_id" text REFERENCES "agent_team_tasks"("id") ON DELETE SET NULL,
  "agent_id" text NOT NULL REFERENCES "agent_configs"("id") ON DELETE RESTRICT,
  "projection_type" text NOT NULL,
  "student_user_id" text REFERENCES "users"("id") ON DELETE RESTRICT,
  "project_id" text REFERENCES "projects"("id") ON DELETE RESTRICT,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" text NOT NULL DEFAULT 'proposed',
  "idempotency_key" text NOT NULL,
  "reviewed_by" text,
  "reviewed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "agent_projection_candidates_idempotency_unique_idx" ON "agent_projection_candidates" ("idempotency_key");
CREATE INDEX IF NOT EXISTS "agent_projection_candidates_student_idx" ON "agent_projection_candidates" ("student_user_id", "created_at");
CREATE INDEX IF NOT EXISTS "agent_projection_candidates_status_idx" ON "agent_projection_candidates" ("status", "created_at");

-- The migration runs before deterministic seeds in a fresh deployment. Keep a
-- server-owned Team Leader row available so the child-agent foreign keys below
-- do not depend on seed ordering. Existing governance/model fields are left
-- untouched by the conflict-safe insert.
INSERT INTO "agent_configs" ("id", "display_name", "role", "role_definition", "agent_definition", "model_usage", "capabilities", "parent_agent_id", "enabled", "config_version")
VALUES (
  'qitu-learning-partner',
  'Qitu Learning Partner',
  'tutor',
  'Support student exploration, theory learning, practice, and reflection without bypassing server gates.',
  '',
  'tutor.chat',
  '["explore", "plan", "teach", "review", "reflect"]'::jsonb,
  NULL,
  true,
  1
)
ON CONFLICT ("id") DO NOTHING;

-- Built-in child agents are disabled until their model and route policies are reviewed.
INSERT INTO "agent_configs" ("id", "display_name", "role", "role_definition", "agent_definition", "model_usage", "capabilities", "parent_agent_id", "enabled", "config_version")
VALUES
  ('pbl-orchestrator', 'PBL 项目编排', 'planner', '根据导师委派拆解和推进 PBL 项目阶段。', '', 'tutor.chat', '["plan"]'::jsonb, 'qitu-learning-partner', false, 1),
  ('interest-confirmation', '兴趣确认', 'explorer', '识别并确认学生的兴趣、目标与受益对象，返回可审计证据。', '', 'tutor.chat', '["explore"]'::jsonb, 'qitu-learning-partner', false, 1),
  ('project-recommender', '项目推荐', 'planner', '基于已确认兴趣和学习上下文提供候选 PBL 项目。', '', 'tutor.chat', '["plan"]'::jsonb, 'qitu-learning-partner', false, 1),
  ('learner-profile', '个人画像', 'reflector', '从经过授权的学习证据生成个人画像候选投影。', '', 'tutor.chat', '["reflect"]'::jsonb, 'qitu-learning-partner', false, 1),
  ('growth-analyst', '成长轨迹', 'reflector', '从项目事件生成可审计的成长轨迹候选投影。', '', 'tutor.chat', '["reflect"]'::jsonb, 'qitu-learning-partner', false, 1)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "agent_routes" ("id", "from_agent_id", "to_agent_id", "trigger", "task_type", "enabled")
SELECT route_id, from_agent_id, to_agent_id, trigger, task_type, enabled
FROM (VALUES
  ('route-tutor-interest-confirmation', 'qitu-learning-partner', 'interest-confirmation', 'delegate', 'interest.confirm', true),
  ('route-interest-project-recommender', 'interest-confirmation', 'project-recommender', 'delegate', 'project.recommend', true),
  ('route-tutor-pbl-orchestrator', 'qitu-learning-partner', 'pbl-orchestrator', 'delegate', 'pbl.plan', true),
  ('route-tutor-learner-profile', 'qitu-learning-partner', 'learner-profile', 'event', 'profile.project', true),
  ('route-tutor-growth-analyst', 'qitu-learning-partner', 'growth-analyst', 'event', 'growth.project', true)
) AS routes(route_id, from_agent_id, to_agent_id, trigger, task_type, enabled)
WHERE EXISTS (SELECT 1 FROM "agent_configs" WHERE "id" = routes.from_agent_id)
  AND EXISTS (SELECT 1 FROM "agent_configs" WHERE "id" = routes.to_agent_id)
ON CONFLICT ("from_agent_id", "to_agent_id", "trigger", "task_type") DO NOTHING;
