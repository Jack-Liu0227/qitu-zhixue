import type { EvaluateMasteryInput, MasteryTimelinePort, ProjectStage, AdminAssistantConfig, AdminTeamConfig, AdminTeamMember, PblPhaseSpec, PblTeamWorkflowSpec } from '@qitu/contracts';
import { nextPblPhase, pblGatesRequiredToEnter } from './pbl-team.js';

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
  authorize?: (scope: Readonly<QituSDKScope>) => Promise<boolean>;
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
  /** Read fresh authorized projections, not global bootstrap defaults. */
  catalog?: {
    tools?(): Promise<QituToolDefinition[]>;
    skills?(): Promise<QituSkillDefinition[]>;
    assistants?(): Promise<readonly AdminAssistantConfig[]>;
    teams?(): Promise<readonly AdminTeamConfig[]>;
  };
  authorizeMcp?: (call: QituMCPToolCall, scope: Readonly<QituSDKScope>) => Promise<boolean>;
  mcpExecutor?: (call: QituMCPToolCall, scope: Readonly<QituSDKScope>) => Promise<unknown>;
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
    list(): Promise<QituToolDefinition[]>;
    get(toolId: string): Promise<QituToolDefinition | undefined>;
    call(toolId: string, args: Record<string, unknown>): Promise<unknown>;
  };

  /** 统一技能生态 (Skills) */
  readonly skills: {
    list(): Promise<QituSkillDefinition[]>;
    get(skillId: string): Promise<QituSkillDefinition | undefined>;
  };

  /** 统一 MCP 网关桥接 */
  readonly mcp: {
    callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<unknown>;
  };

  /** 助手统一注册与管理 (Assistants) */
  readonly assistants: {
    list(): Promise<readonly AdminAssistantConfig[]>;
    get(assistantId: string): Promise<AdminAssistantConfig | undefined>;
  };

  /** 团队与多智能体编排 (Teams & Multi-Agent Collaboration) */
  readonly teams: {
    list(): Promise<readonly AdminTeamConfig[]>;
    get(teamId: string): Promise<AdminTeamConfig | undefined>;
    getMembers(teamId: string): Promise<readonly AdminTeamMember[]>;
    getPblPhases(teamId: string): Promise<readonly PblPhaseSpec[]>;
    getWorkflowSpec(teamId: string): Promise<PblTeamWorkflowSpec>;
    getNextPhase: typeof nextPblPhase;
    getRequiredGates: typeof pblGatesRequiredToEnter;
  };
}

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

  const tools = async () => ports.catalog?.tools ? ports.catalog.tools() : Object.values(ports.tools ?? {});
  const skills = async () => ports.catalog?.skills ? ports.catalog.skills() : Object.values(ports.skills ?? {});
  const assistants = async () => ports.catalog?.assistants?.() ?? [];
  const teams = async () => ports.catalog?.teams?.() ?? [];
  const team = async (id: string) => {
    const found = (await teams()).find(item => item.id === id);
    if (!found) throw new Error('SDK_TEAM_NOT_AVAILABLE');
    return found;
  };
  // Never hand callers an execute closure that could bypass call-time authorization.
  const describe = ({ execute: _execute, authorize: _authorize, ...definition }: QituToolDefinition) => structuredClone(definition);

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
      list: async () => (await tools()).map(describe),
      get: async (id) => { const tool = (await tools()).find(item => item.id === id); return tool && describe(tool); },
      call: async (id, args) => {
        if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('SDK_TOOL_ARGUMENT_INVALID');
        const tool = (await tools()).find(item => item.id === id);
        if (!tool) throw new Error('SDK_TOOL_NOT_FOUND');
        if (!tool.execute) throw new Error('SDK_TOOL_NOT_CONFIGURED');
        if (!tool.authorize || !await tool.authorize(bound)) throw new Error('SDK_TOOL_DENIED');
        query(args);
        return tool.execute(args, bound);
      },
    },
    skills: {
      list: async () => structuredClone(await skills()),
      get: async (id) => structuredClone((await skills()).find(item => item.id === id)),
    },
    mcp: {
      callTool: async (serverName, toolName, args) => {
        if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('SDK_TOOL_ARGUMENT_INVALID');
        if (!ports.mcpExecutor) throw new Error('SDK_MCP_NOT_CONFIGURED');
        const call = { serverName, toolName, arguments: args };
        if (!ports.authorizeMcp || !await ports.authorizeMcp(call, bound)) throw new Error('SDK_MCP_DENIED');
        query(args);
        return ports.mcpExecutor(call, bound);
      },
    },
    assistants: {
      list: async () => structuredClone(await assistants()),
      get: async (id) => structuredClone((await assistants()).find(item => item.id === id)),
    },
    teams: {
      list: async () => structuredClone(await teams()),
      get: async (id) => structuredClone((await teams()).find(item => item.id === id)),
      getMembers: async (id) => structuredClone((await team(id)).members),
      getPblPhases: async (id) => structuredClone((await team(id)).pblSpec?.phases ?? []),
      getWorkflowSpec: async (id) => {
        const spec = (await team(id)).pblSpec;
        if (!spec) throw new Error('SDK_TEAM_WORKFLOW_NOT_CONFIGURED');
        return structuredClone(spec);
      },
      getNextPhase: nextPblPhase,
      getRequiredGates: pblGatesRequiredToEnter,
    },
  };
}
