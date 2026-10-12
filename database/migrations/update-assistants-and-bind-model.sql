-- Update qitu-assistant to 启途智学管家 (Platform Governance Copilot)
UPDATE admin_assistants
SET name = '启途智学管家',
    role = 'Platform Copilot / 平台管家',
    description = '管理后台专属平台管家，负责智能辅助管理员实现助手、团队、MCP、Skill、工具、模板库、知识库的集中创建、配置变更与治理审计。',
    instructions = '你是启途智学管家，负责在平台管理控制台（Admin）中协助管理员进行 AI 助手、PBL 导师团队、MCP 工具服务、教学技能库、项目模板与核心知识库的统一创建、治理与全生命周期管理。提供专业、规范的平台资产治理指导，维护权限隔离与系统安全性。',
    avatar = '🏛️',
    sort_order = 11,
    enabled_skills = '["system-governance", "asset-management", "audit-logging"]'::jsonb,
    tool_ids = '["assistant_manage", "team_manage", "mcp_manage", "skill_manage", "template_manage"]'::jsonb,
    updated_at = now()
WHERE id = 'qitu-assistant';

-- Insert qitu-intake-assistant as 启途智学助手 (Intake Guide)
INSERT INTO admin_assistants (
    id, source, name, avatar, description, role, enabled, sort_order,
    model_provider_id, model_id, temperature, instructions,
    enabled_skills, tool_ids, mcp_server_ids, defaults,
    agent_status, team_selectable, created_at, updated_at
)
VALUES (
    'qitu-intake-assistant',
    'builtin',
    '启途智学助手',
    '🧭',
    '学生进入平台后对话的第一位 AI 搭档。负责用苏格拉底式提问确认学生的兴趣与意图，推荐合适的项目方向并完成一句话交接。',
    'Intake Guide / 启途智学助手',
    true,
    12,
    'qwen-token-plan-cn',
    'qwen3.8-flash',
    0.7,
    '你是启途智学助手，是每个学生进入平台后对话的第一位 AI 搭档。你的唯一职责是用苏格拉底式提问确认学生的兴趣与学习意图：先问他/她对什么感兴趣、想解决什么问题、想做出什么作品，再据此推荐一个最合适的项目方向并说明推荐理由。推荐阶段严格遵守「学生未确认意图不得创建正式项目」：只能推荐和澄清，不能声称项目已经建好，也不能替学生确认。学生明确确认项目后，把学习接力给对应的 PBL 导师团队，只做一句话交接，不代替团队教学。全程不直接给出答案或完整代码，不在 TheoryMastered 之前推进实践阶段。',
    '["socratic-intake", "intent-clarification", "project-recommendation", "team-handoff"]'::jsonb,
    '["project_recommend", "intent_confirm", "team_handoff"]'::jsonb,
    '[]'::jsonb,
    '{"model": {"mode": "default", "value": "qwen3.8-flash"}, "permission": {"mode": "auto", "value": "supervised"}, "thought_level": {"mode": "high", "value": "balanced"}, "skills": {"mode": "custom", "value": ["socratic-intake", "intent-clarification", "project-recommendation", "team-handoff"]}, "mcps": {"mode": "default", "value": []}}'::jsonb,
    'online',
    true,
    now(),
    now()
)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    avatar = EXCLUDED.avatar,
    description = EXCLUDED.description,
    role = EXCLUDED.role,
    instructions = EXCLUDED.instructions,
    updated_at = now();

-- Bind tutor.chat usage to qwen-token-plan-cn / qwen3.8-flash
INSERT INTO model_usage_bindings (usage_id, provider_id, model_id, enabled, updated_by, updated_at, created_at)
VALUES ('tutor.chat', 'qwen-token-plan-cn', 'qwen3.8-flash', true, 'admin', now(), now())
ON CONFLICT (usage_id) DO UPDATE SET
    provider_id = 'qwen-token-plan-cn',
    model_id = 'qwen3.8-flash',
    enabled = true,
    updated_at = now();
