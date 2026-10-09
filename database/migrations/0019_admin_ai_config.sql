-- Server-owned admin AI configuration: assistants, PBL teams, and team members.
-- Backs the admin console 「助手 / 团队」 tables (/api/v1/admin/ai-runtime/assistants|teams).
-- This migration is additive and safe to re-run during a rolling deployment.

CREATE TABLE IF NOT EXISTS "admin_assistants" (
  "id" text PRIMARY KEY NOT NULL,
  "source" text NOT NULL DEFAULT 'user',
  "name" text NOT NULL,
  "avatar" text,
  "description" text NOT NULL DEFAULT '',
  "role" text NOT NULL DEFAULT '',
  "enabled" boolean NOT NULL DEFAULT true,
  "sort_order" integer NOT NULL DEFAULT 0,
  "model_provider_id" text,
  "model_id" text,
  "temperature" double precision,
  "instructions" text NOT NULL DEFAULT '',
  "enabled_skills" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "tool_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "mcp_server_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "defaults" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "agent_status" text NOT NULL DEFAULT 'unchecked',
  "agent_status_message" text,
  "team_selectable" boolean NOT NULL DEFAULT true,
  "updated_by" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "admin_assistants_enabled_sort_idx" ON "admin_assistants" ("enabled", "sort_order");
CREATE INDEX IF NOT EXISTS "admin_assistants_selectable_idx" ON "admin_assistants" ("team_selectable", "enabled");

CREATE TABLE IF NOT EXISTS "admin_teams" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "description" text NOT NULL DEFAULT '',
  "workspace_mode" text NOT NULL DEFAULT 'shared',
  "session_mode" text NOT NULL DEFAULT 'supervised',
  "leader_assistant_id" text NOT NULL REFERENCES "admin_assistants"("id") ON DELETE RESTRICT,
  "concurrency_limit" integer NOT NULL DEFAULT 1,
  "pbl_spec" jsonb,
  "enabled" boolean NOT NULL DEFAULT true,
  "updated_by" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "admin_teams_leader_idx" ON "admin_teams" ("leader_assistant_id");
CREATE INDEX IF NOT EXISTS "admin_teams_enabled_idx" ON "admin_teams" ("enabled");

CREATE TABLE IF NOT EXISTS "admin_team_members" (
  "slot_id" text PRIMARY KEY NOT NULL,
  "team_id" text NOT NULL REFERENCES "admin_teams"("id") ON DELETE CASCADE,
  "assistant_id" text NOT NULL REFERENCES "admin_assistants"("id") ON DELETE RESTRICT,
  "role" text NOT NULL,
  "role_label" text,
  "model" text,
  "color" text,
  "pbl_phase" text,
  "status" text NOT NULL DEFAULT 'idle',
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "admin_team_members_team_sort_idx" ON "admin_team_members" ("team_id", "sort_order");
CREATE INDEX IF NOT EXISTS "admin_team_members_assistant_idx" ON "admin_team_members" ("assistant_id");
