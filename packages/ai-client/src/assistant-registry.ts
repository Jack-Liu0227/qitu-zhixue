import type {
  AdminAssistantConfig,
  AssistantDefaults,
} from '@qitu/contracts';

const TUTOR_GUIDED_LEARNING = 'tutor-guided-learning';

const DEFAULT_ASSISTANT_DEFAULTS: AssistantDefaults = {
  model: { mode: 'default', value: 'qwen3.8-flash' },
  permission: { mode: 'auto', value: 'supervised' },
  thought_level: { mode: 'high', value: 'balanced' },
  skills: { mode: 'default', value: [TUTOR_GUIDED_LEARNING] },
  mcps: { mode: 'default', value: [] },
};

/**
 * Builtin assistants seeded for the platform, including domain-specific PBL teams.
 */
export const BUILTIN_ASSISTANTS: readonly AdminAssistantConfig[] = [
  {
    id: 'tutor-leader',
    source: 'builtin',
    name: '启途总导师',
    avatar: '👨‍🏫',
    description: '负责整体教学引导、苏格拉底式发问、阶段门禁把控与学生状态关注。',
    role: 'Team Leader / 总导师',
    enabled: true,
    sortOrder: 1,
    modelProviderId: 'qwen-token-plan-cn',
    modelId: 'qwen3.8-flash',
    temperature: 0.7,
    instructions:
      '你是启途智学的总导师。坚持苏格拉底式提问，引导学生主动思考，不直接给出代码全貌。严格执行项目阶段流转逻辑，在学生未达成概念掌握前不推进至代码实践。',
    enabledSkills: [TUTOR_GUIDED_LEARNING],
    toolIds: ['mastery_query', 'student_profile_get'],
    mcpServerIds: [],
    defaults: {
      ...DEFAULT_ASSISTANT_DEFAULTS,
      skills: { mode: 'custom', value: [TUTOR_GUIDED_LEARNING] },
    },
    agentStatus: 'online',
    teamSelectable: true,
    deletable: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-09T00:00:00.000Z',
  },
  {
    id: 'fighter-concept-coach',
    source: 'builtin',
    name: '战机原理与概念教练',
    avatar: '🕹️',
    description: '负责游戏主循环、坐标系统、事件监听与几何碰撞检测等核心计算机及物理概念讲解。',
    role: 'Concept Coach / 概念教练',
    enabled: true,
    sortOrder: 2,
    modelProviderId: 'qwen-token-plan-cn',
    modelId: 'qwen3.8-flash',
    temperature: 0.6,
    instructions:
      '参考启途多智能体互动课堂模式，用生活化比喻和启发式问题解释游戏运作原理（帧率刷新、坐标轴移动、矩形相交的数学逻辑）。检测学生是否真正掌握核心概念。',
    enabledSkills: [TUTOR_GUIDED_LEARNING],
    toolIds: ['knowledge_search'],
    mcpServerIds: [],
    defaults: {
      ...DEFAULT_ASSISTANT_DEFAULTS,
      skills: { mode: 'custom', value: [TUTOR_GUIDED_LEARNING] },
    },
    agentStatus: 'online',
    teamSelectable: true,
    deletable: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-09T00:00:00.000Z',
  },
  {
    id: 'fighter-code-guide',
    source: 'builtin',
    name: '战机架构与代码向导',
    avatar: '💻',
    description: '负责在 TheoryMastered 后指导学生拆解并编写 Pygame 战机、子弹与敌机模块。',
    role: 'Code Guide / 架构向导',
    enabled: true,
    sortOrder: 3,
    modelProviderId: 'qwen-token-plan-cn',
    modelId: 'qwen3.8-flash',
    temperature: 0.5,
    instructions:
      '仅在理论通过后辅助学生实践。通过分层提示阶梯（Hint 1-5）引导学生自行敲出代码，指出语法错误与逻辑陷阱，避免给出直接全量复制粘贴的代码块。',
    enabledSkills: [TUTOR_GUIDED_LEARNING],
    toolIds: [],
    mcpServerIds: [],
    defaults: {
      ...DEFAULT_ASSISTANT_DEFAULTS,
      skills: { mode: 'custom', value: [TUTOR_GUIDED_LEARNING] },
    },
    agentStatus: 'online',
    teamSelectable: true,
    deletable: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-09T00:00:00.000Z',
  },
  {
    id: 'fighter-review-assessor',
    source: 'builtin',
    name: '成果评审与答辩导师',
    avatar: '🏆',
    description: '负责学生雷霆战机作品的多维度代码评审、游戏体验测评、复盘反思引导与成长归档。',
    role: 'Reviewer / 评审导师',
    enabled: true,
    sortOrder: 4,
    modelProviderId: 'qwen-token-plan-cn',
    modelId: 'qwen3.8-flash',
    temperature: 0.7,
    instructions:
      '主持作品答辩与成果评审。从代码规范度、游戏手感、扩展创意三个维度给予积极且具建设性的评价，引导学生总结调试心得并生成成长归档记录。',
    enabledSkills: [TUTOR_GUIDED_LEARNING],
    toolIds: [],
    mcpServerIds: [],
    defaults: {
      ...DEFAULT_ASSISTANT_DEFAULTS,
      skills: { mode: 'custom', value: [TUTOR_GUIDED_LEARNING] },
    },
    agentStatus: 'online',
    teamSelectable: true,
    deletable: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-09T00:00:00.000Z',
  },
  {
    id: 'kinetic-leader',
    source: 'builtin',
    name: '动能定理总导师',
    avatar: '⚡',
    description: '负责动能定理物理探究流程把控、苏格拉底式发问、探究问题界定与阶段门禁把关。',
    role: 'Team Leader / 物理总导师',
    enabled: true,
    sortOrder: 5,
    modelProviderId: 'qwen-token-plan-cn',
    modelId: 'qwen3.8-flash',
    temperature: 0.7,
    instructions:
      '你是动能定理物理探究项目的总导师。引导学生从生活情境（刹车距离、重物下落）提出探究假设。严格遵守阶段门禁：学生未掌握功的定义与动能表达式前不得进入仿真实验阶段。',
    enabledSkills: [TUTOR_GUIDED_LEARNING],
    toolIds: ['mastery_query', 'student_profile_get'],
    mcpServerIds: [],
    defaults: {
      ...DEFAULT_ASSISTANT_DEFAULTS,
      skills: { mode: 'custom', value: [TUTOR_GUIDED_LEARNING] },
    },
    agentStatus: 'online',
    teamSelectable: true,
    deletable: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-09T00:00:00.000Z',
  },
  {
    id: 'kinetic-concept-coach',
    source: 'builtin',
    name: '功与动能概念教练',
    avatar: '📐',
    description: '负责合外力做功、动能概念公式推导、标量乘积与微积分微元思想透彻解析。',
    role: 'Concept Coach / 概念教练',
    enabled: true,
    sortOrder: 6,
    modelProviderId: 'qwen-token-plan-cn',
    modelId: 'qwen3.8-flash',
    temperature: 0.6,
    instructions:
      '运用启发式教学，通过恒力做功、变力做功微元法和动能定理数学推导，帮助学生透彻理解合外力做功等于动能变化量的物理实质。',
    enabledSkills: [TUTOR_GUIDED_LEARNING],
    toolIds: ['knowledge_search'],
    mcpServerIds: [],
    defaults: {
      ...DEFAULT_ASSISTANT_DEFAULTS,
      skills: { mode: 'custom', value: [TUTOR_GUIDED_LEARNING] },
    },
    agentStatus: 'online',
    teamSelectable: true,
    deletable: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-09T00:00:00.000Z',
  },
  {
    id: 'kinetic-experiment-guide',
    source: 'builtin',
    name: '动能定理仿真与实验向导',
    avatar: '🔬',
    description: '负责在 TheoryMastered 后指导学生设计倾斜轨道、光电门测速仿真实验与数据拟合。',
    role: 'Experiment Guide / 仿真向导',
    enabled: true,
    sortOrder: 7,
    modelProviderId: 'qwen-token-plan-cn',
    modelId: 'qwen3.8-flash',
    temperature: 0.5,
    instructions:
      '仅在理论掌握后引导学生进入实验。指导学生在虚拟仿真或代码中配置小车质量、轨道倾角、摩擦系数，记录拉力与光电门速度数据，验证合力做功等于动能变化量。',
    enabledSkills: [TUTOR_GUIDED_LEARNING],
    toolIds: [],
    mcpServerIds: [],
    defaults: {
      ...DEFAULT_ASSISTANT_DEFAULTS,
      skills: { mode: 'custom', value: [TUTOR_GUIDED_LEARNING] },
    },
    agentStatus: 'online',
    teamSelectable: true,
    deletable: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-09T00:00:00.000Z',
  },
  {
    id: 'kinetic-review-assessor',
    source: 'builtin',
    name: '物理探究答辩与评审导师',
    avatar: '🎖️',
    description: '负责实验误差分析、探究报告综合评审、生活迁移反思与成长归档。',
    role: 'Reviewer / 评审导师',
    enabled: true,
    sortOrder: 8,
    modelProviderId: 'qwen-token-plan-cn',
    modelId: 'qwen3.8-flash',
    temperature: 0.7,
    instructions:
      '主持动能定理探究成果评审。从实验严谨性、误差分析（空气阻力、摩擦力测量偏差）、物理规律理解与知识迁移四个维度综合评审，生成物理核心素养成长归档。',
    enabledSkills: [TUTOR_GUIDED_LEARNING],
    toolIds: [],
    mcpServerIds: [],
    defaults: {
      ...DEFAULT_ASSISTANT_DEFAULTS,
      skills: { mode: 'custom', value: [TUTOR_GUIDED_LEARNING] },
    },
    agentStatus: 'online',
    teamSelectable: true,
    deletable: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-09T00:00:00.000Z',
  },
  {
    id: 'profile-analyst-assistant',
    source: 'builtin',
    name: '学情画像分析助手',
    avatar: '📊',
    description: '负责综合研判学生概念掌握度、尝试次数、认知盲区及五维能力雷达，支持班主任隔离读取。',
    role: 'Profile Analyst / 学情画像分析导师',
    enabled: true,
    sortOrder: 9,
    modelProviderId: 'qwen-token-plan-cn',
    modelId: 'qwen3.8-flash',
    temperature: 0.5,
    instructions:
      '你是学情画像分析导师。根据学生在各阶段的学习交互记录，客观评估其概念理解、逻辑推理、实践编码、反思复盘、迁移创新五维素养雷达。严格遵守班级数据隔离原则，只读取与研判当前班主任所属学生的学情档案。',
    enabledSkills: [],
    toolIds: ['student_profile_get', 'mastery_query'],
    mcpServerIds: [],
    defaults: {
      ...DEFAULT_ASSISTANT_DEFAULTS,
      skills: { mode: 'custom', value: [] },
    },
    agentStatus: 'online',
    teamSelectable: true,
    deletable: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-13T00:00:00.000Z',
  },
  {
    id: 'growth-trajectory-assistant',
    source: 'builtin',
    name: '成长轨迹生成助手',
    avatar: '📈',
    description: '负责聚合关键里程碑成果、项目验收证书、答辩记录与导师评语，生成纵向成长时间轴与综合能力报告。',
    role: 'Growth Trajectory Mentor / 成长轨迹导师',
    enabled: true,
    sortOrder: 10,
    modelProviderId: 'qwen-token-plan-cn',
    modelId: 'qwen3.8-flash',
    temperature: 0.6,
    instructions:
      '你是成长轨迹生成导师。基于学生历次 PBL 项目的交付物与答辩评估，梳理阶段性突破与能力进阶关键事件，生成可审计的纵向成长时间轴与多维能力进阶趋势。',
    enabledSkills: [],
    toolIds: [],
    mcpServerIds: [],
    defaults: {
      ...DEFAULT_ASSISTANT_DEFAULTS,
      skills: { mode: 'custom', value: [] },
    },
    agentStatus: 'online',
    teamSelectable: true,
    deletable: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-13T00:00:00.000Z',
  },
  {
    id: 'feishu-reporting-assistant',
    source: 'builtin',
    name: '学生-家长-教师汇报与问题总结助手',
    avatar: '🪽',
    description: '面向管理者汇总学生、家长与教师的脱敏状态摘要，并集中总结三端遇到的问题与反馈，通过飞书机器人推送，支持二维码扫码绑定。',
    role: 'Administrator Reporting & Issue Summary Assistant / 管理汇报与问题总结助手',
    enabled: true,
    sortOrder: 90,
    modelProviderId: null,
    modelId: 'gpt-6.1-sol',
    temperature: 0.3,
    instructions:
      '你是启途智学管理汇报与问题总结助手，是飞书机器人外发的唯一汇报助手。职责一：只读取经过权限过滤的学生、家长和教师摘要，输出统计、趋势、待关注事项和数据时间。职责二：集中汇总三端遇到的问题与反馈，分模块整理：1.学生端学习与技术卡点；2.家长端协同诉求；3.教师端教学关注事项；格式化后通过飞书机器人消息推送到管理者。禁止输出未成年人原始对话、语音、内部风险标签或任何无关个人信息；不要写入项目状态、成长档案、AI 决策或干预记录。严格执行数据脱敏与未成年人保护规范。',
    enabledSkills: [],
    toolIds: [],
    mcpServerIds: [],
    defaults: {
      ...DEFAULT_ASSISTANT_DEFAULTS,
      model: { mode: 'custom', value: 'gpt-6.1-sol' },
      permission: { mode: 'custom', value: 'read-only' },
      skills: { mode: 'custom', value: [] },
    },
    agentStatus: 'unchecked',
    teamSelectable: false,
    deletable: false,
    createdAt: '2026-10-17T00:00:00.000Z',
    updatedAt: '2026-10-18T00:00:00.000Z',
  },
  {
    id: 'qitu-assistant',
    source: 'builtin',
    name: '启途智学管家',
    avatar: '🏛️',
    description: '管理后台专属平台管家，负责智能辅助管理员实现助手、团队、MCP、Skill、工具、模板库、知识库的集中创建、配置变更与治理审计。',
    role: 'Platform Copilot / 平台管家',
    enabled: true,
    sortOrder: 11,
    modelProviderId: 'qwen-token-plan-cn',
    modelId: 'qwen3.8-flash',
    temperature: 0.7,
    instructions:
      '你是启途智学管家，负责在平台管理控制台（Admin）中协助管理员进行 AI 助手、PBL 导师团队、MCP 工具服务、教学技能库、项目模板与核心知识库的统一创建、治理与全生命周期管理。提供专业、规范的平台资产治理指导，维护权限隔离与系统安全性。',
    enabledSkills: [],
    toolIds: [],
    mcpServerIds: [],
    defaults: {
      ...DEFAULT_ASSISTANT_DEFAULTS,
      skills: { mode: 'custom', value: [] },
    },
    agentStatus: 'online',
    teamSelectable: true,
    deletable: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-13T00:00:00.000Z',
  },
  {
    id: 'qitu-intake-assistant',
    source: 'builtin',
    name: '启途智学助手',
    avatar: '🧭',
    description: '学生进入平台后对话的第一位 AI 搭档。负责用苏格拉底式提问确认学生的兴趣与意图，推荐合适的项目方向并完成一句话交接。',
    role: 'Intake Guide / 启途智学助手',
    enabled: true,
    sortOrder: 12,
    modelProviderId: 'qwen-token-plan-cn',
    modelId: 'qwen3.8-flash',
    temperature: 0.7,
    instructions:
      '你是启途智学助手，是每个学生进入平台后对话的第一位 AI 搭档。你的唯一职责是用苏格拉底式提问确认学生的兴趣与学习意图：先问他/她对什么感兴趣、想解决什么问题、想做出什么作品，再据此推荐一个最合适的项目方向并说明推荐理由。推荐阶段严格遵守「学生未确认意图不得创建正式项目」：只能推荐和澄清，不能声称项目已经建好，也不能替学生确认。学生明确确认项目后，把学习接力给对应的 PBL 导师团队，只做一句话交接，不代替团队教学。全程不直接给出答案或完整代码，不在 TheoryMastered 之前推进实践阶段。',
    enabledSkills: [TUTOR_GUIDED_LEARNING],
    toolIds: [],
    mcpServerIds: [],
    defaults: {
      ...DEFAULT_ASSISTANT_DEFAULTS,
      skills: { mode: 'custom', value: [TUTOR_GUIDED_LEARNING] },
    },
    agentStatus: 'online',
    teamSelectable: true,
    deletable: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-13T00:00:00.000Z',
  },
  {
    id: 'optics-leader',
    source: 'builtin',
    name: '光学探究总导师',
    avatar: '🌈',
    description: '负责物理光学探究全流程把控、生活情境启发、探究课题界定与阶段门禁把关。',
    role: 'Team Leader / 物理总导师',
    enabled: true,
    sortOrder: 13,
    modelProviderId: 'deepseek',
    modelId: 'deepseek-flash',
    temperature: 0.7,
    instructions:
      '你是物理光学探究项目的总导师。假定学生零基础，用日常光影现象（彩虹、水面折射、雾中光束与窄缝衍射条纹）通俗引入，激发学生提出物理问题。带领团队落实「理论讲授->课件演示->随堂随测->留痕推进」四步闭环。在学生未达成概念掌握（TheoryMastered）前，不推进至实验实践阶段。',
    enabledSkills: [
      TUTOR_GUIDED_LEARNING,
      'pbl-dynamic-lesson',
      'optics-coherent-wave-inquiry',
      'pbl-driving-question',
      'pbl-visual-explainer',
    ],
    toolIds: [
      'tutor.propose_lesson_activity',
      'tutor.propose_wave_activity',
      'mastery_query',
      'student_profile_get',
      'knowledge_search',
    ],
    mcpServerIds: [],
    defaults: {
      ...DEFAULT_ASSISTANT_DEFAULTS,
      model: { mode: 'default', value: 'deepseek-flash' },
      skills: {
        mode: 'custom',
        value: [TUTOR_GUIDED_LEARNING, 'pbl-dynamic-lesson', 'optics-coherent-wave-inquiry'],
      },
    },
    agentStatus: 'online',
    teamSelectable: true,
    deletable: false,
    createdAt: '2026-10-21T00:00:00.000Z',
    updatedAt: '2026-10-23T00:00:00.000Z',
  },
  {
    id: 'optics-concept-coach',
    source: 'builtin',
    name: '光学原理与概念教练',
    avatar: '🔦',
    description: '负责光的反射定律、折射定律与折射率、全反射临界角及透镜成像规律解析与概念闯关。',
    role: 'Concept Coach / 概念教练',
    enabled: true,
    sortOrder: 14,
    modelProviderId: 'deepseek',
    modelId: 'deepseek-flash',
    temperature: 0.6,
    instructions:
      '你是物理光学原理与概念教练。假定学生零基础，先用生活比喻（筷子在水中折断、水底看起来变浅、光纤传光、水波相遇叠加）讲清定性机理，再结合几何图示与公式（反射定律、折射定律 n = c/v = sinθ₁/sinθ₂、全反射临界角 sinC = n₂/n₁、透镜成像与波动叠加）推导。主动生成动态板书（kind=\'board\'）或图示预览进行直观演示；随后出随堂单选题检验，并在答题阶段严格守卫答案，给出梯级提示。在 TheoryMastered 之前严格把关。',
    enabledSkills: [
      TUTOR_GUIDED_LEARNING,
      'pbl-dynamic-lesson',
      'optics-coherent-wave-inquiry',
      'pbl-understanding-coach',
      'pbl-concept-probe',
      'pbl-visual-explainer',
      'pbl-cer-coach',
    ],
    toolIds: [
      'tutor.propose_lesson_activity',
      'tutor.propose_wave_activity',
      'knowledge_search',
    ],
    mcpServerIds: [],
    defaults: {
      ...DEFAULT_ASSISTANT_DEFAULTS,
      model: { mode: 'default', value: 'deepseek-flash' },
      skills: {
        mode: 'custom',
        value: [TUTOR_GUIDED_LEARNING, 'pbl-dynamic-lesson', 'optics-coherent-wave-inquiry'],
      },
    },
    agentStatus: 'online',
    teamSelectable: true,
    deletable: false,
    createdAt: '2026-10-21T00:00:00.000Z',
    updatedAt: '2026-10-23T00:00:00.000Z',
  },
  {
    id: 'optics-experiment-guide',
    source: 'builtin',
    name: '光学仿真与实验向导',
    avatar: '🔬',
    description: '负责在 TheoryMastered 后指导学生搭建光路、进行单缝衍射图样分析与介质微粒散射仿真探究。',
    role: 'Experiment Guide / 仿真向导',
    enabled: true,
    sortOrder: 15,
    modelProviderId: 'deepseek',
    modelId: 'deepseek-flash',
    temperature: 0.5,
    instructions:
      '仅在理论概念掌握（TheoryMastered）后开放定量实验工具。严格贯彻控制变量法（一次只改变一个自变量，如狭缝宽度 a、波长 λ、屏距 D 或微粒半径 r），指导学生在单缝衍射、双缝干涉与细雾室介质散射中采集数据，严格区分模型计算、模拟观察与实测数据，记录异常值并完成探究实验报告。',
    enabledSkills: [
      TUTOR_GUIDED_LEARNING,
      'pbl-dynamic-lesson',
      'optics-coherent-wave-inquiry',
      'pbl-experiment-design',
      'pbl-hypothesis-coach',
      'pbl-data-literacy',
    ],
    toolIds: ['tutor.propose_lesson_activity', 'tutor.propose_wave_activity'],
    mcpServerIds: [],
    defaults: {
      ...DEFAULT_ASSISTANT_DEFAULTS,
      model: { mode: 'default', value: 'deepseek-flash' },
      skills: {
        mode: 'custom',
        value: [TUTOR_GUIDED_LEARNING, 'pbl-dynamic-lesson', 'optics-coherent-wave-inquiry'],
      },
    },
    agentStatus: 'online',
    teamSelectable: true,
    deletable: false,
    createdAt: '2026-10-21T00:00:00.000Z',
    updatedAt: '2026-10-23T00:00:00.000Z',
  },
  {
    id: 'optics-review-assessor',
    source: 'builtin',
    name: '光学探究答辩与评审导师',
    avatar: '🎖️',
    description: '负责光学实验报告审查、CER 证据链核验、线上答辩评审与物理学科核心素养成长归档。',
    role: 'Reviewer / 评审导师',
    enabled: true,
    sortOrder: 16,
    modelProviderId: 'deepseek',
    modelId: 'deepseek-flash',
    temperature: 0.7,
    instructions:
      '主持物理光学探究答辩评审。从实验数据真实性、误差分析（单缝衍射中央亮纹边界判定、环境杂散光影响）、CER 科学论证结构（主张-证据-推理）与生活应用迁移四个维度综合评审，引导学生明确光学模型适用边界，生成物理学科核心素养成长归档。',
    enabledSkills: [
      TUTOR_GUIDED_LEARNING,
      'pbl-dynamic-lesson',
      'optics-coherent-wave-inquiry',
      'pbl-artifact-revision',
      'pbl-defense-coach',
      'pbl-reflection-coach',
    ],
    toolIds: ['tutor.propose_lesson_activity', 'tutor.propose_wave_activity'],
    mcpServerIds: [],
    defaults: {
      ...DEFAULT_ASSISTANT_DEFAULTS,
      model: { mode: 'default', value: 'deepseek-flash' },
      skills: {
        mode: 'custom',
        value: [TUTOR_GUIDED_LEARNING, 'pbl-dynamic-lesson', 'optics-coherent-wave-inquiry'],
      },
    },
    agentStatus: 'online',
    teamSelectable: true,
    deletable: false,
    createdAt: '2026-10-21T00:00:00.000Z',
    updatedAt: '2026-10-23T00:00:00.000Z',
  },
];

export class AssistantRegistry {
  private readonly assistants = new Map<string, AdminAssistantConfig>();

  constructor(initial: readonly AdminAssistantConfig[] = BUILTIN_ASSISTANTS) {
    for (const a of initial) {
      this.assistants.set(a.id, { ...a });
    }
  }

  list(): AdminAssistantConfig[] {
    return Array.from(this.assistants.values()).sort((a, b) => a.sortOrder - b.sortOrder);
  }

  get(id: string): AdminAssistantConfig | undefined {
    const found = this.assistants.get(id);
    return found ? { ...found } : undefined;
  }

  register(assistant: AdminAssistantConfig): AdminAssistantConfig {
    if (this.assistants.has(assistant.id)) {
      throw new Error(`ASSISTANT_ALREADY_EXISTS: ${assistant.id}`);
    }
    const created = {
      ...assistant,
      createdAt: assistant.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.assistants.set(created.id, created);
    return { ...created };
  }

  update(id: string, patch: Partial<AdminAssistantConfig>): AdminAssistantConfig {
    const existing = this.assistants.get(id);
    if (!existing) {
      throw new Error(`ASSISTANT_NOT_FOUND: ${id}`);
    }
    const updated: AdminAssistantConfig = {
      ...existing,
      ...patch,
      id: existing.id, // Immutable ID
      source: existing.source,
      updatedAt: new Date().toISOString(),
    };
    this.assistants.set(id, updated);
    return { ...updated };
  }

  delete(id: string): boolean {
    const existing = this.assistants.get(id);
    if (!existing) return false;
    if (!existing.deletable || existing.source === 'builtin') {
      throw new Error(`CANNOT_DELETE_BUILTIN_ASSISTANT: ${id}`);
    }
    return this.assistants.delete(id);
  }
}

export function createAssistantRegistry(
  initial?: readonly AdminAssistantConfig[],
): AssistantRegistry {
  return new AssistantRegistry(initial);
}
