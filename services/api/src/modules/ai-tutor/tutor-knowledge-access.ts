import type { ImaKnowledgeScope } from './ima-tool-scope';
import type { LearningPlanStore } from '../learning-plan/learning-plan.store';
import type { TemplateBindingService } from '../templates/templates-binding.service';
import type { ImaSettingsService } from '../platform-registry/ima-settings.service';
import { teachingValueDigest } from '../templates/teaching-bundle.canonical';
import { resolveTutorTeachingContext, type TutorTeachingContext } from './tutor-teaching-context';
import type { ImaProjectScope, ImaReadEvidence } from './ima-project-scope';

export function createTutorKnowledgeAccess(
  teaching: TutorTeachingContext | null,
  projectId: string | null,
  studentId: string,
  assistantId: string,
  settings?: ImaSettingsService,
  plans?: LearningPlanStore,
  bindings?: TemplateBindingService,
): { authorize?: (toolId: string) => Promise<boolean>; scope?: ImaProjectScope; readEvidence?: Map<string, ImaReadEvidence> } {
  if (!teaching) return { authorize: settings ? (toolId) => settings.canCall(assistantId, toolId, assistantId) : undefined };
  const grant = teaching.bundle.knowledgeGrant;
  if (!settings || !plans || !bindings || !projectId || !grant?.knowledgeBaseIds.length) return { authorize: async () => false };
  const digest = teachingValueDigest(teaching.bundle);
  const readEvidence = new Map<string, ImaReadEvidence>();
  return {
    readEvidence,
    authorize: async (toolId) => grant.allowedTools.includes(toolId) && teaching.role.tools.some((pin) =>
      pin.toolId === toolId && pin.mcpServerId === 'ima-knowledge') && settings.canCall(assistantId, toolId, assistantId),
    scope: {
      projectId, studentId, knowledgeBaseIds: grant.knowledgeBaseIds, toolPins: teaching.role.tools,
      recordReadEvidence: (evidence) => {
        while (readEvidence.size >= 64) readEvidence.delete(readEvidence.keys().next().value!);
        readEvidence.set(evidence.sourceRef, evidence);
      },
      refreshAllowedKnowledgeBaseIds: async () => {
        const project = await plans.findProject(projectId);
        if (!project || project.studentId !== studentId || project.templateVersionId !== teaching.bundle.templateVersionId) return [];
        let current = await bindings.getFrozenTeachingBundle(projectId, project.templateVersionId!);
        if (current.sessionAssignments) {
          const fresh = await resolveTutorTeachingContext(plans, project, current);
          if (fresh.session.id !== teaching.session.id || fresh.planId !== teaching.planId || fresh.planRevision !== teaching.planRevision) return [];
          current = fresh.bundle;
        }
        if (teachingValueDigest(current) !== digest) return [];
        return settings.currentKnowledgeBaseIds(assistantId, studentId);
      },
    },
  };
}


export interface ManagedKnowledgeScope {
  key: string;
  authorizeTool?: (toolId: string) => Promise<boolean>;
  /** null is reserved for explicitly governed free exploration; project IDs are remote IMA ceilings. */
  knowledgeBaseIds: readonly string[] | null;
  recordReadEvidence?: (evidence: ImaReadEvidence) => Promise<boolean>;
}

/** Shared access envelope: project turns retain the stronger owner/pin/provenance capability. */
export async function resolveTutorKnowledgeAccess(input: {
  studentId: string; assistantId: string; projectId: string | null; templateVersionId?: string | null;
  bindings?: TemplateBindingService; ima?: ImaSettingsService; plans?: LearningPlanStore;
  teaching?: TutorTeachingContext | null;
  /** Template handoff is a preview, not a frozen project knowledge grant. */
  unconfirmedTemplate?: boolean;
  authorizeManagedTool?: (toolId: string) => Promise<boolean>;
}) {
  const strict = input.teaching ? createTutorKnowledgeAccess(input.teaching, input.projectId, input.studentId,
    input.assistantId, input.ima, input.plans, input.bindings) : undefined;
  let ceiling: readonly string[] | null = input.projectId === null && !input.unconfirmedTemplate ? null : [];
  let toolCeiling: readonly string[] | null = input.projectId === null && !input.unconfirmedTemplate ? null : [];
  let digest: string | undefined;
  if (input.projectId && input.templateVersionId && input.bindings) {
    try {
      const bundle = input.teaching?.bundle ?? await input.bindings.getFrozenTeachingBundle(input.projectId, input.templateVersionId);
      ceiling = bundle.knowledgeGrant?.knowledgeBaseIds ?? [];
      toolCeiling = bundle.knowledgeGrant?.allowedTools ?? [];
      digest = teachingValueDigest(bundle);
    } catch { /* No current-active-binding fallback for a missing historical snapshot. */ }
  }
  const ima: ImaKnowledgeScope = {
    knowledgeBaseIds: async () => {
      if (input.teaching) {
        if (!strict?.scope) return [];
        const current = await strict.scope.refreshAllowedKnowledgeBaseIds();
        return strict.scope.knowledgeBaseIds.filter(id => current.includes(id));
      }
      if (input.projectId) {
        if (!digest || !input.bindings || !input.templateVersionId) return [];
        if (input.plans) {
          const project = await input.plans.findProject(input.projectId);
          if (!project || project.studentId !== input.studentId || project.templateVersionId !== input.templateVersionId) return [];
        }
        try {
          if (teachingValueDigest(await input.bindings.getFrozenTeachingBundle(input.projectId, input.templateVersionId)) !== digest) return [];
        } catch { return []; }
      }
      const current = await input.ima?.currentKnowledgeBaseIds(input.assistantId, input.studentId) ?? [];
      return current.filter(id => ceiling === null || ceiling.includes(id));
    },
  };
  const authorize = async (toolId: string) => (toolCeiling === null || toolCeiling.includes(toolId))
    && (await ima.knowledgeBaseIds()).length > 0
    && (strict ? await strict.authorize?.(toolId) === true : await input.ima?.canCall(input.assistantId, toolId, input.assistantId) === true);
  // The retrieval owner maps these remote IDs to current IMA connection records. A grant change
  // during one request invalidates the whole result; it cannot leave a revoked source in a mixed result.
  const managedCeiling = ceiling === null ? null : [...await ima.knowledgeBaseIds()].sort();
  const managed: ManagedKnowledgeScope = {
    key: JSON.stringify([input.studentId, input.projectId, input.assistantId, digest ?? null]), knowledgeBaseIds: managedCeiling,
    authorizeTool: async (toolId) => {
      if (!['knowledge_search', 'knowledge_read'].includes(toolId) || !await input.authorizeManagedTool?.(toolId)) return false;
      if (managedCeiling === null) return true;
      const current = [...await ima.knowledgeBaseIds()].sort();
      if (!current.length || JSON.stringify(current) !== JSON.stringify(managedCeiling)) return false;
      return authorize(toolId === 'knowledge_search' ? 'ima_search_knowledge' : 'ima_read_document');
    },
    ...(strict?.scope ? { recordReadEvidence: async (evidence: ImaReadEvidence) => {
      if (!strict.scope || !await input.authorizeManagedTool?.('knowledge_read')
        || !await authorize('ima_read_document') || !strict.scope.knowledgeBaseIds.includes(evidence.knowledgeBaseId)
        || !(await strict.scope.refreshAllowedKnowledgeBaseIds()).includes(evidence.knowledgeBaseId)) return false;
      strict.scope.recordReadEvidence?.(evidence);
      return true;
    } } : {}),
  };
  return { ...strict, managed, ima, authorize };
}
