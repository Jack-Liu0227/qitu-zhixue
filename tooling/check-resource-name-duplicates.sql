-- Read-only preflight for migration 0053. Reports resource IDs, never credentials or student content.
WITH resources(category, scope, id, name) AS (
  SELECT 'assistant', '[]'::jsonb, id, name FROM admin_assistants
  UNION ALL SELECT 'team', '[]'::jsonb, id, name FROM admin_teams
  UNION ALL SELECT 'agent', '[]'::jsonb, id, display_name FROM agent_configs
  UNION ALL SELECT 'template', jsonb_build_array(school_id), id, title FROM project_templates
  UNION ALL SELECT 'knowledge_base', jsonb_build_array(coalesce(school_id,''), coalesce(owner_user_id,''), coalesce(project_id,'')), id, name
    FROM knowledge_bases WHERE lifecycle <> 'deleted'
  UNION ALL SELECT 'model_provider', '[]'::jsonb, id, name FROM model_providers
  UNION ALL SELECT 'model', jsonb_build_array(provider_id), model_id, display_name FROM model_models
  UNION ALL SELECT 'mcp_server', '[]'::jsonb, id, label FROM runtime_mcp_servers
), normalized AS (
  SELECT category, scope, id, translate(btrim(regexp_replace(name,
    U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+', ' ', 'g')),
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') AS name_key
  FROM resources
)
SELECT category, scope, count(*) AS duplicate_count, jsonb_agg(id ORDER BY id) AS resource_ids
FROM normalized GROUP BY category, scope, name_key HAVING count(*) > 1
ORDER BY category, scope, resource_ids;
