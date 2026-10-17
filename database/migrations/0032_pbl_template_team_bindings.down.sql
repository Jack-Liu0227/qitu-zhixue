-- 0032_pbl_template_team_bindings down
-- 逆序删除：先删依赖表，再删被依赖表。

DROP TABLE IF EXISTS "project_binding_snapshots";

DROP INDEX IF EXISTS "pbl_template_team_bindings_team_version_idx";
DROP INDEX IF EXISTS "pbl_template_team_bindings_template_status_idx";
DROP INDEX IF EXISTS "pbl_template_team_bindings_one_active_per_template_idx";
DROP TABLE IF EXISTS "pbl_template_team_bindings";

DROP INDEX IF EXISTS "admin_team_versions_team_version_unique_idx";
DROP TABLE IF EXISTS "admin_team_versions";
