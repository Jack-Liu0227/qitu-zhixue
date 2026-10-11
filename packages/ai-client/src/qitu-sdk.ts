import type { EvaluateMasteryInput, MasteryTimelinePort, ProjectStage, AdminAssistantConfig, AdminTeamConfig, AdminTeamMember, PblPhaseSpec, PblTeamWorkflowSpec } from '@qitu/contracts';
import { BUILTIN_ASSISTANTS } from './assistant-registry.js';
import {
  THUNDER_FIGHTER_PHASES,
  THUNDER_FIGHTER_PBL_SPEC,
  THUNDER_FIGHTER_TEAM_MEMBERS,
  THUNDER_FIGHTER_TEAM_CONFIG,
  KINETIC_ENERGY_PHASES,
  KINETIC_ENERGY_PBL_SPEC,
  KINETIC_ENERGY_TEAM_MEMBERS,
  KINETIC_ENERGY_TEAM_CONFIG,
  nextPblPhase,
  pblGatesRequiredToEnter,
} from './pbl-team.js';

export interface QituSDKScope {
  studentId: string;
  projectId: string | null;
}

export interface QituProjectGate {
  allowed: boolean;
  stage: ProjectStage;
  nextStage: ProjectStage | null;
  reason: string;
}

export interface QituToolDefinition {
  id: string;
  name: string;
  description: string;
  parametersSchema?: Record<string, unknown>;
  execute?: (args: Record<string, unknown>, scope: Readonly<QituSDKScope>) => Promise<unknown>;
}

export interface QituSkillDefinition {
  id: string;
  name: string;
  description: string;
  tools: string[];
  systemPromptModifier?: string;
}

export interface QituMCPToolCall {
  serverName: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface QituSDKPorts<Input, Result, Profile> {
  mastery: MasteryTimelinePort;
  agent: { run(input: Input, scope: Readonly<QituSDKScope>): Promise<Result> };
  project: {
    canAdvance(scope: Readonly<QituSDKScope>): Promise<QituProjectGate>;
    advance(scope: Readonly<QituSDKScope>, idempotencyKey: string): Promise<QituProjectGate>;
  };
  profile: { get(scope: Readonly<QituSDKScope>): Promise<Profile> };
  tools?: Record<string, QituToolDefinition>;
  skills?: Record<string, QituSkillDefinition>;
  mcpExecutor?: (call: QituMCPToolCall) => Promise<unknown>;
}

export interface QituSDK<Input, Result, Profile> {
  readonly scope: Readonly<QituSDKScope>;
  readonly mastery: {
    evaluate(input: Omit<EvaluateMasteryInput, 'studentId' | 'projectId'>): ReturnType<MasteryTimelinePort['evaluate']>;
    getCurrent(input?: Omit<Parameters<MasteryTimelinePort['getCurrent']>[0], 'studentId'>): ReturnType<MasteryTimelinePort['getCurrent']>;
    getTimeline(input: Omit<Parameters<MasteryTimelinePort['getTimeline']>[0], 'studentId'>): ReturnType<MasteryTimelinePort['getTimeline']>;
    snapshot(input: Omit<Parameters<MasteryTimelinePort['snapshot']>[0], 'studentId'>): ReturnType<MasteryTimelinePort['snapshot']>;
    checkThreshold(input: Omit<Parameters<MasteryTimelinePort['checkThreshold']>[0], 'studentId'>): ReturnType<MasteryTimelinePort['checkThreshold']>;
    getRegressionAlerts(input?: Omit<Parameters<MasteryTimelinePort['getRegressionAlerts']>[0], 'studentId'>): ReturnType<MasteryTimelinePort['getRegressionAlerts']>;
  };
  readonly agent: { run(input: Input): Promise<Result> };
  readonly project: {
    canAdvance(): Promise<QituProjectGate>;
    advance(idempotencyKey: string): Promise<QituProjectGate>;
  };
  readonly profile: { get(): Promise<Profile> };

  /** 统一工具生态 (Tools) */
  readonly tools: {
    list(): QituToolDefinition[];
    get(toolId: string): QituToolDefinition | undefined;
    call(toolId: string, args: Record<string, unknown>): Promise<unknown>;
  };

  /** 统一技能生态 (Skills) */
  readonly skills: {
    list(): QituSkillDefinition[];
    get(skillId: string): QituSkillDefinition | undefined;
  };

  /** 统一 MCP 网关桥接 */
  readonly mcp: {
    callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<unknown>;
  };

  /** 助手统一注册与管理 (Assistants) */
  readonly assistants: {
    list(): readonly AdminAssistantConfig[];
    get(assistantId: string): AdminAssistantConfig | undefined;
  };

  /** 团队与多智能体编排 (Teams & Multi-Agent Collaboration) */
  readonly teams: {
    list(): readonly AdminTeamConfig[];
    get(teamId: string): AdminTeamConfig | undefined;
    getMembers(teamId?: string): readonly AdminTeamMember[];
    getPblPhases(teamId?: string): readonly PblPhaseSpec[];
    getWorkflowSpec(teamId?: string): PblTeamWorkflowSpec;
    getNextPhase: typeof nextPblPhase;
    getRequiredGates: typeof pblGatesRequiredToEnter;
  };
}

const BUILTIN_TOOLS: Record<string, QituToolDefinition> = {
  mastery_query: {
    id: 'mastery_query',
    name: '知识掌握度查询',
    description: '查询当前学生在各个知识点和概念上的最新掌握度分值与掌握状态',
  },
  learning_plan_advance: {
    id: 'learning_plan_advance',
    name: '学习计划门禁流转',
    description: '校验阶段前置条件并在满足时推进项目到下一阶段',
  },
  student_profile_get: {
    id: 'student_profile_get',
    name: '学生能力画像获取',
    description: '获取学生的六维能力雷达（概念理解、工程实践、自主排错、创新拓展、反思复盘、协作表达）',
  },
  knowledge_search: {
    id: 'knowledge_search',
    name: '学科与项目知识检索',
    description: '在平台项目知识库中检索概念、算法公式及参考示例',
  },
};

const BUILTIN_SKILLS: Record<string, QituSkillDefinition> = {
  guided: {
    id: 'guided',
    name: '苏格拉底式启发引导',
    description: '不直接给出终态答案或完整代码，通过阶梯式提问激发自主探究',
    tools: ['knowledge_search'],
    systemPromptModifier: '坚持苏格拉底式提问，引导学生主动思考。',
  },
  planning: {
    id: 'planning',
    name: '项目阶段与任务拆解',
    description: '拆解大型项目至可执行微步，跟踪各里程碑交付物',
    tools: ['learning_plan_advance'],
  },
  escalation: {
    id: 'escalation',
    name: '困难升级与真人介入',
    description: '检测到学生多次困惑或挫败时，自动升格并提醒班主任老师',
    tools: [],
  },
  'openmaic-interactive-concept': {
    id: 'openmaic-interactive-concept',
    name: 'OpenMAIC 概念互动演示',
    description: '通过生动比喻、帧循环演示和即时选择题检验学生对核心机制的掌握',
    tools: ['mastery_query'],
  },
};

/** Server composition only. All permissions and writes remain in the supplied domain ports. */
export function createQituSDK<Input, Result, Profile>(
  scope: QituSDKScope,
  ports: QituSDKPorts<Input, Result, Profile>,
): QituSDK<Input, Result, Profile> {
  if (!scope.studentId || !ports.mastery || !ports.agent?.run || !ports.project?.advance || !ports.project?.canAdvance || !ports.profile?.get) {
    throw new Error('SDK_PORT_NOT_CONFIGURED');
  }
  const bound = Object.freeze({ ...scope });
  function query<T extends object>(input: T) {
    if ('studentId' in input && input.studentId !== bound.studentId) throw new Error('SDK_SCOPE_MISMATCH');
    if ('projectId' in input && input.projectId !== bound.projectId) throw new Error('SDK_SCOPE_MISMATCH');
    return { ...input, studentId: bound.studentId };
  }

  const toolRegistry = { ...BUILTIN_TOOLS, ...(ports.tools || {}) };
  const skillRegistry = { ...BUILTIN_SKILLS, ...(ports.skills || {}) };

  return {
    scope: bound,
    mastery: {
      evaluate: (input: Omit<EvaluateMasteryInput, 'studentId' | 'projectId'>) =>
        ports.mastery.evaluate({ ...query(input), projectId: bound.projectId } as EvaluateMasteryInput),
      getCurrent: (input: Omit<Parameters<MasteryTimelinePort['getCurrent']>[0], 'studentId'> = { validAt: null, knownAt: null }) =>
        ports.mastery.getCurrent(query(input)),
      getTimeline: (input: Omit<Parameters<MasteryTimelinePort['getTimeline']>[0], 'studentId'>) =>
        ports.mastery.getTimeline(query(input)),
      snapshot: (input: Omit<Parameters<MasteryTimelinePort['snapshot']>[0], 'studentId'>) =>
        ports.mastery.snapshot(query(input)),
      checkThreshold: (input: Omit<Parameters<MasteryTimelinePort['checkThreshold']>[0], 'studentId'>) =>
        ports.mastery.checkThreshold(query(input)),
      getRegressionAlerts: (input: Omit<Parameters<MasteryTimelinePort['getRegressionAlerts']>[0], 'studentId'> = {}) =>
        ports.mastery.getRegressionAlerts(query(input)),
    },
    agent: { run: (input: Input) => ports.agent.run(input, bound) },
    project: {
      canAdvance: () => ports.project.canAdvance(bound),
      advance: (idempotencyKey: string) => {
        if (!idempotencyKey?.trim()) throw new Error('IDEMPOTENCY_KEY_REQUIRED');
        return ports.project.advance(bound, idempotencyKey);
      },
    },
    profile: { get: () => ports.profile.get(bound) },

    tools: {
      list: () => Object.values(toolRegistry),
      get: (id: string) => toolRegistry[id],
      call: async (id: string, args: Record<string, unknown>) => {
        const t = toolRegistry[id];
        if (!t) throw new Error(`TOOL_NOT_FOUND: ${id}`);
        if (t.execute) return t.execute(args, bound);
        return { ok: true, tool: id, echoed: args };
      },
    },

    skills: {
      list: () => Object.values(skillRegistry),
      get: (id: string) => skillRegistry[id],
    },

    mcp: {
      callTool: async (serverName: string, toolName: string, args: Record<string, unknown>) => {
        if (ports.mcpExecutor) {
          return ports.mcpExecutor({ serverName, toolName, arguments: args });
        }
        return { ok: true, server: serverName, tool: toolName, arguments: args };
      },
    },

    assistants: {
      list: () => BUILTIN_ASSISTANTS,
      get: (id: string) => BUILTIN_ASSISTANTS.find((a) => a.id === id),
    },

    teams: {
      list: () => [THUNDER_FIGHTER_TEAM_CONFIG, KINETIC_ENERGY_TEAM_CONFIG],
      get: (teamId: string) => [THUNDER_FIGHTER_TEAM_CONFIG, KINETIC_ENERGY_TEAM_CONFIG].find((t) => t.id === teamId),
      getMembers: (teamId?: string) => {
        if (teamId === 'team-kinetic-energy-pbl') return KINETIC_ENERGY_TEAM_MEMBERS;
        return THUNDER_FIGHTER_TEAM_MEMBERS;
      },
      getPblPhases: (teamId?: string) => {
        if (teamId === 'team-kinetic-energy-pbl') return KINETIC_ENERGY_PHASES;
        return THUNDER_FIGHTER_PHASES;
      },
      getWorkflowSpec: (teamId?: string) => {
        if (teamId === 'team-kinetic-energy-pbl') return KINETIC_ENERGY_PBL_SPEC;
        return THUNDER_FIGHTER_PBL_SPEC;
      },
      getNextPhase: nextPblPhase,
      getRequiredGates: pblGatesRequiredToEnter,
    },
  };
}
