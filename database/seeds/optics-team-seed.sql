-- 启途智学 — 物理光学探究 PBL 导师团队与助手种子
BEGIN;

-- 1. 光学 PBL 内置助手
INSERT INTO admin_assistants
  (id, source, name, avatar, description, role, enabled, sort_order,
   model_provider_id, model_id, temperature, instructions,
   enabled_skills, tool_ids, mcp_server_ids, defaults,
   agent_status, team_selectable, updated_by, created_at, updated_at)
VALUES
  (
    'optics-leader', 'builtin', '光学探究总导师', '🌈',
    '负责物理光学探究全流程把控、生活情境启发、探究课题界定与阶段门禁把关。',
    'Team Leader / 物理总导师', true, 13,
    'deepseek', 'deepseek-flash', 0.7,
    '你是物理光学探究项目的总导师。坚持苏格拉底式发问，引导学生从日常生活中的光影现象（彩虹、水面折射、雾中光束与窄缝衍射条纹）出发，提出关于光的本质、传播规律与波动特性的物理问题。在学生未达成概念掌握前，不推进至实验实践阶段。',
    '["tutor-guided-learning"]'::jsonb,
    '["mastery_query","learning_plan_advance","student_profile_get"]'::jsonb,
    '[]'::jsonb,
    '{"model":{"mode":"default","value":"qwen3.8-flash"},"permission":{"mode":"auto","value":"supervised"},"thought_level":{"mode":"high","value":"balanced"},"skills":{"mode":"custom","value":["tutor-guided-learning"]},"mcps":{"mode":"default","value":[]}}'::jsonb,
    'online', true, NULL, NOW(), NOW()
  ),
  (
    'optics-concept-coach', 'builtin', '光学原理与概念教练', '🔦',
    '负责光的反射定律、折射定律与折射率、全反射临界角及透镜成像规律解析与概念闯关。',
    'Concept Coach / 概念教练', true, 14,
    'deepseek', 'deepseek-flash', 0.6,
    '运用启发式教学，通过生活现象（筷子在水中折断、水底看起来变浅、光纤传光）结合数学公式与作图法，引导学生深刻理解反射定律、折射定律 n = c/v = sinθ₁/sinθ₂、全反射临界角 sinC = 1/n 与凸透镜成像规律。通过测试检验学生理解，在 TheoryMastered 之前严格把关。',
    '["tutor-guided-learning"]'::jsonb,
    '["knowledge_search","mastery_assess"]'::jsonb,
    '[]'::jsonb,
    '{"model":{"mode":"default","value":"deepseek-flash"},"permission":{"mode":"auto","value":"supervised"},"thought_level":{"mode":"high","value":"balanced"},"skills":{"mode":"custom","value":["tutor-guided-learning"]},"mcps":{"mode":"default","value":[]}}'::jsonb,
    'online', true, NULL, NOW(), NOW()
  ),
  (
    'optics-experiment-guide', 'builtin', '光学仿真与实验向导', '🔬',
    '负责在 TheoryMastered 后指导学生搭建光路、进行单缝衍射图样分析与介质微粒散射仿真探究。',
    'Experiment Guide / 仿真向导', true, 15,
    'deepseek', 'deepseek-flash', 0.5,
    '仅在理论概念掌握（TheoryMastered）后开放实验工具。指导学生在光的散射与衍射动态探究台（OpticsDiffractionScatteringCard）中调节激光波长 λ、狭缝宽度 a、光屏距离 D 与介质微粒半径 r，观察衍射中央亮纹宽度变化与瑞利散射波长依赖性，采集数据并完成探究实验报告。',
    '["tutor-guided-learning"]'::jsonb,
    '["simulation_runner","data_analyzer"]'::jsonb,
    '[]'::jsonb,
    '{"model":{"mode":"default","value":"qwen3.8-flash"},"permission":{"mode":"auto","value":"supervised"},"thought_level":{"mode":"high","value":"balanced"},"skills":{"mode":"custom","value":["tutor-guided-learning"]},"mcps":{"mode":"default","value":[]}}'::jsonb,
    'online', true, NULL, NOW(), NOW()
  ),
  (
    'optics-review-assessor', 'builtin', '光学探究答辩与评审导师', '🎖️',
    '负责光学实验报告审查、CER 证据链核验、线上答辩评审与物理学科核心素养成长归档。',
    'Reviewer / 评审导师', true, 16,
    'deepseek', 'deepseek-flash', 0.7,
    '主持物理光学探究答辩评审。从实验数据真实性、误差分析（单缝衍射中央亮纹边界判定、环境杂散光影响）、CER 科学论证结构（主张-证据-推理）与生活应用迁移四个维度综合评审，生成物理学科核心素养成长归档。',
    '["tutor-guided-learning"]'::jsonb,
    '["artifact_review","growth_record_append"]'::jsonb,
    '[]'::jsonb,
    '{"model":{"mode":"default","value":"qwen3.8-flash"},"permission":{"mode":"auto","value":"supervised"},"thought_level":{"mode":"high","value":"balanced"},"skills":{"mode":"custom","value":["tutor-guided-learning"]},"mcps":{"mode":"default","value":[]}}'::jsonb,
    'online', true, NULL, NOW(), NOW()
  )
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  avatar = EXCLUDED.avatar,
  description = EXCLUDED.description,
  role = EXCLUDED.role,
  enabled = EXCLUDED.enabled,
  model_provider_id = EXCLUDED.model_provider_id,
  model_id = EXCLUDED.model_id,
  instructions = EXCLUDED.instructions,
  enabled_skills = EXCLUDED.enabled_skills,
  tool_ids = EXCLUDED.tool_ids,
  updated_at = NOW();

-- 2. 物理光学探究 PBL 导师团队
INSERT INTO admin_teams
  (id, name, description, workspace_mode, session_mode, leader_assistant_id,
   concurrency_limit, pbl_spec, enabled, updated_by, created_at, updated_at)
VALUES
  (
    'team-optics-inquiry',
    '探究光的路径：从反射定律到透镜成像 PBL 导师团队',
    '面向物理光学探究、单缝衍射与介质散射实验设计的专属多智能体协同导师团队。引导学生从生活情境发问、光学核心定律推导、动态仿真验证到答辩反思归档。',
    'shared', 'supervised', 'optics-concept-coach',
    2,
    $pbl${
      "projectId": "pbl-optics-inquiry",
      "projectName": "探究光的路径：从反射定律到透镜成像",
      "targetDomain": "physics_optics",
      "phases": [
        {
          "phase": "exploration",
          "title": "阶段一：生活情境启发与探究课题确认",
          "assignedAssistantId": "qitu-intake-assistant",
          "assignedRoleLabel": "物理总导师",
          "learningObjectives": [
            "观察生活中的光影现象（彩虹、水面折射、雾中光束与窄缝衍射条纹），提出物理问题",
            "明确光学探究目标与实验自变量、因变量",
            "学生主动确认探究课题并生成探究意向书"
          ],
          "gateCondition": "student_confirmed_intent",
          "deliverableType": "project_intent_doc"
        },
        {
          "phase": "concept_mastery",
          "title": "阶段二：光学核心定律探索与概念掌握",
          "assignedAssistantId": "optics-concept-coach",
          "assignedRoleLabel": "概念教练",
          "learningObjectives": [
            "理解光的反射定律与平面镜成像规律",
            "掌握折射定律与折射率概念及数学表达",
            "理解光的全反射条件与临界角计算",
            "掌握透镜成像作图法则与物像规律"
          ],
          "gateCondition": "TheoryMastered",
          "deliverableType": "mastery_checkpoint_report"
        },
        {
          "phase": "guided_practice",
          "title": "阶段三：光路搭建、数据采集与规律拟合",
          "assignedAssistantId": "optics-experiment-guide",
          "assignedRoleLabel": "仿真向导",
          "learningObjectives": [
            "在单缝衍射仿真中调节狭缝宽度与波长，观察中央明纹与暗纹变化",
            "在介质散射仿真中观察微粒半径与波长对散射光强的影响",
            "采集光路与光强数据，拟合物理规律",
            "撰写探究实验报告并进行数据合规性校验"
          ],
          "gateCondition": "experiment_report_validated",
          "deliverableType": "simulation_experiment_report",
          "evidenceProfile": "experiment_report"
        },
        {
          "phase": "deliverable_review",
          "title": "阶段四：答辩评审与反思成长归档",
          "assignedAssistantId": "optics-review-assessor",
          "assignedRoleLabel": "评审导师",
          "learningObjectives": [
            "深入分析系统误差与偶然误差来源（中央条纹边界判定、环境杂散光）",
            "撰写完整科学探究报告并进行线上答辩陈述",
            "探讨光的波粒二象性及光纤通信等现实技术应用",
            "生成物理核心素养与科学探究能力成长档案"
          ],
          "gateCondition": "review_completed_and_archived",
          "deliverableType": "growth_archive_record"
        }
      ],
      "theoryMasteredGate": true,
      "allowAutonomousAdvance": false
    }$pbl$::jsonb,
    true, NULL, NOW(), NOW()
  )
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  leader_assistant_id = EXCLUDED.leader_assistant_id,
  pbl_spec = EXCLUDED.pbl_spec,
  enabled = EXCLUDED.enabled,
  updated_at = NOW();

-- 3. 团队成员配置 (slot_id, team_id, assistant_id, role, role_label, model, color, pbl_phase, status, sort_order)
DELETE FROM admin_team_members WHERE team_id = 'team-optics-inquiry';
INSERT INTO admin_team_members
  (slot_id, team_id, assistant_id, role, role_label, model, color, pbl_phase, status, sort_order, created_at, updated_at)
VALUES
  ('slot-optics-leader', 'team-optics-inquiry', 'optics-leader', 'leader', '物理总导师 (情境启发与意向确认)', 'deepseek-flash', 'var(--brand)', 'exploration', 'idle', 0, NOW(), NOW()),
  ('slot-optics-concept', 'team-optics-inquiry', 'optics-concept-coach', 'coach', '概念教练 (光学定律与透镜成像)', 'deepseek-flash', '#2563eb', 'concept_mastery', 'idle', 1, NOW(), NOW()),
  ('slot-optics-guide', 'team-optics-inquiry', 'optics-experiment-guide', 'teammate', '仿真向导 (散射衍射光路搭建)', 'deepseek-flash', '#0d9488', 'guided_practice', 'idle', 2, NOW(), NOW()),
  ('slot-optics-review', 'team-optics-inquiry', 'optics-review-assessor', 'reviewer', '评审导师 (CER答辩与素养归档)', 'deepseek-flash', '#7c3aed', 'deliverable_review', 'idle', 3, NOW(), NOW());

-- 4. 团队版本快照（作为绑定目标）
INSERT INTO admin_team_versions
  (id, team_id, version, name, description, workspace_mode, session_mode, leader_assistant_id, members, pbl_spec, enabled, created_by, created_at)
VALUES
  (
    'tv-optics-1',
    'team-optics-inquiry',
    1,
    '探究光的路径：从反射定律到透镜成像 导师团队 v1',
    '物理光学探究导师团队初始稳定版本',
    'shared',
    'supervised',
    'optics-concept-coach',
    '[
      {"assistantId": "optics-leader", "roleLabel": "物理总导师", "phaseScope": "exploration"},
      {"assistantId": "optics-concept-coach", "roleLabel": "概念教练", "phaseScope": "concept_mastery"},
      {"assistantId": "optics-experiment-guide", "roleLabel": "仿真向导", "phaseScope": "guided_practice"},
      {"assistantId": "optics-review-assessor", "roleLabel": "评审导师", "phaseScope": "deliverable_review"}
    ]'::jsonb,
    $pbl${
      "projectId": "pbl-optics-inquiry",
      "projectName": "探究光的路径：从反射定律到透镜成像",
      "targetDomain": "physics_optics",
      "phases": [
        {
          "phase": "exploration",
          "title": "阶段一：生活情境启发与探究课题确认",
          "assignedAssistantId": "qitu-intake-assistant",
          "assignedRoleLabel": "物理总导师",
          "learningObjectives": [
            "观察生活中的光影现象（彩虹、水面折射、雾中光束与窄缝衍射条纹），提出物理问题",
            "明确光学探究目标与实验自变量、因变量",
            "学生主动确认探究课题并生成探究意向书"
          ],
          "gateCondition": "student_confirmed_intent",
          "deliverableType": "project_intent_doc"
        },
        {
          "phase": "concept_mastery",
          "title": "阶段二：光学核心定律探索与概念掌握",
          "assignedAssistantId": "optics-concept-coach",
          "assignedRoleLabel": "概念教练",
          "learningObjectives": [
            "理解光的反射定律与平面镜成像规律",
            "掌握折射定律与折射率概念及数学表达",
            "理解光的全反射条件与临界角计算",
            "掌握透镜成像作图法则与物像规律"
          ],
          "gateCondition": "TheoryMastered",
          "deliverableType": "mastery_checkpoint_report"
        },
        {
          "phase": "guided_practice",
          "title": "阶段三：光路搭建、数据采集与规律拟合",
          "assignedAssistantId": "optics-experiment-guide",
          "assignedRoleLabel": "仿真向导",
          "learningObjectives": [
            "在单缝衍射仿真中调节狭缝宽度与波长，观察中央明纹与暗纹变化",
            "在介质散射仿真中观察微粒半径与波长对散射光强的影响",
            "采集光路与光强数据，拟合物理规律",
            "撰写探究实验报告并进行数据合规性校验"
          ],
          "gateCondition": "experiment_report_validated",
          "deliverableType": "simulation_experiment_report",
          "evidenceProfile": "experiment_report"
        },
        {
          "phase": "deliverable_review",
          "title": "阶段四：答辩评审与反思成长归档",
          "assignedAssistantId": "optics-review-assessor",
          "assignedRoleLabel": "评审导师",
          "learningObjectives": [
            "深入分析系统误差与偶然误差来源（中央条纹边界判定、环境杂散光）",
            "撰写完整科学探究报告并进行线上答辩陈述",
            "探讨光的波粒二象性及光纤通信等现实技术应用",
            "生成物理核心素养与科学探究能力成长档案"
          ],
          "gateCondition": "review_completed_and_archived",
          "deliverableType": "growth_archive_record"
        }
      ],
      "theoryMasteredGate": true,
      "allowAutonomousAdvance": false
    }$pbl$::jsonb,
    true,
    'admin-1',
    NOW()
  )
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  leader_assistant_id = EXCLUDED.leader_assistant_id,
  members = EXCLUDED.members,
  pbl_spec = EXCLUDED.pbl_spec,
  enabled = EXCLUDED.enabled;

COMMIT;
