import { Inject, Injectable } from '@nestjs/common';
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
  ) {
    const runtimeScope: TutorAgentScope = {
      actorId: actor.id,
      studentId: scope.studentId,
      partnerId: 'qitu-learning-partner',
      projectId: scope.projectId,
      sessionId: null,
      schoolId: null,
      actorRole: actor.role as TutorAgentActorRole,
    };

    const runThroughAgentRuntime = async (input: Input): Promise<Result> => {
      const shape: RuntimeInputShape = isRecord(input) ? input : {};
      const requestId = readString(shape.requestId) ?? `sdk-request-${Date.now()}`;
      const idempotencyKey = readString(shape.idempotencyKey) ?? `sdk:${requestId}`;
      const query = readString(shape.query) ?? readString(shape.content) ?? '当前学习任务';
      const agentRuntime = await this.platformRegistry.getAgentRuntime(runtimeScope.partnerId);
      if (!agentRuntime.agent.enabled) throw new Error('AGENT_ROLE_DISABLED');
      const usageOverride = modelUsageOverride ?? agentRuntime.agent.modelUsage ?? undefined;
      const runtime = createTutorAgentRuntime<Record<string, never>, { data: Result }>(runtimeScope, {
        modelPurpose: {
          resolve: async ({ capability }) => this.resolvePurpose(capability, usageOverride),
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
              modelUsage: request.modelUsage ?? 'tutor.chat',
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
            const purpose = await this.resolvePurposeByUsage(request.context.modelUsage);
            const result = await runner(input, purpose);
            return {
              id: `${request.requestId}:output`,
              runId: `${request.requestId}:run`,
              requestId: request.requestId,
              kind: 'reply' as const,
              agentId: runtimeScope.partnerId,
              agentVersion: 'partner.v1',
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

  private async resolvePurpose(capability: TutorAgentCapability, modelUsageOverride?: string): Promise<TutorAgentModelPurpose> {
    const usageId = modelUsageOverride ?? USAGE_BY_CAPABILITY[capability];
    if (this.dataMode !== 'live') {
      return { usageId, available: true, input: ['text'], output: ['text'], modelId: 'heuristic-v1' };
    }
    return this.registry.resolvePurpose(usageId);
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
