-- Retire the independent team-version resource. Run with the API/workers stopped.
-- Frozen v1 IDs, payloads and hashes are unchanged; configurations belong to bindings.
BEGIN;
ALTER TABLE pbl_template_team_bindings ADD COLUMN IF NOT EXISTS team_snapshots jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF to_regclass('public.admin_team_versions') IS NULL THEN
    RETURN;
  END IF;
  LOCK TABLE admin_team_versions, pbl_template_team_bindings, project_binding_snapshots IN ACCESS EXCLUSIVE MODE;

  CREATE TEMP TABLE qitu_binding_snapshot_refs ON COMMIT DROP AS
    SELECT b.id AS binding_id, b.team_version_id AS snapshot_id FROM pbl_template_team_bindings b
    UNION
    SELECT b.id, ref #>> '{}' FROM pbl_template_team_bindings b,
      LATERAL jsonb_path_query(COALESCE(b.bundle_draft, '{}'::jsonb), '$.**.teamVersionId') ref
    UNION
    SELECT b.id, ref #>> '{}' FROM pbl_template_team_bindings b,
      LATERAL jsonb_path_query(COALESCE(b.bundle_payload, '{}'::jsonb), '$.**.teamVersionId') ref
    UNION
    SELECT s.binding_id, s.team_version_id FROM project_binding_snapshots s;

  IF EXISTS (SELECT 1 FROM qitu_binding_snapshot_refs r LEFT JOIN admin_team_versions t ON t.id=r.snapshot_id
    WHERE t.id IS NULL) THEN
    RAISE EXCEPTION 'TEAM_SNAPSHOT_MIGRATION_MISSING_REFERENCE';
  END IF;
  CREATE TEMP TABLE qitu_binding_snapshot_sources ON COMMIT DROP AS
    SELECT r.binding_id, r.snapshot_id,
      jsonb_build_object('id', t.id, 'teamId', t.team_id, 'version', t.version,
        'name', t.name, 'description', t.description, 'workspaceMode', t.workspace_mode,
        'sessionMode', t.session_mode, 'leaderAssistantId', t.leader_assistant_id,
        'members', t.members, 'pblSpec', t.pbl_spec, 'enabled', t.enabled,
        'createdBy', t.created_by, 'createdAt', to_char(t.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) AS content
    FROM qitu_binding_snapshot_refs r JOIN admin_team_versions t ON t.id=r.snapshot_id;

  IF EXISTS (SELECT 1 FROM qitu_binding_snapshot_sources s JOIN pbl_template_team_bindings b ON b.id=s.binding_id
    WHERE b.team_snapshots ? s.snapshot_id AND b.team_snapshots->s.snapshot_id <> s.content) THEN
    RAISE EXCEPTION 'TEAM_SNAPSHOT_MIGRATION_CONTENT_CONFLICT';
  END IF;
  UPDATE pbl_template_team_bindings b SET team_snapshots=b.team_snapshots || source.snapshots
    FROM (SELECT binding_id, jsonb_object_agg(snapshot_id, content) AS snapshots
      FROM qitu_binding_snapshot_sources GROUP BY binding_id) source WHERE b.id=source.binding_id;
  IF EXISTS (SELECT 1 FROM qitu_binding_snapshot_sources s JOIN pbl_template_team_bindings b ON b.id=s.binding_id
    WHERE b.team_snapshots->s.snapshot_id IS DISTINCT FROM s.content) THEN
    RAISE EXCEPTION 'TEAM_SNAPSHOT_MIGRATION_VERIFICATION_FAILED';
  END IF;

  -- Constraint names differ between SQL/bootstrap installations; select only this FK target.
  DECLARE constraint_row record;
  BEGIN
    FOR constraint_row IN SELECT conrelid::regclass AS relation, conname FROM pg_constraint
      WHERE contype='f' AND confrelid='admin_team_versions'::regclass
    LOOP
      IF constraint_row.relation::text NOT IN ('pbl_template_team_bindings', 'project_binding_snapshots') THEN
        RAISE EXCEPTION 'TEAM_SNAPSHOT_MIGRATION_UNEXPECTED_FOREIGN_KEY';
      END IF;
      EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', constraint_row.relation, constraint_row.conname);
    END LOOP;
  END;
  DROP TABLE admin_team_versions;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='binding_team_snapshots_object') THEN
    ALTER TABLE pbl_template_team_bindings ADD CONSTRAINT binding_team_snapshots_object
      CHECK (jsonb_typeof(team_snapshots)='object' AND team_snapshots ? team_version_id);
  END IF;
END $$;
COMMIT;
