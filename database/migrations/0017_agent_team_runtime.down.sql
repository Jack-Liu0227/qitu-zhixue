-- Restore the outbox shape changed by the forward migration before removing
-- Team Runtime tables. The index is explicit so rollback remains valid even
-- when PostgreSQL does not implicitly report dependent index cleanup.
DROP INDEX IF EXISTS "outbox_lease_idx";
ALTER TABLE "outbox"
  DROP COLUMN IF EXISTS "lease_owner",
  DROP COLUMN IF EXISTS "lease_until";

-- Preserve the inserted agent definitions: they are server configuration and
-- may have been edited after migration; only the route table is removed below.
DROP TABLE IF EXISTS "agent_routes";
DROP TABLE IF EXISTS "agent_projection_candidates";
DROP TABLE IF EXISTS "agent_mailboxes";
DROP TABLE IF EXISTS "agent_team_events";
DROP TABLE IF EXISTS "agent_team_messages";
DROP TABLE IF EXISTS "agent_team_tasks";
DROP TABLE IF EXISTS "agent_team_runs";
