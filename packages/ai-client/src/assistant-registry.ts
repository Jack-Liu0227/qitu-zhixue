import type {
  AdminAssistantConfig,
  AssistantDefaults,
} from '@qitu/contracts';

const DEFAULT_ASSISTANT_DEFAULTS: AssistantDefaults = {
  model: { mode: 'default', value: 'qwen3.8-flash' },
  permission: { mode: 'auto', value: 'supervised' },
  thought_level: { mode: 'high', value: 'balanced' },
  skills: { mode: 'default', value: ['guided', 'planning', 'escalation'] },
  mcps: { mode: 'default', value: [] },
};

/**
 * Builtin assistants seeded for the platform, including the Thunder Fighter PBL team members.
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
    enabledSkills: ['guided', 'planning', 'escalation', 'pbl-orchestration'],
    toolIds: ['mastery_query', 'learning_plan_advance', 'student_profile_get'],
    mcpServerIds: [],
    defaults: {
      ...DEFAULT_ASSISTANT_DEFAULTS,
      skills: { mode: 'custom', value: ['guided', 'planning', 'escalation', 'pbl-orchestration'] },
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
      '参考 OpenMAIC 多智能体互动课堂模式，用生活化比喻和启发式问题解释游戏运作原理（帧率刷新、坐标轴移动、矩形相交的数学逻辑）。检测学生是否真正掌握核心概念。',
    enabledSkills: ['guided', 'hint', 'openmaic-interactive-concept'],
    toolIds: ['knowledge_search', 'mastery_assess'],
    mcpServerIds: [],
    defaults: {
      ...DEFAULT_ASSISTANT_DEFAULTS,
      skills: { mode: 'custom', value: ['guided', 'hint', 'openmaic-interactive-concept'] },
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
    enabledSkills: ['hint', 'project-implementation', 'debugging-guide'],
    toolIds: ['code_syntax_check', 'step_validator'],
    mcpServerIds: [],
    defaults: {
      ...DEFAULT_ASSISTANT_DEFAULTS,
      skills: { mode: 'custom', value: ['hint', 'project-implementation', 'debugging-guide'] },
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
    enabledSkills: ['project-review', 'growth-evaluation', 'socratic-reflection'],
    toolIds: ['artifact_review', 'growth_record_append'],
    mcpServerIds: [],
    defaults: {
      ...DEFAULT_ASSISTANT_DEFAULTS,
      skills: { mode: 'custom', value: ['project-review', 'growth-evaluation', 'socratic-reflection'] },
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
    enabledSkills: ['guided', 'planning', 'physics-inquiry', 'pbl-orchestration'],
    toolIds: ['mastery_query', 'learning_plan_advance', 'student_profile_get'],
    mcpServerIds: [],
    defaults: {
      ...DEFAULT_ASSISTANT_DEFAULTS,
      skills: { mode: 'custom', value: ['guided', 'planning', 'physics-inquiry', 'pbl-orchestration'] },
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
    enabledSkills: ['guided', 'hint', 'physics-derivation'],
    toolIds: ['knowledge_search', 'mastery_assess'],
    mcpServerIds: [],
    defaults: {
      ...DEFAULT_ASSISTANT_DEFAULTS,
      skills: { mode: 'custom', value: ['guided', 'hint', 'physics-derivation'] },
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
    enabledSkills: ['hint', 'simulation-experiment', 'data-fitting'],
    toolIds: ['simulation_runner', 'data_analyzer'],
    mcpServerIds: [],
    defaults: {
      ...DEFAULT_ASSISTANT_DEFAULTS,
      skills: { mode: 'custom', value: ['hint', 'simulation-experiment', 'data-fitting'] },
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
    enabledSkills: ['project-review', 'growth-evaluation', 'error-analysis'],
    toolIds: ['artifact_review', 'growth_record_append'],
    mcpServerIds: [],
    defaults: {
      ...DEFAULT_ASSISTANT_DEFAULTS,
      skills: { mode: 'custom', value: ['project-review', 'growth-evaluation', 'error-analysis'] },
    },
    agentStatus: 'online',
    teamSelectable: true,
    deletable: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-09T00:00:00.000Z',
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
