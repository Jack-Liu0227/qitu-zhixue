-- 启途智学 — admin AI 配置种子（助手 / 团队 / 团队成员）
--
-- 对应迁移 0019_admin_ai_config（admin_assistants / admin_teams / admin_team_members），
-- 为 admin 控制台设置页两张表提供**真实落库**的起点数据：
--   1. 4 个内置助手（tutor-leader / fighter-concept-coach / fighter-code-guide /
--      fighter-review-assessor），内容与 @qitu/ai-client 的 BUILTIN_ASSISTANTS 一致；
--      source='builtin' ⇒ 服务端读取时 deletable 恒为 false（不落库、不可删）。
--   2. 「雷霆战机小游戏 PBL 导师团队」，内容与 @qitu/ai-client 的
--      THUNDER_FIGHTER_TEAM_CONFIG 一致；pbl_spec 内 theoryMasteredGate=true、
--      concept_mastery 阶段门禁=TheoryMastered（服务端强门禁的种子基线）。
--
-- 幂等：可重复执行。固定 fixture 冲突时 DO UPDATE 恢复种子基线
--（admin 通过 API 的编辑会被重新种库覆盖回基线，与 domain-foundation.sql 的策略一致）；
-- 不含任何未成年人数据；updated_by 置空表示种子来源而非某个管理员。
--
-- ⚠️ 本文件的 `pbl_spec` 是**两个保留模板**的唯一编写面（配合 domain-foundation.sql
--    的 project_templates：template-thunder-fighter / template-kinetic-energy）。
--    但 `ON CONFLICT DO UPDATE SET pbl_spec = EXCLUDED.pbl_spec` 对管理员在后台
--    改过的 spec 是**破坏性**的，因此它**不是**对账手段，只是基线重放。
--    两边的漂移由 `PlatformRegistryService.reportPblTemplateDrift()` 在启动/首次读团队时
--    **只读比对并告警**（不写库、不抛错），避免出现「spec 通过校验、落库却换门禁」。
--    guided_practice 的门禁由**交付物**推导：runnable_python_game →
--    code_playable_run_verified；simulation_experiment_report → experiment_report_validated。
--    Skill 字段必须与 assistant-registry.ts 保持同一命名空间，否则种子重放会回写脏数据。
--
-- 执行顺序： assistants → teams → members（外键依赖）；seed.ts 已把本文件放在
-- SEED_FILES 最后，可手动执行：psql "$DATABASE_URL" -f database/seeds/admin-ai-config.sql

BEGIN;

-- 1. 内置助手（字段与 packages/ai-client/src/assistant-registry.ts 逐一对齐）
INSERT INTO admin_assistants
  (id, source, name, avatar, description, role, enabled, sort_order,
   model_provider_id, model_id, temperature, instructions,
   enabled_skills, tool_ids, mcp_server_ids, defaults,
   agent_status, team_selectable, updated_by, created_at, updated_at)
VALUES
  (
    'tutor-leader', 'builtin', '启途总导师', '👨‍🏫',
    '负责整体教学引导、苏格拉底式发问、阶段门禁把控与学生状态关注。',
    'Team Leader / 总导师', true, 1,
    'qwen-token-plan-cn', 'qwen3.8-flash', 0.7,
    '你是启途智学的总导师。坚持苏格拉底式提问，引导学生主动思考，不直接给出代码全貌。严格执行项目阶段流转逻辑，在学生未达成概念掌握前不推进至代码实践。',
    '["tutor-guided-learning"]'::jsonb,
    '["mastery_query","learning_plan_advance","student_profile_get"]'::jsonb,
    '[]'::jsonb,
    '{"model":{"mode":"default","value":"qwen3.8-flash"},"permission":{"mode":"auto","value":"supervised"},"thought_level":{"mode":"high","value":"balanced"},"skills":{"mode":"custom","value":["tutor-guided-learning"]},"mcps":{"mode":"default","value":[]}}'::jsonb,
    'online', true, NULL, '2026-10-01T00:00:00.000Z', '2026-10-09T00:00:00.000Z'
  ),
  (
    'fighter-concept-coach', 'builtin', '战机原理与概念教练', '🕹️',
    '负责游戏主循环、坐标系统、事件监听与几何碰撞检测等核心计算机及物理概念讲解。',
    'Concept Coach / 概念教练', true, 2,
    'qwen-token-plan-cn', 'qwen3.8-flash', 0.6,
    '参考启途多智能体互动课堂模式，用生活化比喻和启发式问题解释游戏运作原理（帧率刷新、坐标轴移动、矩形相交的数学逻辑）。检测学生是否真正掌握核心概念。',
    '["tutor-guided-learning"]'::jsonb,
    '["knowledge_search","mastery_assess"]'::jsonb,
    '[]'::jsonb,
    '{"model":{"mode":"default","value":"qwen3.8-flash"},"permission":{"mode":"auto","value":"supervised"},"thought_level":{"mode":"high","value":"balanced"},"skills":{"mode":"custom","value":["tutor-guided-learning"]},"mcps":{"mode":"default","value":[]}}'::jsonb,
    'online', true, NULL, '2026-10-01T00:00:00.000Z', '2026-10-09T00:00:00.000Z'
  ),
  (
    'fighter-code-guide', 'builtin', '战机架构与代码向导', '💻',
    '负责在 TheoryMastered 后指导学生拆解并编写 Pygame 战机、子弹与敌机模块。',
    'Code Guide / 架构向导', true, 3,
    'qwen-token-plan-cn', 'qwen3.8-flash', 0.5,
    '仅在理论通过后辅助学生实践。通过分层提示阶梯（Hint 1-5）引导学生自行敲出代码，指出语法错误与逻辑陷阱，避免给出直接全量复制粘贴的代码块。',
    '["tutor-guided-learning"]'::jsonb,
    '["code_syntax_check","step_validator"]'::jsonb,
    '[]'::jsonb,
    '{"model":{"mode":"default","value":"qwen3.8-flash"},"permission":{"mode":"auto","value":"supervised"},"thought_level":{"mode":"high","value":"balanced"},"skills":{"mode":"custom","value":["tutor-guided-learning"]},"mcps":{"mode":"default","value":[]}}'::jsonb,
    'online', true, NULL, '2026-10-01T00:00:00.000Z', '2026-10-09T00:00:00.000Z'
  ),
  (
    'fighter-review-assessor', 'builtin', '成果评审与答辩导师', '🏆',
    '负责学生雷霆战机作品的多维度代码评审、游戏体验测评、复盘反思引导与成长归档。',
    'Reviewer / 评审导师', true, 4,
    'qwen-token-plan-cn', 'qwen3.8-flash', 0.7,
    '主持作品答辩与成果评审。从代码规范度、游戏手感、扩展创意三个维度给予积极且具建设性的评价，引导学生总结调试心得并生成成长归档记录。',
    '["tutor-guided-learning"]'::jsonb,
    '["artifact_review","growth_record_append"]'::jsonb,
    '[]'::jsonb,
    '{"model":{"mode":"default","value":"qwen3.8-flash"},"permission":{"mode":"auto","value":"supervised"},"thought_level":{"mode":"high","value":"balanced"},"skills":{"mode":"custom","value":["tutor-guided-learning"]},"mcps":{"mode":"default","value":[]}}'::jsonb,
    'online', true, NULL, '2026-10-01T00:00:00.000Z', '2026-10-09T00:00:00.000Z'
  ),
  (
    'kinetic-leader', 'builtin', '动能定理总导师', '⚡',
    '负责动能定理物理探究流程把控、苏格拉底式发问、探究问题界定与阶段门禁把关。',
    'Team Leader / 物理总导师', true, 5,
    'qwen-token-plan-cn', 'qwen3.8-flash', 0.7,
    '你是动能定理物理探究项目的总导师。引导学生从生活情境（刹车距离、重物下落）提出探究假设。严格遵守阶段门禁：学生未掌握功的定义与动能表达式前不得进入仿真实验阶段。',
    '["tutor-guided-learning"]'::jsonb,
    '["mastery_query","learning_plan_advance","student_profile_get"]'::jsonb,
    '[]'::jsonb,
    '{"model":{"mode":"default","value":"qwen3.8-flash"},"permission":{"mode":"auto","value":"supervised"},"thought_level":{"mode":"high","value":"balanced"},"skills":{"mode":"custom","value":["tutor-guided-learning"]},"mcps":{"mode":"default","value":[]}}'::jsonb,
    'online', true, NULL, '2026-10-01T00:00:00.000Z', '2026-10-09T00:00:00.000Z'
  ),
  (
    'kinetic-concept-coach', 'builtin', '功与动能概念教练', '📐',
    '负责合外力做功、动能概念公式推导、标量乘积与微积分微元思想透彻解析。',
    'Concept Coach / 概念教练', true, 6,
    'qwen-token-plan-cn', 'qwen3.8-flash', 0.6,
    '运用启发式教学，通过恒力做功、变力做功微元法和动能定理数学推导，帮助学生透彻理解合外力做功等于动能变化量的物理实质。',
    '["tutor-guided-learning"]'::jsonb,
    '["knowledge_search","mastery_assess"]'::jsonb,
    '[]'::jsonb,
    '{"model":{"mode":"default","value":"qwen3.8-flash"},"permission":{"mode":"auto","value":"supervised"},"thought_level":{"mode":"high","value":"balanced"},"skills":{"mode":"custom","value":["tutor-guided-learning"]},"mcps":{"mode":"default","value":[]}}'::jsonb,
    'online', true, NULL, '2026-10-01T00:00:00.000Z', '2026-10-09T00:00:00.000Z'
  ),
  (
    'kinetic-experiment-guide', 'builtin', '动能定理仿真与实验向导', '🔬',
    '负责在 TheoryMastered 后指导学生设计倾斜轨道、光电门测速仿真实验与数据拟合。',
    'Experiment Guide / 仿真向导', true, 7,
    'qwen-token-plan-cn', 'qwen3.8-flash', 0.5,
    '仅在理论掌握后引导学生进入实验。指导学生在虚拟仿真或代码中配置小车质量、轨道倾角、摩擦系数，记录拉力与光电门速度数据，验证合力做功等于动能变化量。',
    '["tutor-guided-learning"]'::jsonb,
    '["simulation_runner","data_analyzer"]'::jsonb,
    '[]'::jsonb,
    '{"model":{"mode":"default","value":"qwen3.8-flash"},"permission":{"mode":"auto","value":"supervised"},"thought_level":{"mode":"high","value":"balanced"},"skills":{"mode":"custom","value":["tutor-guided-learning"]},"mcps":{"mode":"default","value":[]}}'::jsonb,
    'online', true, NULL, '2026-10-01T00:00:00.000Z', '2026-10-09T00:00:00.000Z'
  ),
  (
    'kinetic-review-assessor', 'builtin', '物理探究答辩与评审导师', '🎖️',
    '负责实验误差分析、探究报告综合评审、生活迁移反思与成长归档。',
    'Reviewer / 评审导师', true, 8,
    'qwen-token-plan-cn', 'qwen3.8-flash', 0.7,
    '主持动能定理探究成果评审。从实验严谨性、误差分析（空气阻力、摩擦力测量偏差）、物理规律理解与知识迁移四个维度综合评审，生成物理核心素养成长归档。',
    '["tutor-guided-learning"]'::jsonb,
    '["artifact_review","growth_record_append"]'::jsonb,
    '[]'::jsonb,
    '{"model":{"mode":"default","value":"qwen3.8-flash"},"permission":{"mode":"auto","value":"supervised"},"thought_level":{"mode":"high","value":"balanced"},"skills":{"mode":"custom","value":["tutor-guided-learning"]},"mcps":{"mode":"default","value":[]}}'::jsonb,
    'online', true, NULL, '2026-10-01T00:00:00.000Z', '2026-10-09T00:00:00.000Z'
  ),
  (
    'profile-analyst-assistant', 'builtin', '学情画像分析助手', '📊',
    '负责综合研判学生概念掌握度、尝试次数、认知盲区及五维能力雷达，支持班主任隔离读取。',
    'Profile Analyst / 学情画像分析导师', true, 9,
    'qwen-token-plan-cn', 'qwen3.8-flash', 0.5,
    '你是学情画像分析导师。根据学生在各阶段的学习交互记录，客观评估其概念理解、逻辑推理、实践编码、反思复盘、迁移创新五维素养雷达。严格遵守班级数据隔离原则，只读取与研判当前班主任所属学生的学情档案。',
    '[]'::jsonb,
    '["student_profile_get","mastery_query","radar_synthesizer","competency_evaluation"]'::jsonb,
    '[]'::jsonb,
    '{"model":{"mode":"default","value":"qwen3.8-flash"},"permission":{"mode":"auto","value":"supervised"},"thought_level":{"mode":"high","value":"balanced"},"skills":{"mode":"custom","value":[]},"mcps":{"mode":"default","value":[]}}'::jsonb,
    'online', true, NULL, '2026-10-01T00:00:00.000Z', '2026-10-13T00:00:00.000Z'
  ),
  (
    'growth-trajectory-assistant', 'builtin', '成长轨迹生成助手', '📈',
    '负责聚合关键里程碑成果、项目验收证书、答辩记录与导师评语，生成纵向成长时间轴与综合能力报告。',
    'Growth Trajectory Mentor / 成长轨迹导师', true, 10,
    'qwen-token-plan-cn', 'qwen3.8-flash', 0.6,
    '你是成长轨迹生成导师。基于学生历次 PBL 项目的交付物与答辩评估，梳理阶段性突破与能力进阶关键事件，生成可审计的纵向成长时间轴与多维能力进阶趋势。',
    '[]'::jsonb,
    '["growth_record_append","timeline_generator","milestone_auditor","narrative_summary"]'::jsonb,
    '[]'::jsonb,
    '{"model":{"mode":"default","value":"qwen3.8-flash"},"permission":{"mode":"auto","value":"supervised"},"thought_level":{"mode":"high","value":"balanced"},"skills":{"mode":"custom","value":[]},"mcps":{"mode":"default","value":[]}}'::jsonb,
    'online', true, NULL, '2026-10-01T00:00:00.000Z', '2026-10-13T00:00:00.000Z'
  ),
  (
    'qitu-assistant', 'builtin', '启途智学管家', '🏛️',
    '管理后台专属平台管家，负责智能辅助管理员实现助手、团队、MCP、Skill、工具、模板库、知识库的集中创建、配置变更与治理审计。',
    'Platform Copilot / 平台管家', true, 11,
    'qwen-token-plan-cn', 'qwen3.8-flash', 0.7,
    '你是启途智学管家，负责在平台管理控制台（Admin）中协助管理员进行 AI 助手、PBL 导师团队、MCP 工具服务、教学技能库、项目模板与核心知识库的统一创建、治理与全生命周期管理。提供专业、规范的平台资产治理指导，维护权限隔离与系统安全性。',
    '[]'::jsonb,
    '["assistant_manage","team_manage","mcp_manage","skill_manage","template_manage"]'::jsonb,
    '[]'::jsonb,
    '{"model":{"mode":"default","value":"qwen3.8-flash"},"permission":{"mode":"auto","value":"supervised"},"thought_level":{"mode":"high","value":"balanced"},"skills":{"mode":"custom","value":[]},"mcps":{"mode":"default","value":[]}}'::jsonb,
    'online', true, NULL, '2026-10-01T00:00:00.000Z', '2026-10-13T00:00:00.000Z'
  ),
  (
    'qitu-intake-assistant', 'builtin', '启途智学助手', '🧭',
    '学生进入平台后对话的第一位 AI 搭档。负责用苏格拉底式提问确认学生的兴趣与意图，推荐合适的项目方向并完成一句话交接。',
    'Intake Guide / 启途智学助手', true, 12,
    'qwen-token-plan-cn', 'qwen3.8-flash', 0.7,
    '你是启途智学助手，是每个学生进入平台后对话的第一位 AI 搭档。你的唯一职责是用苏格拉底式提问确认学生的兴趣与学习意图：先问他/她对什么感兴趣、想解决什么问题、想做出什么作品，再据此推荐一个最合适的项目方向并说明推荐理由。推荐阶段严格遵守「学生未确认意图不得创建正式项目」：只能推荐和澄清，不能声称项目已经建好，也不能替学生确认。学生明确确认项目后，把学习接力给对应的 PBL 导师团队，只做一句话交接，不代替团队教学。全程不直接给出答案或完整代码，不在 TheoryMastered 之前推进实践阶段。',
    '["tutor-guided-learning"]'::jsonb,
    '["project_recommend","intent_confirm","team_handoff"]'::jsonb,
    '[]'::jsonb,
    '{"model":{"mode":"default","value":"qwen3.8-flash"},"permission":{"mode":"auto","value":"supervised"},"thought_level":{"mode":"high","value":"balanced"},"skills":{"mode":"custom","value":["tutor-guided-learning"]},"mcps":{"mode":"default","value":[]}}'::jsonb,
    'online', true, NULL, '2026-10-01T00:00:00.000Z', '2026-10-13T00:00:00.000Z'
  )
ON CONFLICT (id) DO UPDATE SET
  source = EXCLUDED.source,
  name = EXCLUDED.name,
  avatar = EXCLUDED.avatar,
  description = EXCLUDED.description,
  role = EXCLUDED.role,
  enabled = EXCLUDED.enabled,
  sort_order = EXCLUDED.sort_order,
  model_provider_id = EXCLUDED.model_provider_id,
  model_id = EXCLUDED.model_id,
  temperature = EXCLUDED.temperature,
  instructions = EXCLUDED.instructions,
  enabled_skills = EXCLUDED.enabled_skills,
  tool_ids = EXCLUDED.tool_ids,
  mcp_server_ids = EXCLUDED.mcp_server_ids,
  defaults = EXCLUDED.defaults,
  agent_status = EXCLUDED.agent_status,
  team_selectable = EXCLUDED.team_selectable,
  updated_at = EXCLUDED.updated_at;

-- 2. 雷霆战机 PBL 导师团队（与 THUNDER_FIGHTER_TEAM_CONFIG 对齐）
INSERT INTO admin_teams
  (id, name, description, workspace_mode, session_mode, leader_assistant_id,
   concurrency_limit, pbl_spec, enabled, updated_by, created_at, updated_at)
VALUES
  (
    'team-thunder-fighter-pbl',
    '雷霆战机小游戏 PBL 导师团队',
    '面向雷霆战机小游戏设计的专属多智能体协同导师团队。融合启途互动课堂理念，引导学生完成从兴趣启发、概念探索、代码构建到作品答辩的全流程。',
    'shared', 'supervised', 'tutor-leader',
    2,
    $pbl${
      "projectId": "pbl-thunder-fighter",
      "projectName": "雷霆战机：从零打造 Python 飞行射击小游戏",
      "targetDomain": "programming_game_dev",
      "phases": [
        {
          "phase": "exploration",
          "title": "阶段一：项目兴趣启发与意图确认",
          "assignedAssistantId": "tutor-leader",
          "assignedRoleLabel": "总导师",
          "learningObjectives": [
            "明确雷霆战机小游戏的玩法目标与核心规则",
            "确认开发技术栈（Python 3 与 Pygame 库）",
            "学生主动确认项目开发意图并生成项目草案"
          ],
          "gateCondition": "student_confirmed_intent",
          "deliverableType": "project_intent_doc"
        },
        {
          "phase": "concept_mastery",
          "title": "阶段二：核心原理探索与概念掌握（启途互动课堂）",
          "assignedAssistantId": "fighter-concept-coach",
          "assignedRoleLabel": "原理教练",
          "learningObjectives": [
            "掌握游戏循环机制（事件监听 -> 状态更新 -> 画面渲染）",
            "掌握屏幕笛卡尔坐标系统与边界限制算法",
            "理解键盘事件流（KEY_DOWN / KEY_UP）与速度向量",
            "掌握矩形相交（AABB 碰撞检测）的几何数学逻辑"
          ],
          "gateCondition": "TheoryMastered",
          "deliverableType": "mastery_checkpoint_report"
        },
        {
          "phase": "guided_practice",
          "title": "阶段三：战机架构拆解与代码构建实践",
          "assignedAssistantId": "fighter-code-guide",
          "assignedRoleLabel": "代码向导",
          "learningObjectives": [
            "构建 Pygame 主窗口与核心帧率时钟（Clock）",
            "面向对象封装玩家战机类（Player Sprite）并绑定按键位移",
            "实现子弹精灵组（Bullet Group）与按键连续发射机制",
            "实现敌机生成器（Enemy Spawner）与随机下落算法",
            "实现子弹击中敌机判定与得分/生命值 HUD 界面"
          ],
          "gateCondition": "code_playable_run_verified",
          "deliverableType": "runnable_python_game",
          "evidenceProfile": "runnable_code"
        },
        {
          "phase": "deliverable_review",
          "title": "阶段四：作品答辩评审与反思成长归档",
          "assignedAssistantId": "fighter-review-assessor",
          "assignedRoleLabel": "评审导师",
          "learningObjectives": [
            "完成代码规范性、可读性与结构性自查",
            "多维度作品评价（完成度、交互手感、创意加分项）",
            "针对开发调试中遭遇的 Bug 进行技术复盘",
            "生成个人项目成长档案并提交至班主任与家长端"
          ],
          "gateCondition": "review_completed_and_archived",
          "deliverableType": "growth_archive_record"
        }
      ],
      "theoryMasteredGate": true,
      "allowAutonomousAdvance": false
    }$pbl$::jsonb,
    true, NULL, '2026-10-01T00:00:00.000Z', '2026-10-09T00:00:00.000Z'
  ),
  (
    'team-kinetic-energy-pbl',
    '动手学动能定理 PBL 导师团队',
    '面向高中物理探究与动能定理虚拟仿真设计的专属多智能体协同导师团队。引导学生从生活情境发问、功与动能微元推导、轨道实验仿真验证到答辩反思归档。',
    'shared', 'supervised', 'kinetic-leader',
    2,
    $pbl${
      "projectId": "pbl-kinetic-energy",
      "projectName": "动手学动能定理：物理虚拟仿真与规律探究",
      "targetDomain": "physics_mechanics",
      "phases": [
        {
          "phase": "exploration",
          "title": "阶段一：生活情境启发与探究课题确认",
          "assignedAssistantId": "kinetic-leader",
          "assignedRoleLabel": "物理总导师",
          "learningObjectives": [
            "观察汽车刹车滑行距离与车速关系，提出物理假设",
            "明确动能定理探究目标与实验自变量、因变量",
            "学生主动确认探究课题并生成探究意向书"
          ],
          "gateCondition": "student_confirmed_intent",
          "deliverableType": "project_intent_doc"
        },
        {
          "phase": "concept_mastery",
          "title": "阶段二：功与动能核心概念探索与定理推导",
          "assignedAssistantId": "kinetic-concept-coach",
          "assignedRoleLabel": "概念教练",
          "learningObjectives": [
            "理解恒力做功数学表达式 W = F·s·cosθ 与变力做功微元累加",
            "理解动能概念与 Ek = 1/2 m v^2 推导过程",
            "掌握合外力做功与动能变化量关系 W_合 = ΔEk 的物理意义",
            "通过典型力学场景概念闯关测试"
          ],
          "gateCondition": "TheoryMastered",
          "deliverableType": "mastery_checkpoint_report"
        },
        {
          "phase": "guided_practice",
          "title": "阶段三：倾斜轨道仿真实验与数据规律验证",
          "assignedAssistantId": "kinetic-experiment-guide",
          "assignedRoleLabel": "仿真向导",
          "learningObjectives": [
            "在虚拟仿真环境中配置小车质量、轨道倾角与摩擦阻力",
            "使用虚拟光电门采集两点速度并计算动能变化量",
            "计算重力与摩擦力做功代数和并绘制 W-ΔEk 散点图",
            "拟合数据直线验证动能定理，误差控制在 5% 以内"
          ],
          "gateCondition": "experiment_report_validated",
          "deliverableType": "simulation_experiment_report",
          "evidenceProfile": "experiment_report"
        },
        {
          "phase": "deliverable_review",
          "title": "阶段四：实验误差分析、答辩评审与素养归档",
          "assignedAssistantId": "kinetic-review-assessor",
          "assignedRoleLabel": "评审导师",
          "learningObjectives": [
            "深入分析系统误差与偶然误差来源（光电门遮光条宽度、摩擦力测量）",
            "撰写完整科学探究报告并进行线上答辩陈述",
            "探讨动能定理在工程减速缓冲装置中的生活迁移应用",
            "生成物理核心素养与科学探究能力成长档案"
          ],
          "gateCondition": "review_completed_and_archived",
          "deliverableType": "growth_archive_record"
        }
      ],
      "theoryMasteredGate": true,
      "allowAutonomousAdvance": false
    }$pbl$::jsonb,
    true, NULL, '2026-10-01T00:00:00.000Z', '2026-10-09T00:00:00.000Z'
  )
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  workspace_mode = EXCLUDED.workspace_mode,
  session_mode = EXCLUDED.session_mode,
  leader_assistant_id = EXCLUDED.leader_assistant_id,
  concurrency_limit = EXCLUDED.concurrency_limit,
  pbl_spec = EXCLUDED.pbl_spec,
  enabled = EXCLUDED.enabled,
  updated_at = EXCLUDED.updated_at;

-- 3. 团队成员（雷霆战机团队与动手学动能定理团队）
INSERT INTO admin_team_members
  (slot_id, team_id, assistant_id, role, role_label, model, color, pbl_phase, status, sort_order, created_at, updated_at)
VALUES
  ('slot-leader',          'team-thunder-fighter-pbl', 'tutor-leader',            'leader',   '总导师 (流程推进与意图把控)',          'qwen3.8-flash', 'var(--brand)', 'exploration',        'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-09T00:00:00.000Z'),
  ('slot-concept',         'team-thunder-fighter-pbl', 'fighter-concept-coach',   'coach',    '概念教练 (核心原理解析)',      'qwen3.8-flash', '#5c9ea4',      'concept_mastery',    'idle',   2, '2026-10-01T00:00:00.000Z', '2026-10-09T00:00:00.000Z'),
  ('slot-code',            'team-thunder-fighter-pbl', 'fighter-code-guide',      'teammate', '代码向导 (Pygame 分步阶梯实践)',        'qwen3.8-flash', '#b58a5e',      'guided_practice',    'idle',   3, '2026-10-01T00:00:00.000Z', '2026-10-09T00:00:00.000Z'),
  ('slot-review',          'team-thunder-fighter-pbl', 'fighter-review-assessor', 'reviewer', '评审导师 (代码自评与成长归档)',          'qwen3.8-flash', '#9481bf',      'deliverable_review', 'idle',   4, '2026-10-01T00:00:00.000Z', '2026-10-09T00:00:00.000Z'),
  ('slot-kinetic-leader',  'team-kinetic-energy-pbl',  'kinetic-leader',          'leader',   '物理总导师 (探究引导与门禁把控)',      'qwen3.8-flash', 'var(--brand)', 'exploration',        'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-09T00:00:00.000Z'),
  ('slot-kinetic-concept', 'team-kinetic-energy-pbl',  'kinetic-concept-coach',   'coach',    '概念教练 (功与动能微元推导)',          'qwen3.8-flash', '#2563eb',      'concept_mastery',    'idle',   2, '2026-10-01T00:00:00.000Z', '2026-10-09T00:00:00.000Z'),
  ('slot-kinetic-guide',   'team-kinetic-energy-pbl',  'kinetic-experiment-guide','teammate', '仿真向导 (轨道实验与数据拟合)',        'qwen3.8-flash', '#0d9488',      'guided_practice',    'idle',   3, '2026-10-01T00:00:00.000Z', '2026-10-09T00:00:00.000Z'),
  ('slot-kinetic-review',  'team-kinetic-energy-pbl',  'kinetic-review-assessor', 'reviewer', '评审导师 (误差分析与探究归档)',        'qwen3.8-flash', '#7c3aed',      'deliverable_review', 'idle',   4, '2026-10-01T00:00:00.000Z', '2026-10-09T00:00:00.000Z')
ON CONFLICT (slot_id) DO UPDATE SET
  team_id = EXCLUDED.team_id,
  assistant_id = EXCLUDED.assistant_id,
  role = EXCLUDED.role,
  role_label = EXCLUDED.role_label,
  model = EXCLUDED.model,
  color = EXCLUDED.color,
  pbl_phase = EXCLUDED.pbl_phase,
  status = EXCLUDED.status,
  sort_order = EXCLUDED.sort_order,
  updated_at = EXCLUDED.updated_at;

COMMIT;

