import { RUNTIME_TOOL_CATALOG } from '@qitu/contracts';
import { ConflictException, Inject, Injectable } from '@nestjs/common';
import {
  createQituSDK,
  createTutorAgentRuntime,
} from '@qitu/ai-client';
import type {
  CurrentUser,
  TutorAgentActorRole,
  TutorAgentCapability,
  TutorAgentModelPurpose,
  TutorAgentOutput,
  TutorAgentScope,
} from '@qitu/contracts';
import { MasteryDomainService } from '../mastery/mastery-domain.service';
import { ProjectLifecycleService } from '../projects/project-lifecycle.service';
import { GrowthService } from '../growth/growth.service';
import { DATA_MODE_TOKEN, type DataMode } from '../../database';
import { ModelRegistryService } from '../model-registry/model-registry.service';
import { PlatformRegistryService } from '../platform-registry/platform-registry.service';
import type { EffectiveAgentRuntime } from '../platform-registry/platform-registry.service';
import { hashRequest } from '../../common/idempotency';

const USAGE_BY_CAPABILITY: Readonly<Record<TutorAgentCapability, string>> = {
  explore: 'tutor.chat',
  plan: 'curriculum.plan',
  teach: 'tutor.chat',
  review: 'tutor.chat',
  reflect: 'tutor.chat',
  summarize: 'growth.summarize',
};

interface RuntimeInputShape {
  idempotencyKey?: unknown;
  requestId?: unknown;
  query?: unknown;
  content?: unknown;
}

@Injectable()
export class QituSDKFactory {
  constructor(
    private readonly mastery: MasteryDomainService,
    private readonly projects: ProjectLifecycleService,
    private readonly growth: GrowthService,
    private readonly registry: ModelRegistryService,
    private readonly platformRegistry: PlatformRegistryService,
    @Inject(DATA_MODE_TOKEN) private readonly dataMode: DataMode,
  ) {}

  create<Input, Result>(
    actor: CurrentUser,
    scope: { studentId: string; projectId: string | null },
    runner: (input: Input, purpose: TutorAgentModelPurpose) => Promise<Result>,
    modelUsageOverride?: string,
    modelSelectionOverride?: { providerId: string; modelId: string } | null,
    assistantExecution?: { assistantId: string; configurationHash: string; resolveRuntime?: () => Promise<EffectiveAgentRuntime> },
  ) {
    const runtimeScope: TutorAgentScope = {
      actorId: actor.id,
      studentId: scope.studentId,
      partnerId: assistantExecution?.assistantId ?? 'qitu-learning-partner',
      projectId: scope.projectId,
      sessionId: null,
      schoolId: null,
      actorRole: actor.role as TutorAgentActorRole,
    };

    const resolveRuntime = async (): Promise<EffectiveAgentRuntime> => {
      const current = assistantExecution === undefined
        ? await this.platformRegistry.getAgentRuntime(runtimeScope.partnerId)
        : assistantExecution.resolveRuntime ? await assistantExecution.resolveRuntime()
          : await this.platformRegistry.getAssistantRuntime(runtimeScope.partnerId);
      if (!current.agent.enabled) throw new Error('AGENT_ROLE_DISABLED');
      if (current.agent.id !== runtimeScope.partnerId) {
        throw new ConflictException({ code: 'ASSISTANT_RUNTIME_IDENTITY_MISMATCH', message: 'Runtime identity is unavailable' });
      }
      return current;
    };
    const runThroughAgentRuntime = async (input: Input): Promise<Result> => {
      const shape: RuntimeInputShape = isRecord(input) ? input : {};
      const requestId = readString(shape.requestId) ?? `sdk-request-${Date.now()}`;
      const idempotencyKey = readString(shape.idempotencyKey) ?? `sdk:${requestId}`;
      const query = readString(shape.query) ?? readString(shape.content) ?? '当前学习任务';
      const agentRuntime = await resolveRuntime();
      if (!agentRuntime.agent.enabled) throw new Error('AGENT_ROLE_DISABLED');
      if (assistantExecution !== undefined) {
        if (agentRuntime.agent.id !== runtimeScope.partnerId || !agentRuntime.agent.capabilities.includes('teach')) {
          throw new ConflictException({ code: 'ASSISTANT_RUNTIME_IDENTITY_MISMATCH', message: 'Teaching runtime identity is unavailable' });
        }
        // This is only a single-turn consistency token. Re-read current denies
        // on every action; do not mix an old prompt with a newly selected model.
        if (hashRequest(agentRuntime) !== assistantExecution.configurationHash) {
          throw new ConflictException({ code: 'ASSISTANT_RUNTIME_CHANGED', message: 'Teaching configuration changed; retry this turn' });
        }
        if (modelSelectionOverride === undefined || modelSelectionOverride === null
          || modelSelectionOverride.providerId !== agentRuntime.agent.modelProviderId
          || modelSelectionOverride.modelId !== agentRuntime.agent.modelId) {
          throw new ConflictException({ code: 'ASSISTANT_MODEL_IDENTITY_MISMATCH', message: 'Teaching model selection does not match its assistant' });
        }
      }
      const usageOverride = modelUsageOverride ?? 'tutor.chat';
      const runtime = createTutorAgentRuntime<Record<string, never>, { data: Result }>(runtimeScope, {
        modelPurpose: {
          resolve: async ({ capability }) => this.resolvePurpose(capability, usageOverride, modelSelectionOverride),
        },
        context: {
          async build({ scope: bound, request }) {
            return {
              contextId: request.requestId,
              runtimeVersion: 'qitu.agent-runtime.v1',
              builtAt: new Date().toISOString(),
              policyVersion: agentRuntime.policy.version,
              agentDefinition: agentRuntime.agent.agentDefinition,
              skills: agentRuntime.skills.map((skill) => ({ id: skill.id, version: skill.version, content: skill.content })),
              tools: agentRuntime.tools,
              mcpServers: agentRuntime.mcpServers,
              scope: bound,
              capability: request.capability,
              modelUsage: request.modelUsage ?? (modelSelectionOverride !== undefined ? 'agent.model' : 'tutor.chat'),
              query: request.query,
              projectStage: request.projectStage,
              goal: request.goal,
              evidenceRefs: request.evidenceRefs ?? [],
              data: {},
            };
          },
        },
        executor: {
          run: async (request) => {
            // The runtime has already validated the server-owned usage identity.
            // Re-resolve only the redacted capability projection; no credential enters this closure.
            const purpose = modelSelectionOverride === null
              ? { usageId: 'agent.model', available: false, input: [], output: [], modelId: null }
              : modelSelectionOverride !== undefined
                ? await this.resolvePurposeByModel(modelSelectionOverride)
                : await this.resolvePurposeByUsage(request.context.modelUsage);
            const result = await runner(input, purpose);
            return {
              id: `${request.requestId}:output`,
              runId: `${request.requestId}:run`,
              requestId: request.requestId,
              kind: 'reply' as const,
              agentId: runtimeScope.partnerId,
              agentVersion: agentRuntime.agent.promptVersion ?? 'unversioned',
              runtimeVersion: 'qitu.agent-runtime.v1' as const,
              generatedAt: new Date().toISOString(),
              sourceRefs: [],
              toolCalls: [],
              payload: { data: result },
            } satisfies TutorAgentOutput<{ data: Result }>;
          },
        },
        read: {
          knowledge: { search: async () => [] },
          templates: { listPublished: async () => [] },
          database: { readProjection: async () => null as never },
        },
        tools: this.platformRegistry.getAgentRuntimeTools(agentRuntime),
      });

      const output = await runtime.run({
        requestId,
        idempotencyKey,
        capability: 'teach',
        query,
        projectStage: null,
        goal: null,
      });
      return output.payload.data;
    };

    return createQituSDK<Input, Result, Awaited<ReturnType<GrowthService['getMasteryProfile']>>>(scope, {
      catalog: {
        skills: async () => {
          const runtime = await resolveRuntime();
          if (!runtime.agent.enabled) throw new Error('AGENT_ROLE_DISABLED');
          return runtime.skills.map(skill => ({ id: skill.id, name: skill.label,
            description: skill.description ?? '', tools: [...(skill.requiredToolIds ?? [])], systemPromptModifier: skill.content }));
        },
        tools: async () => {
          const runtime = await resolveRuntime();
          if (!runtime.agent.enabled) throw new Error('AGENT_ROLE_DISABLED');
          const definitions: import('@qitu/ai-client').QituToolDefinition[] = runtime.tools.filter(tool => !['mastery_query', 'student_profile_get'].includes(tool.id)).map(tool => ({
            id: tool.id, name: tool.id, description: 'Server-owned domain capability; no generic model executor',
          }));
          for (const id of ['mastery_query', 'student_profile_get']) {
            if (!runtime.tools.some(tool => tool.id === id)) continue;
            definitions.push({
              id, name: id, description: 'Authorized read-only domain projection',
              parametersSchema: RUNTIME_TOOL_CATALOG.find(tool => tool.id === id)!.inputSchema,
              authorize: async () => {
                const fresh = await resolveRuntime();
                return fresh.tools.some(tool => tool.id === id);
              },
              execute: async (args, bound) => {
                if (Object.keys(args).length) throw new Error('SDK_TOOL_ARGUMENT_INVALID');
                return id === 'mastery_query'
                  ? this.mastery.forActor(actor).getCurrent({ studentId: bound.studentId, validAt: null, knownAt: null })
                  : this.growth.getMasteryProfile(actor, bound.studentId);
              },
            });
          }
          return definitions;
        },
        assistants: async () => (await this.platformRegistry.listAssistants()).filter(item => item.id === runtimeScope.partnerId && item.enabled),
      },
      mastery: this.mastery.forActor(actor),
      agent: {
        run: async (input, bound) => {
          // Resolve authorization on every action, not only when constructing the facade.
          await this.mastery.forActor(actor).getCurrent({ studentId: bound.studentId, validAt: null, knownAt: null });
          const result = await runThroughAgentRuntime(input);
          if (bound.projectId) await this.mastery.reassessProjectEvidence(actor, bound.studentId, bound.projectId);
          return result;
        },
      },
      project: {
        canAdvance: (bound) => {
          if (!bound.projectId) throw new Error('SDK_PROJECT_REQUIRED');
          return this.projects.canAdvance(actor, bound.studentId, bound.projectId);
        },
        advance: (bound, key) => {
          if (!bound.projectId) throw new Error('SDK_PROJECT_REQUIRED');
          return this.projects.advance(actor, bound.studentId, bound.projectId, key);
        },
      },
      profile: { get: (bound) => this.growth.getMasteryProfile(actor, bound.studentId) },
    });
  }

  private async resolvePurpose(
    capability: TutorAgentCapability,
    modelUsageOverride?: string,
    modelSelectionOverride?: { providerId: string; modelId: string } | null,
  ): Promise<TutorAgentModelPurpose> {
    if (modelSelectionOverride !== undefined) {
      if (this.dataMode !== 'live') {
        return { usageId: 'agent.model', available: true, input: ['text'], output: ['text'], modelId: 'heuristic-v1' };
      }
      if (modelSelectionOverride === null) {
        return { usageId: 'agent.model', available: false, input: [], output: [], modelId: null };
      }
      return this.resolvePurposeByModel(modelSelectionOverride);
    }
    const usageId = modelUsageOverride ?? USAGE_BY_CAPABILITY[capability];
    if (this.dataMode !== 'live') {
      return { usageId, available: true, input: ['text'], output: ['text'], modelId: 'heuristic-v1' };
    }
    return this.registry.resolvePurpose(usageId);
  }

  private async resolvePurposeByModel(selection: { providerId: string; modelId: string }): Promise<TutorAgentModelPurpose> {
    if (this.dataMode !== 'live') {
      return { usageId: 'agent.model', available: true, input: ['text'], output: ['text'], modelId: 'heuristic-v1' };
    }
    return this.registry.resolvePurposeByModel(selection);
  }

  private async resolvePurposeByUsage(usageId: string): Promise<TutorAgentModelPurpose> {
    if (this.dataMode !== 'live') {
      return { usageId, available: true, input: ['text'], output: ['text'], modelId: 'heuristic-v1' };
    }
    return this.registry.resolvePurpose(usageId);
  }
}

function isRecord(value: unknown): value is RuntimeInputShape {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}
