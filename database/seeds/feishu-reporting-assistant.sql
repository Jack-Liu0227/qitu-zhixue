-- Built-in administrator reporting assistant for the Feishu/Lark bot.
-- Secrets and recipient identifiers are configured through the admin API.
-- 2026-10-18 合并：原 `feishu-issue-summary-assistant`（三端问题总结）并入本助手，
-- 全平台只保留这一个飞书汇报助手；后端默认值见
-- services/api/src/modules/feishu/feishu.service.ts 的 DEFAULT_FEISHU_ASSISTANT_ID。
-- 数值与 packages/ai-client/src/assistant-registry.ts、database/seeds/admin-ai-config.sql 保持一致，
-- 各 seed 均幂等且值一致，执行顺序不影响结果。
INSERT INTO admin_assistants
  (id, source, name, avatar, description, role, enabled, sort_order, model_provider_id, model_id,
   instructions, enabled_skills, tool_ids, mcp_server_ids, defaults, agent_status, team_selectable)
VALUES (
  'feishu-reporting-assistant', 'builtin', '学生-家长-教师汇报与问题总结助手', '🪽',
  '面向管理者汇总学生、家长与教师的脱敏状态摘要，并集中总结三端遇到的问题与反馈，通过飞书机器人推送，支持二维码扫码绑定。',
  'Administrator Reporting & Issue Summary Assistant / 管理汇报与问题总结助手', true, 90, NULL, 'gpt-6.1-sol',
  '你是启途智学管理汇报与问题总结助手，是飞书机器人外发的唯一汇报助手。职责一：只读取经过权限过滤的学生、家长和教师摘要，输出统计、趋势、待关注事项和数据时间。职责二：集中汇总三端遇到的问题与反馈，分模块整理：1.学生端学习与技术卡点；2.家长端协同诉求；3.教师端教学关注事项；格式化后通过飞书机器人消息推送到管理者。禁止输出未成年人原始对话、语音、内部风险标签或任何无关个人信息；不要写入项目状态、成长档案、AI 决策或干预记录。严格执行数据脱敏与未成年人保护规范。',
  '["reporting","issue-summary","privacy-minimization","audit"]'::jsonb,
  '["student_status_summary","parent_status_summary","teacher_status_summary"]'::jsonb,
  '[]'::jsonb,
  '{"model":{"mode":"custom","value":"gpt-6.1-sol"},"permission":{"mode":"custom","value":"read-only"},"thought_level":{"mode":"high","value":"balanced"},"skills":{"mode":"custom","value":["reporting","issue-summary","privacy-minimization","audit"]},"mcps":{"mode":"default","value":[]}}'::jsonb,
  'unchecked', false
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  avatar = EXCLUDED.avatar,
  description = EXCLUDED.description,
  role = EXCLUDED.role,
  model_id = 'gpt-6.1-sol',
  instructions = EXCLUDED.instructions,
  enabled_skills = EXCLUDED.enabled_skills,
  tool_ids = EXCLUDED.tool_ids,
  defaults = EXCLUDED.defaults,
  team_selectable = false,
  updated_at = now();

-- 清理历史登记的重复助手（幂等；不存在时无效果）。
DELETE FROM admin_assistants WHERE id = 'feishu-issue-summary-assistant';
