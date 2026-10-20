import { OPTICS_16_SESSION_TEMPLATE_SPEC, OPTICS_PHASES } from '@qitu/ai-client/quiz-bank';
import type { ProjectTemplateSpec, TeachingBundleDraft } from '@qitu/contracts';
import { loadTutorRuntimeSource } from '../../common/tutor-runtime/runtime-source';
import { TeachingBundleCatalog } from './teaching-bundle.catalog';
import type { PlatformRegistryService } from '../platform-registry/platform-registry.service';
import type { ModelRegistryService } from '../model-registry/model-registry.service';
import type { KnowledgeCenterService } from '../knowledge/knowledge-center.service';
import type { KnowledgeToolCatalogService } from '../knowledge/knowledge-tool-catalog.service';

/** Synthetic catalogs only; no provider calls, credentials or learner facts. */
export function opticsTeachingFixture(template: ProjectTemplateSpec = OPTICS_16_SESSION_TEMPLATE_SPEC) {
  const assistantIds = [...new Set(OPTICS_PHASES.map((phase) => phase.assignedAssistantId)
    .filter((id): id is string => id !== null))];
  const members = assistantIds.map((assistantId, index) => ({ slotId: `member-${index}`, assistantId }));
  const policyVersion = loadTutorRuntimeSource().policy.version;
  const draft: Omit<TeachingBundleDraft, 'templateVersionId' | 'teamVersionId'> = {
    scheduleProfileId: template.curriculum!.profiles[0]!.id,
    roleMap: members.map((member, index) => ({ roleSlotId: `role-${index}`, memberId: member.slotId, purposes: ['dialogue'] })),
    sessionRoutes: template.curriculum!.profiles[0]!.sessions.map((session) => ({
      sessionIndex: session.sessionIndex,
      roleSlotId: `role-${assistantIds.indexOf(OPTICS_PHASES.find((phase) => phase.phase === session.phase)!.assignedAssistantId!)}`,
    })),
    skillPins: [], toolIds: [], mcpServerIds: [], knowledgeBaseIds: [], approvalPolicyVersion: policyVersion,
    modelByPurpose: Object.fromEntries(members.map((_, index) => [`role-${index}`, {
      dialogue: { modelProviderId: 'isolated-provider', modelId: 'isolated-model' },
    }])),
  };
  const catalog = new TeachingBundleCatalog(
    { getAssistantRuntime: async (id: string) => ({
      agent: { enabled: true, roleDefinition: id, agentDefinition: 'Synthetic teaching policy.' },
      skills: [], tools: [], mcpServers: [],
    }) } as unknown as PlatformRegistryService,
    { listAgentModelOptions: () => [{ providerId: 'isolated-provider', modelId: 'isolated-model', available: true }] } as unknown as ModelRegistryService,
    {} as KnowledgeCenterService, {} as KnowledgeToolCatalogService,
  );
  return { catalog, draft, members, teamId: template.teamId, leaderAssistantId: assistantIds[0]! };
}
