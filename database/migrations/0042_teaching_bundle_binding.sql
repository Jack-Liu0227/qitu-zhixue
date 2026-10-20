-- Teaching Bundle: Admin references, validated digest and immutable payload.
-- Nullable columns preserve pre-bundle bindings; PBL activation/freeze paths fail closed.
ALTER TABLE "pbl_template_team_bindings"
  ADD COLUMN IF NOT EXISTS "bundle_digest" text,
  ADD COLUMN IF NOT EXISTS "bundle_draft" jsonb,
  ADD COLUMN IF NOT EXISTS "bundle_payload" jsonb;

ALTER TABLE "project_binding_snapshots"
  ADD COLUMN IF NOT EXISTS "bundle_digest" text;
