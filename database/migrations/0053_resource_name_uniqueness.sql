-- Display names are unique within their resource/ownership scope, including disabled/archived rows.
-- Existing duplicates intentionally abort this transactional migration; never rename frozen history.
CREATE OR REPLACE FUNCTION qitu_resource_name_key(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT translate(btrim(regexp_replace(value,
    U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+', ' ', 'g')),
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')
$$;
--> statement-breakpoint
CREATE UNIQUE INDEX admin_assistants_name_unique_idx ON admin_assistants (qitu_resource_name_key(name));
CREATE UNIQUE INDEX admin_teams_name_unique_idx ON admin_teams (qitu_resource_name_key(name));
CREATE UNIQUE INDEX agent_configs_name_unique_idx ON agent_configs (qitu_resource_name_key(display_name));
CREATE UNIQUE INDEX project_templates_platform_name_unique_idx ON project_templates (qitu_resource_name_key(title)) WHERE school_id IS NULL;
CREATE UNIQUE INDEX project_templates_school_name_unique_idx ON project_templates (school_id, qitu_resource_name_key(title)) WHERE school_id IS NOT NULL;
CREATE UNIQUE INDEX knowledge_bases_name_unique_idx ON knowledge_bases
  (coalesce(school_id, ''), coalesce(owner_user_id, ''), coalesce(project_id, ''), qitu_resource_name_key(name))
  WHERE lifecycle <> 'deleted';
CREATE UNIQUE INDEX model_providers_name_unique_idx ON model_providers (qitu_resource_name_key(name));
CREATE UNIQUE INDEX model_models_name_unique_idx ON model_models (provider_id, qitu_resource_name_key(display_name));
CREATE UNIQUE INDEX runtime_mcp_servers_name_unique_idx ON runtime_mcp_servers (qitu_resource_name_key(label));
