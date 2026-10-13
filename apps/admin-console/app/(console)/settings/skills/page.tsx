'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchAdminAssistantConfigs } from '../../../../lib/api/assistants';
import { persistAssistantBinding } from '../../../../lib/api/assistantBindings';
import type { AdminAssistantConfig } from '@qitu/contracts';

interface SkillFile {
  name: string;
  sizeBytes: number;
  content: string;
}

interface SkillItem {
  id: string;
  name: string;
  description: string;
  tags: string[];
  filesCount: number;
  addedBy: string;
  updatedAtText: string;
  boundAssistantIds: string[];
  files: SkillFile[];
}

const DEFAULT_FILES_FOR_SKILL: Record<string, SkillFile[]> = {
  'tutor-guided-learning': [
    {
      name: 'SKILL.md',
      sizeBytes: 4200,
      content: `# Tutor Guided Learning (苏格拉底短轮次启发学习规范)

## 技能定位与核心目标
本技能定义启途智学全平台 PBL 智能体在面对学生提问时的教学互动范式。
核心指导理念为：**启发思考而非替代操作；拆解概念而非倾倒答案。**

## 核心交互铁律 (Hard Constraints)
1. **绝对禁令**：严禁在单次回复中直接提供超过 5 行的完整实现代码。
2. **渐进支架 (Scaffolding)**：
   - 第 1 轮：确认意图，提炼核心概念障碍，抛出 1 个反问。
   - 第 2 轮：若学生仍困惑，提供局部伪代码或错误示范比对。
   - 第 3 轮：引导学生自主指出错误根源并给出修改尝试。
3. **理论门禁 (TheoryMastered)**：
   - 在学生进入实践编码阶段前，必须经由原理教练确认其掌握核心物理/数学公式。

## 适用角色与触发阶段
- **适用智能体**：总负责人 (Leader)、原理教练 (Coach)、代码向导 (Teammate)。
- **触发条件**：学生提问包含“怎么写”、“报错了”、“直接给我代码”等求助句式。
`,
    },
    {
      name: 'prompts/instruction.txt',
      sizeBytes: 1820,
      content: `[SYSTEM TUTOR CONTRACT]
Role: Socratic Mentor Agent
Mode: Conversational & Inquisitive
Tone: Encouraging, rigorous, concise (under 180 words per turn).
Rule: Always conclude your response with a thought-provoking question to nudge the student forward.
`,
    },
    {
      name: 'references/rubric.json',
      sizeBytes: 2450,
      content: `{
  "rubricVersion": "2.0.0",
  "skill": "tutor-guided-learning",
  "criteria": [
    { "id": "crit-socratic", "name": "苏格拉底启发比率", "weight": 0.4, "threshold": 0.85 },
    { "id": "crit-no-direct-code", "name": "防直接透题合规性", "weight": 0.4, "threshold": 1.0 },
    { "id": "crit-encouragement", "name": "正面探索激励性", "weight": 0.2, "threshold": 0.8 }
  ]
}`,
    },
  ],
  'thunder-fighter-engine': [
    {
      name: 'SKILL.md',
      sizeBytes: 5120,
      content: `# Thunder Fighter Game Engine Specification

## 架构概览
本规范定义「雷霆战机」PBL 项目的标准 Pygame 主循环、精灵分层管理与帧率锁定逻辑。

## 模块清单
- \`PlayerSprite\`：玩家战机操控与键盘事件响应。
- \`BulletQueue\`：子弹发射池与越界回收。
- \`EnemySpawner\`：敌机定时生成、航迹插值与速度计算。
- \`CollisionManager\`：AABB 轴对齐包围盒碰撞检测。
`,
    },
    {
      name: 'prompts/instruction.txt',
      sizeBytes: 1200,
      content: `Guide the student through building a pygame 60FPS loop. Focus on clock.tick(60), pygame.event.pump(), and dirty rect updating.`,
    },
  ],
};

interface SkillCategory {
  key: string;
  label: string;
}

export const SKILL_CATEGORIES: SkillCategory[] = [
  { key: 'all', label: '全部技能' },
  { key: 'guidance', label: '启发与引导' },
  { key: 'collaboration', label: '探究与协同' },
  { key: 'physics', label: '物理探究' },
  { key: 'engineering', label: '工程与沙箱' },
  { key: 'assessment', label: '答辩与反思' },
  { key: 'governance', label: '画像与治理' },
];

export const CORE_SKILLS_CATALOG: SkillItem[] = [
  // 启发与引导
  {
    id: 'guided',
    name: 'guided',
    description: '苏格拉底短轮次启发与概念拆解规范，引导学生自主探索，严禁直接给答案。',
    tags: ['苏格拉底', '启发式', '教学规范'],
    filesCount: 2,
    addedBy: '平台教研组',
    updatedAtText: '1 天前',
    boundAssistantIds: ['tutor-leader', 'fighter-concept-coach', 'kinetic-concept-coach', 'kinetic-leader'],
    files: [
      {
        name: 'SKILL.md',
        sizeBytes: 2800,
        content: '# Guided Socratic Instruction\n\n以问题启发为主，分步递进，严禁向学生直接提供完整实现代码。',
      },
    ],
  },
  {
    id: 'hint',
    name: 'hint',
    description: '渐进式线索与思维支架提示（三级梯级提示：微线索、伪代码比对、定位排错）。',
    tags: ['脚手架', '分级线索', '思维支架'],
    filesCount: 2,
    addedBy: '平台教研组',
    updatedAtText: '2 天前',
    boundAssistantIds: ['fighter-concept-coach', 'fighter-code-guide', 'kinetic-concept-coach', 'kinetic-experiment-guide'],
    files: [
      {
        name: 'SKILL.md',
        sizeBytes: 2200,
        content: '# Progressive Hint Scaffolding\n\n提供 3 级渐进提示，确保学生在自主思考区间完成突破。',
      },
    ],
  },
  {
    id: 'openmaic-interactive-concept',
    name: 'openmaic-interactive-concept',
    description: '互动式概念探究与具身多模态概念对话规范，将抽象概念具象化。',
    tags: ['概念探究', '具象化', '多模态'],
    filesCount: 2,
    addedBy: '平台教研组',
    updatedAtText: '3 天前',
    boundAssistantIds: ['fighter-concept-coach'],
    files: [
      {
        name: 'SKILL.md',
        sizeBytes: 2500,
        content: '# OpenMAIC Interactive Concept Exploration\n\n通过交互对话将核心抽象概念具象化。',
      },
    ],
  },
  {
    id: 'tutor-guided-learning',
    name: 'tutor-guided-learning',
    description: '短轮次苏格拉底式启发教学与理论门禁确认规范，定义平台通用的导师教学互动准则。',
    tags: ['教学规范', '理论门禁', '引导'],
    filesCount: 3,
    addedBy: '平台教研组',
    updatedAtText: '2 天前',
    boundAssistantIds: ['tutor-leader', 'kinetic-leader'],
    files: DEFAULT_FILES_FOR_SKILL['tutor-guided-learning'] ?? [],
  },
  {
    id: 'socratic-intake',
    name: 'socratic-intake',
    description: '苏格拉底接引与初始意图探询规范，用于平台管家或助手初次接收入口对话。',
    tags: ['接收入口', '苏格拉底', '意图识别'],
    filesCount: 2,
    addedBy: '平台教研组',
    updatedAtText: '4 天前',
    boundAssistantIds: ['qitu-intake-assistant'],
    files: [
      {
        name: 'SKILL.md',
        sizeBytes: 2100,
        content: '# Socratic Intake Specification\n\n在学生进入项目学习前通过对话探寻学习兴趣与前置认知。',
      },
    ],
  },
  {
    id: 'intent-clarification',
    name: 'intent-clarification',
    description: '学习意图与目标清晰化澄清规范，引导学生明确探究项目产出与挑战目标。',
    tags: ['意图澄清', '目标拆解', '学情引导'],
    filesCount: 2,
    addedBy: '平台教研组',
    updatedAtText: '4 天前',
    boundAssistantIds: ['qitu-intake-assistant'],
    files: [
      {
        name: 'SKILL.md',
        sizeBytes: 1900,
        content: '# Intent Clarification\n\n确认学生学习意愿，未确认意图前不得创建正式项目。',
      },
    ],
  },

  // 探究与协同
  {
    id: 'planning',
    name: 'planning',
    description: 'PBL 任务拆解与子阶段学习路径动态规划，形成递进式里程碑。',
    tags: ['任务规划', '路径拆解', '里程碑'],
    filesCount: 2,
    addedBy: '平台教研组',
    updatedAtText: '2 天前',
    boundAssistantIds: ['tutor-leader', 'kinetic-leader'],
    files: [
      {
        name: 'SKILL.md',
        sizeBytes: 2600,
        content: '# Project Planning & Milestone Decomposition\n\n将大目标分解为可交付、可验证的微型探索阶段。',
      },
    ],
  },
  {
    id: 'pbl-orchestration',
    name: 'pbl-orchestration',
    description: '多智能体教学导师团队协作流转与任务分发编排规范。',
    tags: ['团队协同', '智能体编排', '角色交接'],
    filesCount: 2,
    addedBy: '平台教研组',
    updatedAtText: '2 天前',
    boundAssistantIds: ['tutor-leader', 'kinetic-leader'],
    files: [
      {
        name: 'SKILL.md',
        sizeBytes: 3100,
        content: '# Multi-Agent PBL Orchestration\n\n统筹原理教练、代码向导与评审导师的角色分工与流转条件。',
      },
    ],
  },
  {
    id: 'escalation',
    name: 'escalation',
    description: '学生卡点识别与人机协同求助升级（转交班主任或真人导师干预）。',
    tags: ['卡点检测', '协同求助', '人机交接'],
    filesCount: 2,
    addedBy: '平台教研组',
    updatedAtText: '5 天前',
    boundAssistantIds: ['tutor-leader'],
    files: [
      {
        name: 'SKILL.md',
        sizeBytes: 1800,
        content: '# Human-in-the-Loop Escalation\n\n连续多次回答受挫或检测到消极情绪时自动触发干预预警。',
      },
    ],
  },
  {
    id: 'project-recommendation',
    name: 'project-recommendation',
    description: '基于学生兴趣、前置知识画像与认知风格推荐适合的 PBL 探索项目。',
    tags: ['项目推荐', '学情匹配', '画像推荐'],
    filesCount: 2,
    addedBy: '平台教研组',
    updatedAtText: '6 天前',
    boundAssistantIds: ['qitu-intake-assistant'],
    files: [
      {
        name: 'SKILL.md',
        sizeBytes: 2000,
        content: '# Project Recommendation Engine\n\n智能匹配 PBL 学习主题并生成前置学习契约。',
      },
    ],
  },
  {
    id: 'team-handoff',
    name: 'team-handoff',
    description: '学生确认开启项目后，由接引助手平滑交接至项目专属导师团队规范。',
    tags: ['团队交接', '状态同步', '流程编排'],
    filesCount: 2,
    addedBy: '平台教研组',
    updatedAtText: '6 天前',
    boundAssistantIds: ['qitu-intake-assistant'],
    files: [
      {
        name: 'SKILL.md',
        sizeBytes: 2200,
        content: '# Team Handoff Protocol\n\n打包对话上下文与学习目标，唤醒项目 Leader 导师团队。',
      },
    ],
  },

  // 物理探究
  {
    id: 'physics-inquiry',
    name: 'physics-inquiry',
    description: '物理科学探究方法论（提出假说、设计验证变量、控制变量法）。',
    tags: ['科学探究', '假设检验', '控制变量'],
    filesCount: 2,
    addedBy: '平台教研组',
    updatedAtText: '3 天前',
    boundAssistantIds: ['kinetic-leader'],
    files: [
      {
        name: 'SKILL.md',
        sizeBytes: 2700,
        content: '# Physics Inquiry Methodology\n\n引导学生提出科学假说并设计对比实验。',
      },
    ],
  },
  {
    id: 'physics-derivation',
    name: 'physics-derivation',
    description: '牛顿第二定律与动能定理微元法积分推导规范，掌握公式底层物理机制。',
    tags: ['公式推导', '微元法', '动能定理'],
    filesCount: 2,
    addedBy: '平台教研组',
    updatedAtText: '3 天前',
    boundAssistantIds: ['kinetic-concept-coach'],
    files: [
      {
        name: 'SKILL.md',
        sizeBytes: 2900,
        content: '# Physics Derivation\n\n牛顿运动定律到外力做功与动能变化的数理推导引导。',
      },
    ],
  },
  {
    id: 'simulation-experiment',
    name: 'simulation-experiment',
    description: '物理仿真沙箱交互指导，包括变力做功、恒力加速与动能变化曲线实时观测。',
    tags: ['物理仿真', '虚拟实验', '曲线观测'],
    filesCount: 2,
    addedBy: '平台教研组',
    updatedAtText: '3 天前',
    boundAssistantIds: ['kinetic-experiment-guide'],
    files: [
      {
        name: 'SKILL.md',
        sizeBytes: 2600,
        content: '# Simulation Experiment\n\n指导学生操控小车滑轨、光电门与拉力传感器虚拟沙箱。',
      },
    ],
  },
  {
    id: 'data-fitting',
    name: 'data-fitting',
    description: '实验数据采集、最小二乘法拟合与 W-v² 线性关系验证规范。',
    tags: ['数据拟合', '线性回归', '实验验证'],
    filesCount: 2,
    addedBy: '平台教研组',
    updatedAtText: '3 天前',
    boundAssistantIds: ['kinetic-experiment-guide'],
    files: [
      {
        name: 'SKILL.md',
        sizeBytes: 2400,
        content: '# Data Fitting & Curve Analysis\n\n采集 (W, v) 数据点并绘制 W 与 v² 散点图完成斜率验证。',
      },
    ],
  },
  {
    id: 'kinetic-energy-physics',
    name: 'kinetic-energy-physics',
    description: '动手学动能定理：合外力做功与动能变化关系模拟验证与数值推导规范。',
    tags: ['物理仿真', '动能定理', '功与能量'],
    filesCount: 2,
    addedBy: '平台教研组',
    updatedAtText: '15 天前',
    boundAssistantIds: ['kinetic-leader', 'kinetic-concept-coach', 'kinetic-experiment-guide'],
    files: [
      {
        name: 'SKILL.md',
        sizeBytes: 3800,
        content: '# Kinetic Energy Physics Specification\n\n$$W = \\Delta E_k = \\frac{1}{2}m v_2^2 - \\frac{1}{2}m v_1^2$$',
      },
    ],
  },
  {
    id: 'error-analysis',
    name: 'error-analysis',
    description: '实验系统误差与偶然误差溯源分析（导轨倾角摩擦、传感器阻尼、空气阻力）。',
    tags: ['误差分析', '系统误差', '实验反思'],
    filesCount: 2,
    addedBy: '平台教研组',
    updatedAtText: '3 天前',
    boundAssistantIds: ['kinetic-review-assessor'],
    files: [
      {
        name: 'SKILL.md',
        sizeBytes: 2100,
        content: '# Experimental Error Analysis\n\n引导学生分析实验值与理论值偏差的物理源头。',
      },
    ],
  },

  // 工程与沙箱
  {
    id: 'project-implementation',
    name: 'project-implementation',
    description: '工程项目模块化架构设计与代码实现规范指导，引导面向对象与模块解耦。',
    tags: ['工程实现', '模块解耦', '代码指导'],
    filesCount: 2,
    addedBy: '平台教研组',
    updatedAtText: '3 天前',
    boundAssistantIds: ['fighter-code-guide'],
    files: [
      {
        name: 'SKILL.md',
        sizeBytes: 2700,
        content: '# Project Implementation\n\n指导学生构建清晰的模块化类结构与生命周期管理。',
      },
    ],
  },
  {
    id: 'debugging-guide',
    name: 'debugging-guide',
    description: '代码断点调试、错误堆栈逆向溯源与防御性编程指导规范。',
    tags: ['排错调试', '堆栈分析', '异常处理'],
    filesCount: 2,
    addedBy: '平台教研组',
    updatedAtText: '3 天前',
    boundAssistantIds: ['fighter-code-guide'],
    files: [
      {
        name: 'SKILL.md',
        sizeBytes: 2500,
        content: '# Debugging Guide\n\n引导学生依据控制台报错精准回溯语法或逻辑异常。',
      },
    ],
  },
  {
    id: 'thunder-fighter-engine',
    name: 'thunder-fighter-engine',
    description: '雷霆战机 Python/Pygame 游戏主循环引擎与渲染规范，包含帧率锁定与事件队列控制。',
    tags: ['Pygame', '游戏引擎', '主循环'],
    filesCount: 2,
    addedBy: '平台教研组',
    updatedAtText: '5 天前',
    boundAssistantIds: ['fighter-concept-coach', 'fighter-code-guide'],
    files: DEFAULT_FILES_FOR_SKILL['thunder-fighter-engine'] ?? [],
  },
  {
    id: 'aabb-collision-solver',
    name: 'aabb-collision-solver',
    description: '二维轴对齐包围盒 (AABB) 碰撞检测算法推导与子弹击中敌机判定数学规范。',
    tags: ['物理算法', 'AABB', '碰撞检测'],
    filesCount: 2,
    addedBy: '平台教研组',
    updatedAtText: '12 天前',
    boundAssistantIds: ['fighter-concept-coach', 'fighter-code-guide'],
    files: [
      {
        name: 'SKILL.md',
        sizeBytes: 3100,
        content: '# AABB Collision Solver Specification\n\n矩形碰撞判定充要条件推导与优化。',
      },
    ],
  },

  // 答辩与反思
  {
    id: 'project-review',
    name: 'project-review',
    description: 'PBL 项目工程质量与成果验收综合质询评估规范。',
    tags: ['成果验收', '代码质询', '工程复盘'],
    filesCount: 2,
    addedBy: '平台教研组',
    updatedAtText: '4 天前',
    boundAssistantIds: ['fighter-review-assessor', 'kinetic-review-assessor'],
    files: [
      {
        name: 'SKILL.md',
        sizeBytes: 2400,
        content: '# Project Review\n\n综合质询工程完整度与架构合理性。',
      },
    ],
  },
  {
    id: 'growth-evaluation',
    name: 'growth-evaluation',
    description: '学生素养维度（问题解决、探究坚持性、批判性思维）综合多维评价。',
    tags: ['核心素养', '多维评价', '学情增值'],
    filesCount: 2,
    addedBy: '平台教研组',
    updatedAtText: '4 天前',
    boundAssistantIds: ['fighter-review-assessor', 'kinetic-review-assessor'],
    files: [
      {
        name: 'SKILL.md',
        sizeBytes: 2300,
        content: '# Growth Evaluation\n\n评价学生在探究过程中的反思性与解决复杂问题能力。',
      },
    ],
  },
  {
    id: 'socratic-reflection',
    name: 'socratic-reflection',
    description: '苏格拉底结项三问与迁移思考（如果增加特性你会怎么做、遇到的最大卡点如何突破）。',
    tags: ['苏格拉底', '反思复盘', '迁移思考'],
    filesCount: 2,
    addedBy: '平台教研组',
    updatedAtText: '4 天前',
    boundAssistantIds: ['fighter-review-assessor'],
    files: [
      {
        name: 'SKILL.md',
        sizeBytes: 2500,
        content: '# Socratic Reflection\n\n促使学生深度回顾认知重塑过程与技术突破点。',
      },
    ],
  },
  {
    id: 'pbl-defense-rubric',
    name: 'pbl-defense-rubric',
    description: 'PBL 结项答辩、概念掌握度质询与作品防作弊问答评测规程。',
    tags: ['答辩评测', '量规', '反思'],
    filesCount: 2,
    addedBy: '平台教研组',
    updatedAtText: '20 天前',
    boundAssistantIds: ['fighter-review-assessor', 'kinetic-review-assessor'],
    files: [
      {
        name: 'SKILL.md',
        sizeBytes: 2900,
        content: '# PBL Defense Rubric\n\n防作弊质询与概念掌握深度核验。',
      },
    ],
  },

  // 画像与治理
  {
    id: 'student-profiling',
    name: 'student-profiling',
    description: '动态学生认知画像与行为特征建模规范。',
    tags: ['学生画像', '行为建模', '认知特征'],
    filesCount: 2,
    addedBy: '平台教研组',
    updatedAtText: '5 天前',
    boundAssistantIds: ['profile-analyst-assistant'],
    files: [
      {
        name: 'SKILL.md',
        sizeBytes: 2100,
        content: '# Student Profiling\n\n从互动记录中提取认知水平与学习习惯指标。',
      },
    ],
  },
  {
    id: 'competency-radar',
    name: 'competency-radar',
    description: '五维素养雷达图（逻辑、工程、探究、表达、反思）计算与增值分析。',
    tags: ['素养雷达', '能力评估', '成长可视化'],
    filesCount: 2,
    addedBy: '平台教研组',
    updatedAtText: '5 天前',
    boundAssistantIds: ['profile-analyst-assistant'],
    files: [
      {
        name: 'SKILL.md',
        sizeBytes: 2200,
        content: '# Competency Radar\n\n多维素养分值量化计算与动态折线图。',
      },
    ],
  },
  {
    id: 'learning-gap-diagnosis',
    name: 'learning-gap-diagnosis',
    description: '薄弱知识点与认知断层自动诊断，生成个性化干预建议。',
    tags: ['认知断层', '薄弱点诊断', '个性化干预'],
    filesCount: 2,
    addedBy: '平台教研组',
    updatedAtText: '5 天前',
    boundAssistantIds: ['profile-analyst-assistant'],
    files: [
      {
        name: 'SKILL.md',
        sizeBytes: 2300,
        content: '# Learning Gap Diagnosis\n\n识别概念混淆点并输出靶向辅导策略。',
      },
    ],
  },
  {
    id: 'timeline-generation',
    name: 'timeline-generation',
    description: '学习历程时间轴自动梳理与探究足迹序列化。',
    tags: ['时间轴', '学习轨迹', '事件序列'],
    filesCount: 2,
    addedBy: '平台教研组',
    updatedAtText: '5 天前',
    boundAssistantIds: ['growth-trajectory-assistant'],
    files: [
      {
        name: 'SKILL.md',
        sizeBytes: 2000,
        content: '# Learning Timeline Generation\n\n将对话、代码提交与实验数据聚合为清晰足迹流。',
      },
    ],
  },
  {
    id: 'milestone-synthesis',
    name: 'milestone-synthesis',
    description: '重大突破里程碑综合提炼与关键事件卡片合成。',
    tags: ['里程碑', '关键突破', '成果卡片'],
    filesCount: 2,
    addedBy: '平台教研组',
    updatedAtText: '5 天前',
    boundAssistantIds: ['growth-trajectory-assistant'],
    files: [
      {
        name: 'SKILL.md',
        sizeBytes: 2100,
        content: '# Milestone Synthesis\n\n萃取探索转折点并生成成就徽章事件。',
      },
    ],
  },
  {
    id: 'growth-narrative',
    name: 'growth-narrative',
    description: '第一人称个性化成长故事与研学报告自动叙述生成。',
    tags: ['成长叙事', '研学报告', '故事化生成'],
    filesCount: 2,
    addedBy: '平台教研组',
    updatedAtText: '5 天前',
    boundAssistantIds: ['growth-trajectory-assistant'],
    files: [
      {
        name: 'SKILL.md',
        sizeBytes: 2400,
        content: '# Growth Narrative Generation\n\n生成富有温度与科学严谨性的学生个人成长总结。',
      },
    ],
  },
  {
    id: 'system-governance',
    name: 'system-governance',
    description: '平台全局合规、模型路由调度与安全兜底策略规范。',
    tags: ['平台治理', '合规监控', '安全策略'],
    filesCount: 2,
    addedBy: '平台教研组',
    updatedAtText: '5 天前',
    boundAssistantIds: ['qitu-assistant'],
    files: [
      {
        name: 'SKILL.md',
        sizeBytes: 2600,
        content: '# System Governance\n\n保护未成年人隐私与系统鲁棒性安全规则。',
      },
    ],
  },
  {
    id: 'asset-management',
    name: 'asset-management',
    description: '团队、助手、技能模板、知识库等数字教育资产管理与分发规范。',
    tags: ['资产管理', '模板分发', '知识库管理'],
    filesCount: 2,
    addedBy: '平台教研组',
    updatedAtText: '5 天前',
    boundAssistantIds: ['qitu-assistant'],
    files: [
      {
        name: 'SKILL.md',
        sizeBytes: 2300,
        content: '# Asset Management\n\n资产库元数据规范与版本控制。',
      },
    ],
  },
  {
    id: 'audit-logging',
    name: 'audit-logging',
    description: '关键操作不可篡改审计日志流水与行为追踪规范。',
    tags: ['审计日志', '可追溯', '合规记录'],
    filesCount: 2,
    addedBy: '平台教研组',
    updatedAtText: '5 天前',
    boundAssistantIds: ['qitu-assistant'],
    files: [
      {
        name: 'SKILL.md',
        sizeBytes: 2000,
        content: '# Audit Logging\n\n敏感操作、权限变更与AI决策全链路存证。',
      },
    ],
  },
];

export default function SkillsSettingsPage() {
  const [skills, setSkills] = useState<SkillItem[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const cached = localStorage.getItem('qitu.admin.skills_list');
        if (cached) {
          const parsed: SkillItem[] = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) {
            // 将缓存的技能与 CORE_SKILLS_CATALOG 进行合并补齐
            const cachedMap = new Map(parsed.map((s) => [s.id, s]));
            const merged = CORE_SKILLS_CATALOG.map((core) => cachedMap.get(core.id) || core);
            // 附加上用户自定义添加的 skill
            parsed.forEach((custom) => {
              if (!CORE_SKILLS_CATALOG.some((c) => c.id === custom.id)) {
                merged.push(custom);
              }
            });
            return merged;
          }
        }
      } catch {}
    }
    return CORE_SKILLS_CATALOG;
  });
  const [assistants, setAssistants] = useState<AdminAssistantConfig[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [editingSkill, setEditingSkill] = useState<SkillItem | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'files'>('overview');
  const [showAddAssistantModal, setShowAddAssistantModal] = useState(false);
  const [selectedAsstToAdd, setSelectedAsstToAdd] = useState('');
  const [saveNotice, setSaveNotice] = useState('');
  const [skillsViewMode, setSkillsViewMode] = useState<'list' | 'matrix'>('list');

  // 持久化存储 skills
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('qitu.admin.skills_list', JSON.stringify(skills));
      } catch {}
    }
  }, [skills]);

  // 文件管理状态
  const [selectedFileName, setSelectedFileName] = useState<string>('SKILL.md');
  const [fileViewMode, setFileViewMode] = useState<'edit' | 'preview'>('edit');
  const [fileContentDraft, setFileContentDraft] = useState<string>('');

  // 助手展示列表 (以 assistants 为唯一真实来源)
  const displayAssistants = useMemo(() => {
    if (assistants.length > 0) {
      return assistants.map((a) => ({
        id: a.id,
        name: a.name,
        role: a.role || '导师助手',
        avatar: a.avatar || '🤖',
        enabledSkills: (a.enabledSkills as string[]) || [],
      }));
    }
    return [];
  }, [assistants]);

  // 判断助手与技能是否已绑定：以助手实际的 enabledSkills 为 Single Source of Truth
  const isSkillBoundToAssistant = useCallback(
    (sk: SkillItem, asst: { id: string; name: string; enabledSkills?: string[] }) => {
      // 优先从最新的 assistants 状态中读取该助手的 enabledSkills
      const matched = assistants.find((a) => a.id === asst.id || a.name === asst.name);
      const enabledList = (matched?.enabledSkills as string[]) || asst.enabledSkills || [];
      if (enabledList.includes(sk.id) || enabledList.includes(sk.name)) {
        return true;
      }
      // 回退兼容：检查技能的 boundAssistantIds
      return (sk.boundAssistantIds || []).includes(asst.id) || (sk.boundAssistantIds || []).includes(asst.name);
    },
    [assistants]
  );

  // 矩阵中切换技能绑定 (打上✔ 立即生效)
  const toggleSkillForAssistant = async (skillId: string, asstIdentifier: string) => {
    const matchedAsst = assistants.find((a) => a.id === asstIdentifier || a.name === asstIdentifier);
    const targetAsstId = matchedAsst?.id || asstIdentifier;
    const targetAsstName = matchedAsst?.name || asstIdentifier;
    const asstIdentifiers = new Set([targetAsstId, targetAsstName, asstIdentifier].filter(Boolean));

    const currentSkill = skills.find((s) => s.id === skillId);
    if (!currentSkill) return;

    // 当前是否已经绑定
    const currentlyChecked = isSkillBoundToAssistant(currentSkill, {
      id: targetAsstId,
      name: targetAsstName,
      enabledSkills: matchedAsst?.enabledSkills as string[],
    });
    const nextChecked = !currentlyChecked;

    // 1. 更新技能列表中的 boundAssistantIds 并写入本地持久化
    const nextSkills = skills.map((s) => {
      if (s.id !== skillId) return s;
      let nextBounds: string[];
      if (nextChecked) {
        const set = new Set(s.boundAssistantIds || []);
        set.add(targetAsstId);
        if (targetAsstName) set.add(targetAsstName);
        nextBounds = Array.from(set);
      } else {
        nextBounds = (s.boundAssistantIds || []).filter((id) => !asstIdentifiers.has(id));
      }
      return { ...s, boundAssistantIds: nextBounds };
    });

    setSkills(nextSkills);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('qitu.admin.skills_list', JSON.stringify(nextSkills));
      } catch {}
    }

    // 2. 如果当前正在编辑此技能，实时同步 editingSkill
    if (editingSkill && editingSkill.id === skillId) {
      const updatedBounds = nextChecked
        ? Array.from(new Set([...editingSkill.boundAssistantIds, targetAsstId, targetAsstName]))
        : editingSkill.boundAssistantIds.filter((id) => !asstIdentifiers.has(id));
      setEditingSkill({ ...editingSkill, boundAssistantIds: updatedBounds });
    }

    // 3. 更新助手对象中的 enabledSkills 并持久化至服务端
    if (matchedAsst) {
      const curEnabled: string[] = matchedAsst.enabledSkills ? [...matchedAsst.enabledSkills] : [];
      let updatedEnabled: string[];
      if (nextChecked) {
        const set = new Set(curEnabled);
        set.add(skillId);
        if (currentSkill.name) set.add(currentSkill.name);
        updatedEnabled = Array.from(set);
      } else {
        updatedEnabled = curEnabled.filter((id) => id !== skillId && id !== currentSkill.name);
      }

      setAssistants((prev) =>
        prev.map((a) => (a.id === matchedAsst.id ? { ...a, enabledSkills: updatedEnabled } : a))
      );

      try {
        await persistAssistantBinding(matchedAsst.id, 'enabledSkills', updatedEnabled);
      } catch (err) {
        console.warn('持久化助手技能绑定失败', err);
      }

      // 同步更新本地 custom_assistants
      if (typeof window !== 'undefined') {
        try {
          const cached = localStorage.getItem('qitu.admin.custom_assistants');
          if (cached) {
            const list: any[] = JSON.parse(cached);
            const nextList = list.map((a) =>
              a.id === matchedAsst.id ? { ...a, enabledSkills: updatedEnabled } : a
            );
            localStorage.setItem('qitu.admin.custom_assistants', JSON.stringify(nextList));
          }
        } catch {}
      }
    }

    setSaveNotice(
      `已更新【${targetAsstName}】的技能【${currentSkill.name}】(${nextChecked ? '已打上✔ 立即生效' : '取消✔ 立即关闭'})`
    );
    setTimeout(() => setSaveNotice(''), 2500);
  };

  // 加载真实助手用于绑定与展示头像（同时合并管家自建助手）
  useEffect(() => {
    fetchAdminAssistantConfigs()
      .then((res) => {
        let customList: AdminAssistantConfig[] = [];
        if (typeof window !== 'undefined') {
          try {
            const cached = localStorage.getItem('qitu.admin.custom_assistants');
            if (cached) customList = JSON.parse(cached);
          } catch {}
        }
        const backendList = res || [];
        const existingIds = new Set(backendList.map((a) => a.id));
        const combined = [...customList.filter((c) => !existingIds.has(c.id)), ...backendList];
        setAssistants(combined);

        // 同步更新本地 skills 列表各技能绑定的助手 ID
        setSkills((prevSkills) =>
          prevSkills.map((sk) => {
            const boundIds = combined
              .filter((a) => ((a.enabledSkills as string[]) || []).includes(sk.id) || ((a.enabledSkills as string[]) || []).includes(sk.name))
              .map((a) => a.id);
            return {
              ...sk,
              boundAssistantIds: Array.from(new Set([...(sk.boundAssistantIds || []), ...boundIds])),
            };
          })
        );
      })
      .catch(() => {
        if (typeof window !== 'undefined') {
          try {
            const cached = localStorage.getItem('qitu.admin.custom_assistants');
            if (cached) setAssistants(JSON.parse(cached));
          } catch {}
        }
      });
  }, []);

  // 当切换 editingSkill 或 selectedFileName 时同步草稿
  useEffect(() => {
    if (!editingSkill) return;
    const file = editingSkill.files.find((f) => f.name === selectedFileName) || editingSkill.files[0];
    if (file) {
      setSelectedFileName(file.name);
      setFileContentDraft(file.content);
    }
  }, [editingSkill, selectedFileName]);

  const filteredSkills = useMemo(() => {
    if (!searchQuery.trim()) return skills;
    const q = searchQuery.toLowerCase();
    return skills.filter(
      (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
    );
  }, [skills, searchQuery]);

  const matrixSkills = useMemo(() => {
    if (selectedCategory === 'all') return skills;
    const categoryMap: Record<string, string[]> = {
      guidance: ['guided', 'hint', 'openmaic-interactive-concept', 'tutor-guided-learning', 'socratic-intake', 'intent-clarification'],
      collaboration: ['planning', 'pbl-orchestration', 'escalation', 'project-recommendation', 'team-handoff'],
      physics: ['physics-inquiry', 'physics-derivation', 'simulation-experiment', 'data-fitting', 'kinetic-energy-physics', 'error-analysis'],
      engineering: ['project-implementation', 'debugging-guide', 'thunder-fighter-engine', 'aabb-collision-solver'],
      assessment: ['project-review', 'growth-evaluation', 'socratic-reflection', 'pbl-defense-rubric'],
      governance: ['student-profiling', 'competency-radar', 'learning-gap-diagnosis', 'timeline-generation', 'milestone-synthesis', 'growth-narrative', 'system-governance', 'asset-management', 'audit-logging'],
    };
    const validIds = categoryMap[selectedCategory] || [];
    return skills.filter((s) => validIds.includes(s.id));
  }, [skills, selectedCategory]);

  // 新建 Skill
  const handleCreateSkill = () => {
    const newSkill: SkillItem = {
      id: `skill-${Date.now()}`,
      name: `custom-skill-${skills.length + 1}`,
      description: '自定义 PBL 智能体能力扩展指令与上下文约定。',
      tags: ['自定义'],
      filesCount: 2,
      addedBy: '管理员',
      updatedAtText: '刚刚',
      boundAssistantIds: assistants[0]?.id ? [assistants[0].id] : [],
      files: [
        {
          name: 'SKILL.md',
          sizeBytes: 1200,
          content: '# New Custom Skill\n\n## 技能功能定义\n请在此处编写 Markdown 技能规范与智能体调用约束。',
        },
        {
          name: 'prompts/instruction.txt',
          sizeBytes: 600,
          content: 'You are a specialized agent executing this skill.',
        },
      ],
    };
    setSkills((prev) => [newSkill, ...prev]);
    setEditingSkill(newSkill);
    setSelectedFileName('SKILL.md');
  };

  // 保存 Skill 编辑（含属性与文件）
  const handleSaveSkill = () => {
    if (!editingSkill) return;
    const updatedFiles = editingSkill.files.map((f) =>
      f.name === selectedFileName
        ? { ...f, content: fileContentDraft, sizeBytes: new Blob([fileContentDraft]).size }
        : f
    );
    const updatedSkill = { ...editingSkill, files: updatedFiles, filesCount: updatedFiles.length };

    setSkills((prev) => prev.map((s) => (s.id === editingSkill.id ? updatedSkill : s)));
    setEditingSkill(updatedSkill);
    setSaveNotice('已成功保存所有配置与文件更改 ✔');
    setTimeout(() => setSaveNotice(''), 2500);
  };

  // 保存当前单文件
  const handleSaveCurrentFile = () => {
    if (!editingSkill) return;
    const updatedFiles = editingSkill.files.map((f) =>
      f.name === selectedFileName
        ? { ...f, content: fileContentDraft, sizeBytes: new Blob([fileContentDraft]).size }
        : f
    );
    const updatedSkill = { ...editingSkill, files: updatedFiles, filesCount: updatedFiles.length };

    setSkills((prev) => prev.map((s) => (s.id === editingSkill.id ? updatedSkill : s)));
    setEditingSkill(updatedSkill);
    setSaveNotice(`文件 ${selectedFileName} 已保存 ✔`);
    setTimeout(() => setSaveNotice(''), 2000);
  };

  // 添加新文件
  const handleAddNewFile = () => {
    if (!editingSkill) return;
    const fileName = prompt('请输入新文件名（如：rules/constraints.md 或 rubric.json）：');
    if (!fileName?.trim()) return;
    const trimmed = fileName.trim();
    if (editingSkill.files.some((f) => f.name === trimmed)) {
      alert('已存在同名文件');
      return;
    }
    const newFile: SkillFile = {
      name: trimmed,
      sizeBytes: 0,
      content: trimmed.endsWith('.md') ? `# ${trimmed}\n\n文件初始内容` : '',
    };
    const updatedFiles = [...editingSkill.files, newFile];
    const updatedSkill = { ...editingSkill, files: updatedFiles, filesCount: updatedFiles.length };
    setEditingSkill(updatedSkill);
    setSkills((prev) => prev.map((s) => (s.id === editingSkill.id ? updatedSkill : s)));
    setSelectedFileName(trimmed);
    setFileContentDraft(newFile.content);
  };

  // 删除文件
  const handleDeleteFile = (fileName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!editingSkill) return;
    if (editingSkill.files.length <= 1) {
      alert('Skill 至少需保留一个文件');
      return;
    }
    if (!window.confirm(`确定要删除文件「${fileName}」吗？`)) return;

    const updatedFiles = editingSkill.files.filter((f) => f.name !== fileName);
    const updatedSkill = { ...editingSkill, files: updatedFiles, filesCount: updatedFiles.length };
    setEditingSkill(updatedSkill);
    setSkills((prev) => prev.map((s) => (s.id === editingSkill.id ? updatedSkill : s)));
    if (selectedFileName === fileName && updatedFiles[0]) {
      setSelectedFileName(updatedFiles[0].name);
      setFileContentDraft(updatedFiles[0].content);
    }
  };

  // 删除 Skill
  const handleDeleteSkill = (id: string, name: string) => {
    if (!window.confirm(`确定要彻底删除技能「${name}」吗？`)) return;
    setSkills((prev) => prev.filter((s) => s.id !== id));
    if (editingSkill?.id === id) {
      setEditingSkill(null);
    }
  };

  // 从技能中解除绑定助手 (立即生效并同步矩阵)
  const handleRemoveAssistantFromSkill = async (asstId: string) => {
    if (!editingSkill) return;
    await toggleSkillForAssistant(editingSkill.id, asstId);
  };

  // 向技能绑定助手 (立即生效并在矩阵方框中打上✔)
  const handleAddAssistantToSkill = async () => {
    if (!editingSkill || !selectedAsstToAdd) return;
    await toggleSkillForAssistant(editingSkill.id, selectedAsstToAdd);
    setShowAddAssistantModal(false);
    setSelectedAsstToAdd('');
  };

  // 技能编辑视图
  if (editingSkill) {
    const boundAssistants = assistants.filter(
      (a) =>
        editingSkill.boundAssistantIds.some((id) => id === a.id || id === a.name) ||
        ((a.enabledSkills as string[]) || []).includes(editingSkill.id)
    );
    const activeFile = editingSkill.files.find((f) => f.name === selectedFileName) || editingSkill.files[0] || { name: 'SKILL.md', sizeBytes: 0, content: '' };

    return (
      <div className="admin-skill-editor-page">
        {/* 面包屑与顶部操作栏 */}
        <div className="admin-skill-breadcrumb-bar">
          <div className="admin-skill-breadcrumb-links">
            <button
              type="button"
              className="admin-crumb-btn"
              onClick={() => setEditingSkill(null)}
            >
              Skills
            </button>
            <span className="admin-crumb-sep">/</span>
            <span className="admin-crumb-current">{editingSkill.name}</span>
          </div>

          <div className="admin-skill-top-actions">
            {saveNotice ? (
              <span style={{ fontSize: '13px', color: '#16a34a', fontWeight: 600 }}>{saveNotice}</span>
            ) : null}
            <button
              type="button"
              className="settings-action-btn is-danger"
              onClick={() => handleDeleteSkill(editingSkill.id, editingSkill.name)}
              title="删除此技能"
            >
              🗑️ 删除技能
            </button>
            <button
              type="button"
              className="settings-action-btn is-primary"
              onClick={handleSaveSkill}
            >
              💾 保存全部修改
            </button>
            <button
              type="button"
              className="settings-action-btn"
              onClick={() => setEditingSkill(null)}
            >
              返回列表
            </button>
          </div>
        </div>

        {/* 技能标题与元数据 */}
        <div className="admin-skill-title-block">
          <div className="admin-skill-title-row">
            <span className="admin-skill-icon">📖</span>
            <h1 className="admin-skill-main-title">{editingSkill.name}</h1>
          </div>
          <div className="admin-skill-meta-tags">
            <span className="admin-skill-meta-pill">✎ 手动创建</span>
            <span className="admin-skill-meta-pill">📄 {editingSkill.filesCount} 个文件</span>
            <span className="admin-skill-meta-pill">👥 {editingSkill.boundAssistantIds.length} 个智能体在用</span>
            <span className="admin-skill-meta-pill">🕒 {editingSkill.addedBy} 于 {editingSkill.updatedAtText}更新</span>
          </div>
        </div>

        {/* 概览 / 文件 选项卡 */}
        <div className="admin-skill-tabs-bar">
          <button
            type="button"
            className={`admin-skill-tab-item${activeTab === 'overview' ? ' is-active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            概览与属性
          </button>
          <button
            type="button"
            className={`admin-skill-tab-item${activeTab === 'files' ? ' is-active' : ''}`}
            onClick={() => setActiveTab('files')}
          >
            文件编辑与预览 ({editingSkill.filesCount})
          </button>
        </div>

        {activeTab === 'overview' ? (
          <div className="admin-skill-overview-content">
            {/* 模块一：属性 */}
            <section className="admin-skill-card-section">
              <h2 className="admin-skill-section-title">属性</h2>
              <div className="admin-skill-fold-hint">▶ 关于 skill 属性</div>

              <div className="admin-skill-form-field">
                <label className="admin-skill-field-label">名称</label>
                <input
                  className="admin-skill-input-text"
                  value={editingSkill.name}
                  onChange={(e) => setEditingSkill({ ...editingSkill, name: e.target.value })}
                  placeholder="skill 标识名称"
                />
              </div>

              <div className="admin-skill-form-field">
                <label className="admin-skill-field-label">描述</label>
                <textarea
                  className="admin-skill-textarea"
                  value={editingSkill.description}
                  onChange={(e) => setEditingSkill({ ...editingSkill, description: e.target.value })}
                  placeholder="智能体据此决定何时加载 skill。"
                  rows={4}
                />
                <div className="admin-skill-char-count-row">
                  <span className="admin-skill-hint-sub">智能体据此决定何时加载 skill。</span>
                  <span className="admin-skill-count-sub">{editingSkill.description.length} 个字符</span>
                </div>
              </div>

              <div className="admin-skill-form-field">
                <label className="admin-skill-field-label">标签</label>
                <div className="admin-skill-tags-input-box">
                  {editingSkill.tags.map((t) => (
                    <span key={t} className="admin-skill-tag-chip">
                      {t}
                    </span>
                  ))}
                  <button
                    type="button"
                    className="admin-skill-add-tag-btn"
                    onClick={() => {
                      const tag = prompt('输入新标签：');
                      if (tag?.trim()) {
                        setEditingSkill({
                          ...editingSkill,
                          tags: [...editingSkill.tags, tag.trim()],
                        });
                      }
                    }}
                  >
                    🏷 添加标签
                  </button>
                </div>
              </div>
            </section>

            {/* 模块二：被 X 个智能体使用 */}
            <section className="admin-skill-card-section">
              <div className="admin-skill-agents-header">
                <h2 className="admin-skill-section-title">
                  被 {editingSkill.boundAssistantIds.length} 个智能体使用
                </h2>
                <button
                  type="button"
                  className="settings-action-btn"
                  onClick={() => setShowAddAssistantModal(true)}
                >
                  + 添加到智能体
                </button>
              </div>

              {boundAssistants.length === 0 ? (
                <div className="admin-skill-empty-agents">
                  暂未绑定任何智能体，点击右上角“添加到智能体”进行挂载。
                </div>
              ) : (
                <div className="admin-skill-agents-list">
                  {boundAssistants.map((assistant) => (
                    <div key={assistant.id} className="admin-skill-agent-row">
                      <div className="admin-skill-agent-avatar-wrap">
                        {assistant.avatar || '🤖'}
                      </div>
                      <div className="admin-skill-agent-info">
                        <strong className="admin-skill-agent-name">{assistant.name}</strong>
                        <p className="admin-skill-agent-desc">
                          {assistant.description || '专业教学指导智能体。'}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="admin-skill-unlink-btn"
                        onClick={() => handleRemoveAssistantFromSkill(assistant.id)}
                        title="从此智能体移除该技能"
                      >
                        ✕ 解除绑定
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        ) : (
          /* 文件双栏视图：左侧文件列表，右侧文件编辑与实时渲染预览 */
          <div className="admin-skill-files-workbench" style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: '16px', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px', marginTop: '16px', minHeight: '560px' }}>
            {/* 左侧文件树 */}
            <div style={{ borderRight: '1px solid #e2e8f0', paddingRight: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <strong style={{ fontSize: '13px', color: '#0f172a' }}>文件树 ({editingSkill.files.length})</strong>
                <button
                  type="button"
                  style={{ fontSize: '12px', padding: '3px 8px', border: '1px solid #cbd5e1', borderRadius: '4px', background: '#f8fafc', cursor: 'pointer' }}
                  onClick={handleAddNewFile}
                >
                  + 新建文件
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {editingSkill.files.map((file) => {
                  const isSelected = file.name === selectedFileName;
                  return (
                    <div
                      key={file.name}
                      onClick={() => {
                        setSelectedFileName(file.name);
                        setFileContentDraft(file.content);
                      }}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '8px 10px',
                        borderRadius: '6px',
                        background: isSelected ? '#eff6ff' : 'transparent',
                        border: isSelected ? '1px solid #bfdbfe' : '1px solid transparent',
                        cursor: 'pointer',
                        fontSize: '13px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                        <span>{file.name.endsWith('.md') ? '📝' : file.name.endsWith('.json') ? '⚙️' : '📄'}</span>
                        <span style={{ fontWeight: isSelected ? 600 : 400, color: isSelected ? '#1d4ed8' : '#334155', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                          {file.name}
                        </span>
                      </div>
                      <button
                        type="button"
                        style={{ border: 'none', background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontSize: '12px', padding: '2px 4px' }}
                        onClick={(e) => handleDeleteFile(file.name, e)}
                        title="删除文件"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 右侧编辑器与预览器 */}
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {/* 文件顶部工具条 */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '12px', borderBottom: '1px solid #e2e8f0', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <strong style={{ fontSize: '15px', color: '#0f172a' }}>{selectedFileName}</strong>
                  <span style={{ fontSize: '12px', color: '#64748b' }}>({new Blob([fileContentDraft]).size} 字节)</span>
                  {selectedFileName.endsWith('.md') ? (
                    <span style={{ fontSize: '11px', background: '#dbeafe', color: '#1e40af', padding: '2px 6px', borderRadius: '4px', fontWeight: 600 }}>
                      Markdown 文档
                    </span>
                  ) : null}
                </div>

                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  {selectedFileName.endsWith('.md') ? (
                    <div style={{ display: 'flex', background: '#f1f5f9', padding: '2px', borderRadius: '6px' }}>
                      <button
                        type="button"
                        onClick={() => setFileViewMode('edit')}
                        style={{
                          border: 'none',
                          padding: '4px 10px',
                          borderRadius: '4px',
                          fontSize: '12px',
                          cursor: 'pointer',
                          background: fileViewMode === 'edit' ? '#ffffff' : 'transparent',
                          fontWeight: fileViewMode === 'edit' ? 600 : 400,
                          color: fileViewMode === 'edit' ? '#0f172a' : '#64748b',
                        }}
                      >
                        ✏️ 编辑代码
                      </button>
                      <button
                        type="button"
                        onClick={() => setFileViewMode('preview')}
                        style={{
                          border: 'none',
                          padding: '4px 10px',
                          borderRadius: '4px',
                          fontSize: '12px',
                          cursor: 'pointer',
                          background: fileViewMode === 'preview' ? '#ffffff' : 'transparent',
                          fontWeight: fileViewMode === 'preview' ? 600 : 400,
                          color: fileViewMode === 'preview' ? '#0f172a' : '#64748b',
                        }}
                      >
                        👁 实时渲染预览
                      </button>
                    </div>
                  ) : null}

                  <button
                    type="button"
                    className="settings-action-btn is-primary"
                    style={{ fontSize: '12px', padding: '4px 12px' }}
                    onClick={handleSaveCurrentFile}
                  >
                    💾 保存当前文件
                  </button>
                </div>
              </div>

              {/* 文件内容展示区 */}
              {selectedFileName.endsWith('.md') && fileViewMode === 'preview' ? (
                /* Markdown 渲染预览 */
                <div style={{ flex: 1, padding: '16px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', overflowY: 'auto', maxHeight: '480px', lineHeight: 1.6, color: '#1e293b' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {fileContentDraft.split('\n').map((line, idx) => {
                      if (line.startsWith('# ')) {
                        return <h1 key={idx} style={{ fontSize: '1.4rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '6px', margin: '8px 0 4px', color: '#0f172a' }}>{line.replace('# ', '')}</h1>;
                      }
                      if (line.startsWith('## ')) {
                        return <h2 key={idx} style={{ fontSize: '1.15rem', margin: '8px 0 4px', color: '#1e293b' }}>{line.replace('## ', '')}</h2>;
                      }
                      if (line.startsWith('### ')) {
                        return <h3 key={idx} style={{ fontSize: '1rem', margin: '6px 0 2px', color: '#334155' }}>{line.replace('### ', '')}</h3>;
                      }
                      if (line.startsWith('- ') || line.startsWith('* ')) {
                        return <li key={idx} style={{ marginLeft: '16px', fontSize: '13px' }}>{line.replace(/^[-*]\s+/, '')}</li>;
                      }
                      if (line.startsWith('1. ') || line.startsWith('2. ') || line.startsWith('3. ')) {
                        return <div key={idx} style={{ marginLeft: '12px', fontSize: '13px' }}>{line}</div>;
                      }
                      if (line.startsWith('```')) {
                        return <div key={idx} style={{ fontSize: '12px', color: '#64748b', fontFamily: 'monospace' }}>{line}</div>;
                      }
                      if (!line.trim()) {
                        return <div key={idx} style={{ height: '6px' }} />;
                      }
                      return <p key={idx} style={{ margin: '2px 0', fontSize: '13px' }}>{line}</p>;
                    })}
                  </div>
                </div>
              ) : (
                /* 源代码编辑 */
                <textarea
                  style={{
                    flex: 1,
                    minHeight: '440px',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                    fontSize: '13px',
                    lineHeight: 1.5,
                    padding: '14px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    background: '#0f172a',
                    color: '#e2e8f0',
                    boxSizing: 'border-box',
                    resize: 'vertical',
                  }}
                  value={fileContentDraft}
                  onChange={(e) => setFileContentDraft(e.target.value)}
                  spellCheck={false}
                />
              )}
            </div>
          </div>
        )}

        {/* 添加到智能体弹窗 */}
        {showAddAssistantModal ? (
          <div className="admin-modal-overlay" onClick={() => setShowAddAssistantModal(false)}>
            <div className="admin-modal-card" onClick={(e) => e.stopPropagation()}>
              <div className="admin-modal-header">
                <h3>将技能添加到智能体</h3>
                <button
                  type="button"
                  className="admin-modal-close-btn"
                  onClick={() => setShowAddAssistantModal(false)}
                >
                  ✕
                </button>
              </div>
              <div className="admin-modal-body">
                <div className="admin-form-row">
                  <label className="admin-form-label">选择智能体</label>
                  <select
                    className="admin-select"
                    value={selectedAsstToAdd}
                    onChange={(e) => setSelectedAsstToAdd(e.target.value)}
                  >
                    <option value="">-- 请选择要绑定的助手 --</option>
                    {assistants.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.role})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="admin-modal-footer">
                <button
                  type="button"
                  className="settings-action-btn"
                  onClick={() => setShowAddAssistantModal(false)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="settings-action-btn is-primary"
                  onClick={handleAddAssistantToSkill}
                >
                  确认添加
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  // 技能列表视图
  return (
    <div className="admin-skills-page-container">
      {/* 顶部标题与新建按钮 */}
      <div className="admin-skills-top-bar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div className="admin-skills-title-group">
          <span className="admin-skills-top-icon">📖</span>
          <h1 className="admin-skills-title">Skills (技能中心)</h1>
          <span className="admin-skills-total-count">{skills.length}</span>
          <span className="admin-skills-tagline">工作区里任何智能体都能使用的指令规范与能力包。</span>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <div style={{ background: '#f1f5f9', padding: '3px', borderRadius: '8px', display: 'flex', border: '1px solid #e2e8f0' }}>
            <button
              type="button"
              style={{
                padding: '6px 14px',
                border: 'none',
                borderRadius: '6px',
                background: skillsViewMode === 'list' ? '#ffffff' : 'transparent',
                fontWeight: skillsViewMode === 'list' ? 600 : 400,
                boxShadow: skillsViewMode === 'list' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                cursor: 'pointer',
                color: skillsViewMode === 'list' ? '#0f172a' : '#64748b',
                fontSize: '13px',
              }}
              onClick={() => setSkillsViewMode('list')}
            >
              📋 技能列表
            </button>
            <button
              type="button"
              style={{
                padding: '6px 14px',
                border: 'none',
                borderRadius: '6px',
                background: skillsViewMode === 'matrix' ? '#ffffff' : 'transparent',
                fontWeight: skillsViewMode === 'matrix' ? 600 : 400,
                boxShadow: skillsViewMode === 'matrix' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                cursor: 'pointer',
                color: skillsViewMode === 'matrix' ? '#0f172a' : '#64748b',
                fontSize: '13px',
              }}
              onClick={() => setSkillsViewMode('matrix')}
            >
              🔲 助手 × 技能绑定矩阵
            </button>
          </div>

          <button
            type="button"
            className="settings-action-btn is-primary"
            onClick={handleCreateSkill}
          >
            + 新建 skill
          </button>
        </div>
      </div>

      {skillsViewMode === 'matrix' ? (
        /* 助手 × 技能绑定矩阵 (行=助手, 列=技能) */
        <div style={{ marginTop: '16px', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <strong style={{ fontSize: '15px', color: '#0f172a' }}>技能分配矩阵 (Skills Matrix)</strong>
              <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
                行代表教学团队中的导师助手，列代表标准技能。打上✔ 即为助手立即启用该技能，取消✔ 即刻关闭。
              </p>
            </div>

            {/* 分类筛选标签栏 */}
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {SKILL_CATEGORIES.map((cat) => {
                const isSelected = selectedCategory === cat.key;
                return (
                  <button
                    key={cat.key}
                    type="button"
                    onClick={() => setSelectedCategory(cat.key)}
                    style={{
                      border: isSelected ? '1px solid #165dff' : '1px solid #e2e8f0',
                      background: isSelected ? '#eff4ff' : '#ffffff',
                      color: isSelected ? '#165dff' : '#475569',
                      padding: '4px 12px',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontWeight: isSelected ? 600 : 400,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {cat.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                  <th style={{ padding: '12px 16px', minWidth: '220px', color: '#334155', fontWeight: 600 }}>
                    导师智能体 (行)
                  </th>
                  {matrixSkills.map((sk) => (
                    <th key={sk.id} style={{ padding: '12px 14px', color: '#0369a1', fontWeight: 600, textAlign: 'center', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                        <span>📖 {sk.name}</span>
                        <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 400 }}>({sk.filesCount} 个规范文件)</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayAssistants.map((asst, idx) => {
                  const isEven = idx % 2 === 0;
                  return (
                    <tr key={asst.id} style={{ background: isEven ? '#ffffff' : '#fafafa', borderBottom: '1px solid #e2e8f0' }}>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <span style={{ fontSize: '18px' }}>{asst.avatar}</span>
                          <div>
                            <strong style={{ color: '#0f172a', display: 'block' }}>{asst.name}</strong>
                            <span style={{ fontSize: '12px', color: '#64748b' }}>{asst.role}</span>
                          </div>
                        </div>
                      </td>

                      {matrixSkills.map((sk) => {
                        const isChecked = isSkillBoundToAssistant(sk, asst);
                        return (
                          <td key={sk.id} style={{ padding: '12px 14px', textAlign: 'center' }}>
                            <div
                              onClick={() => toggleSkillForAssistant(sk.id, asst.id)}
                              role="checkbox"
                              aria-checked={isChecked}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: '22px',
                                height: '22px',
                                borderRadius: '5px',
                                border: isChecked ? '1.5px solid #165dff' : '1.5px solid #cbd5e1',
                                background: isChecked ? '#165dff' : '#ffffff',
                                color: '#ffffff',
                                fontSize: '14px',
                                fontWeight: 700,
                                cursor: 'pointer',
                                transition: 'all 0.15s ease-in-out',
                                boxShadow: isChecked ? '0 1px 3px rgba(22, 93, 255, 0.25)' : 'none',
                                userSelect: 'none',
                                margin: '0 auto',
                              }}
                              title={
                                isChecked
                                  ? `${asst.name} 已启用 ${sk.name} (点击取消打勾即刻关闭)`
                                  : `${asst.name} 未启用 ${sk.name} (点击打上✔ 立即生效)`
                              }
                            >
                              {isChecked ? '✓' : ''}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <>
          {/* 搜索与筛选控制栏 */}
          <div className="admin-skills-filter-row">
            <div className="admin-skills-search-input-wrap">
              <span aria-hidden="true">🔍</span>
              <input
                type="text"
                placeholder="搜索 skill..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          {/* 技能表格 */}
          <div className="admin-skills-table-card">
        <table className="admin-skills-table">
          <thead>
            <tr>
              <th style={{ width: '40px' }}>
                <input type="checkbox" readOnly />
              </th>
              <th>名称</th>
              <th>被谁使用</th>
              <th>添加者</th>
              <th>更新时间 ↓</th>
              <th style={{ textAlign: 'right', width: '80px' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {filteredSkills.map((skill) => {
              const bound = assistants.filter(
                (a) =>
                  skill.boundAssistantIds.some((id) => id === a.id || id === a.name) ||
                  ((a.enabledSkills as string[]) || []).includes(skill.id)
              );

              return (
                <tr
                  key={skill.id}
                  className="admin-skill-table-row"
                  onClick={() => {
                    setEditingSkill(skill);
                    setSelectedFileName(skill.files[0]?.name || 'SKILL.md');
                  }}
                >
                  <td onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" />
                  </td>
                  <td>
                    <strong className="admin-skill-table-name">{skill.name}</strong>
                  </td>
                  <td>
                    <div className="admin-skill-avatar-stack">
                      {bound.slice(0, 3).map((a) => (
                        <div key={a.id} className="admin-skill-avatar-circle" title={a.name}>
                          {a.avatar || '🤖'}
                        </div>
                      ))}
                      {bound.length > 3 ? (
                        <span className="admin-skill-avatar-more">+{bound.length - 3}</span>
                      ) : null}
                      {bound.length === 0 ? (
                        <span className="admin-skill-none-used">— 未使用</span>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    <div className="admin-skill-added-by-cell">
                      <span className="admin-skill-user-badge">Y</span>
                      <span>{skill.addedBy}</span>
                    </div>
                  </td>
                  <td>
                    <span className="admin-skill-time-cell">{skill.updatedAtText}</span>
                  </td>
                  <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
                      <button
                        type="button"
                        className="admin-skill-dot-btn"
                        onClick={() => {
                          setEditingSkill(skill);
                          setSelectedFileName(skill.files[0]?.name || 'SKILL.md');
                        }}
                        title="编辑技能"
                      >
                        ✏️
                      </button>
                      <button
                        type="button"
                        className="admin-skill-dot-btn"
                        style={{ color: '#ef4444' }}
                        onClick={() => handleDeleteSkill(skill.id, skill.name)}
                        title="删除技能"
                      >
                        🗑️
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </>
      )}
    </div>
  );
}
