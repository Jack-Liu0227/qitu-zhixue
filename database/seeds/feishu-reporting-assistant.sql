-- Built-in administrator reporting assistant for the Feishu/Lark bot.
-- Secrets and recipient identifiers are configured through the admin API.
INSERT INTO admin_assistants
  (id, source, name, description, role, enabled, sort_order, model_provider_id, model_id,
   instructions, enabled_skills, tool_ids, mcp_server_ids, defaults, agent_status, team_selectable)
VALUES (
  'feishu-reporting-assistant', 'builtin', '学情汇报助手',
  '面向管理者汇报学生、家长与教师整体情况，按最小可见范围输出可审计摘要。',
  'Administrator Reporting Assistant', true, 90, NULL, 'gpt-6.1-sol',
  '你是启途智学管理者汇报助手。仅汇总经授权的学生、家长和教师状态，遵循最小化披露原则，不输出未成年人原始对话或语音；指出数据时间、来源和不确定性。',
  '["reporting","privacy-minimization","audit"]'::jsonb,
  '["student_status_summary","parent_status_summary","teacher_status_summary"]'::jsonb,
  '[]'::jsonb,
  '{"model":{"mode":"custom","value":"gpt-6.1-sol"},"permission":{"mode":"auto","value":"supervised"},"thought_level":{"mode":"high","value":"balanced"},"skills":{"mode":"custom","value":["reporting","privacy-minimization","audit"]},"mcps":{"mode":"default","value":[]}}'::jsonb,
  'unchecked', true
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  role = EXCLUDED.role,
  model_id = 'gpt-6.1-sol',
  instructions = EXCLUDED.instructions,
  enabled_skills = EXCLUDED.enabled_skills,
  tool_ids = EXCLUDED.tool_ids,
  defaults = EXCLUDED.defaults,
  updated_at = now();
