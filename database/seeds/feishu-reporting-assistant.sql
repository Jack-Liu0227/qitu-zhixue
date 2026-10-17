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

INSERT INTO admin_assistants
  (id, source, name, description, role, enabled, sort_order, model_provider_id, model_id,
   instructions, enabled_skills, tool_ids, mcp_server_ids, defaults, agent_status, team_selectable)
VALUES (
  'feishu-issue-summary-assistant', 'builtin', '三端问题总结与飞书汇报助手',
  '专用于汇总学生、家长与教师三端遇到的问题与反馈，通过飞书机器人发送总结消息，支持二维码扫码绑定。',
  'Problem Summary & Feishu Bot / 三端问题总结助手', true, 91, NULL, 'qwen3.8-flash',
  '你是启途智学三端问题总结助手。专职汇总学生、家长与教师在平台使用、PBL项目学习、家校协同与教学辅导中遇到的难点、阻塞性问题与意见反馈。整理生成结构化的问题总结，分模块列出：1.学生端学习与技术卡点；2.家长端协同诉求；3.教师端教学关注事项。格式化后通过飞书机器人消息推送到管理者飞书群。严格执行数据脱敏与未成年人保护规范。',
  '["reporting","issue-summary","privacy-minimization","audit"]'::jsonb,
  '["student_status_summary","parent_status_summary","teacher_status_summary"]'::jsonb,
  '[]'::jsonb,
  '{"model":{"mode":"custom","value":"qwen3.8-flash"},"permission":{"mode":"auto","value":"supervised"},"thought_level":{"mode":"high","value":"balanced"},"skills":{"mode":"custom","value":["reporting","issue-summary","privacy-minimization","audit"]},"mcps":{"mode":"default","value":[]}}'::jsonb,
  'online', true
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  role = EXCLUDED.role,
  model_id = 'qwen3.8-flash',
  instructions = EXCLUDED.instructions,
  enabled_skills = EXCLUDED.enabled_skills,
  tool_ids = EXCLUDED.tool_ids,
  defaults = EXCLUDED.defaults,
  updated_at = now();
