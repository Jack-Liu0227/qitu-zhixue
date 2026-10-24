-- Restores referenced frozen configuration for application rollback.
-- Unreferenced obsolete versions intentionally require the pre-migration backup.
BEGIN;
CREATE TABLE IF NOT EXISTS admin_team_versions (
  id text PRIMARY KEY, team_id text NOT NULL REFERENCES admin_teams(id) ON DELETE RESTRICT,
  version integer NOT NULL, name text NOT NULL, description text NOT NULL DEFAULT '',
  workspace_mode text NOT NULL DEFAULT 'shared', session_mode text NOT NULL DEFAULT 'supervised',
  leader_assistant_id text NOT NULL REFERENCES admin_assistants(id) ON DELETE RESTRICT,
  members jsonb NOT NULL DEFAULT '[]'::jsonb, pbl_spec jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT true, created_by text, created_at timestamptz NOT NULL DEFAULT now()
);
DO $$ BEGIN
  IF EXISTS (SELECT key FROM pbl_template_team_bindings, LATERAL jsonb_each(team_snapshots)
    GROUP BY key HAVING count(DISTINCT value)>1) THEN
    RAISE EXCEPTION 'TEAM_SNAPSHOT_ROLLBACK_CONTENT_CONFLICT';
  END IF;
END $$;
INSERT INTO admin_team_versions
SELECT DISTINCT value->>'id', value->>'teamId', (value->>'version')::integer, value->>'name',
  value->>'description', value->>'workspaceMode', value->>'sessionMode', value->>'leaderAssistantId',
  value->'members', value->'pblSpec', (value->>'enabled')::boolean, value->>'createdBy', (value->>'createdAt')::timestamptz
FROM pbl_template_team_bindings, LATERAL jsonb_each(team_snapshots) ON CONFLICT (id) DO NOTHING;
ALTER TABLE pbl_template_team_bindings DROP CONSTRAINT IF EXISTS binding_team_snapshots_object;
ALTER TABLE pbl_template_team_bindings ADD CONSTRAINT pbl_template_team_bindings_team_version_id_fkey
  FOREIGN KEY (team_version_id) REFERENCES admin_team_versions(id) ON DELETE RESTRICT;
ALTER TABLE project_binding_snapshots ADD CONSTRAINT project_binding_snapshots_team_version_id_fkey
  FOREIGN KEY (team_version_id) REFERENCES admin_team_versions(id) ON DELETE RESTRICT;
COMMIT;
