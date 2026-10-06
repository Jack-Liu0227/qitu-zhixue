CREATE TABLE IF NOT EXISTS "agent_configs" (
  "id" text PRIMARY KEY NOT NULL,
  "display_name" text NOT NULL,
  "role" text,
  "role_definition" text NOT NULL,
  "agent_definition" text NOT NULL DEFAULT '',
  "model_usage" text NOT NULL DEFAULT 'tutor.chat',
  "capabilities" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "parent_agent_id" text,
  "enabled" boolean NOT NULL DEFAULT true,
  "config_version" integer NOT NULL DEFAULT 1,
  "updated_by" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE "agent_configs" ADD COLUMN IF NOT EXISTS "capabilities" jsonb NOT NULL DEFAULT '[]'::jsonb;


CREATE INDEX IF NOT EXISTS "agent_configs_enabled_idx" ON "agent_configs" ("enabled");

CREATE TABLE IF NOT EXISTS "agent_skill_bindings" (
  "agent_id" text NOT NULL,
  "skill_id" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  "inherit_to_children" boolean NOT NULL DEFAULT false,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "agent_skill_bindings_pkey" PRIMARY KEY ("agent_id", "skill_id")
);
CREATE INDEX IF NOT EXISTS "agent_skill_bindings_skill_idx" ON "agent_skill_bindings" ("skill_id");

CREATE TABLE IF NOT EXISTS "agent_tool_bindings" (
  "agent_id" text NOT NULL,
  "tool_id" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "agent_tool_bindings_pkey" PRIMARY KEY ("agent_id", "tool_id")
);
CREATE INDEX IF NOT EXISTS "agent_tool_bindings_tool_idx" ON "agent_tool_bindings" ("tool_id");

CREATE TABLE IF NOT EXISTS "runtime_mcp_servers" (
  "id" text PRIMARY KEY NOT NULL,
  "label" text NOT NULL,
  "transport" text NOT NULL,
  "description" text,
  "endpoint_origin" text,
  "tool_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "enabled" boolean NOT NULL DEFAULT false,
  "status" text NOT NULL DEFAULT 'not_configured',
  "tool_count" integer,
  "last_checked_at" timestamptz,
  "last_error" text,
  "secret_ref" text,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "agent_mcp_bindings" (
  "agent_id" text NOT NULL,
  "mcp_server_id" text NOT NULL,
  "allowed_tool_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "enabled" boolean NOT NULL DEFAULT true,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "agent_mcp_bindings_pkey" PRIMARY KEY ("agent_id", "mcp_server_id")
);
CREATE INDEX IF NOT EXISTS "agent_mcp_bindings_server_idx" ON "agent_mcp_bindings" ("mcp_server_id");

INSERT INTO "agent_configs" ("id", "display_name", "role", "role_definition", "agent_definition", "model_usage", "capabilities", "enabled", "config_version")
SELECT "id", "display_name", 'tutor', "role_definition", '', "model_usage", "capabilities", "enabled", 1
FROM "tutor_partners"
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "agent_skill_bindings" ("agent_id", "skill_id", "enabled", "inherit_to_children")
SELECT "id", 'tutor-guided-learning', true, true
FROM "agent_configs"
WHERE "id" = 'qitu-learning-partner'
ON CONFLICT ("agent_id", "skill_id") DO NOTHING;

INSERT INTO "agent_tool_bindings" ("agent_id", "tool_id", "enabled")
SELECT 'qitu-learning-partner', tool_id, true
FROM unnest(ARRAY[
  'tutor.context_packet',
  'tutor.pedagogy_move',
  'tutor.mastery_gate',
  'tutor.escalation',
  'agent-memory.index',
  'project.next_step'
]) AS tool_id
WHERE EXISTS (SELECT 1 FROM "agent_configs" WHERE "id" = 'qitu-learning-partner')
ON CONFLICT ("agent_id", "tool_id") DO NOTHING;
