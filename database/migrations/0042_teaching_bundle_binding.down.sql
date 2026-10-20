ALTER TABLE "project_binding_snapshots" DROP COLUMN IF EXISTS "bundle_digest";
ALTER TABLE "pbl_template_team_bindings"
  DROP COLUMN IF EXISTS "bundle_payload",
  DROP COLUMN IF EXISTS "bundle_draft",
  DROP COLUMN IF EXISTS "bundle_digest";
