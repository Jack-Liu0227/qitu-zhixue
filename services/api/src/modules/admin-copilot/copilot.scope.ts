import { ForbiddenException } from '@nestjs/common';
import { ADMIN_COPILOT_OPERATIONS, type AdminCopilotActionKind, type AdminCopilotRequest, type AdminCopilotScope } from '@qitu/contracts';

export interface CopilotScopeResources {
  bindingStatus: 'active' | 'draft_reference' | 'unbound';
  teamIds: string[];
  assistantIds: string[];
}
export type CreatedResources = Map<string, Set<string>>;
export const requestScope = (request: AdminCopilotRequest): AdminCopilotScope => request.scope ?? (request.templateId ? 'selected_template' : 'global');
function denied(): never {
  throw new ForbiddenException({ code: 'COPILOT_SCOPE_MISMATCH', message: '操作超出当前配置范围；请切换全局范围或选择对应模板。' });
}

/** Model text and client-selected teams never authorize mutations. */
export function assertOperationScope(request: AdminCopilotRequest, kind: AdminCopilotActionKind,
  input: Record<string, unknown>, resources: CopilotScopeResources, created: CreatedResources) {
  const scope = requestScope(request);
  if ((scope === 'global' && request.templateId) || (scope === 'selected_template' && !request.templateId)) denied();
  const operation = ADMIN_COPILOT_OPERATIONS.find(item => item.kind === kind);
  if (!operation || !(operation.scopes as readonly string[]).includes(scope)) denied();
  if (scope === 'global') return;
  const owns = (resource: string, id: unknown, existing: readonly string[] = []) => typeof id === 'string' &&
    (existing.includes(id) || created.get(resource)?.has(id) === true);
  if (kind.startsWith('template.') || kind.startsWith('binding.')) {
    const target = kind === 'template.update' ? input.id : input.templateId;
    if (target !== request.templateId) denied();
    const version = kind === 'template.version' ? input.sourceVersionId : input.versionId;
    if (version && request.templateVersionId && version !== request.templateVersionId && !owns('template_version', version)) denied();
    return;
  }
  if (kind === 'team.version') {
    if (!owns('team', input.id, resources.teamIds)) denied();
    return;
  }
  if (operation.createsResource) return;
  if (operation.targetResource === 'team' && owns('team', input.id, resources.teamIds)) return;
  if (operation.targetResource === 'assistant' && input.id !== 'qitu-assistant' && owns('assistant', input.id, resources.assistantIds)) return;
  // Existing shared skill publication and KB grants require the explicit global scope.
  if (kind === 'skill.publish' && owns('skill', input.id)) return;
  if (kind === 'knowledge.bind' && owns('knowledge', input.id)) {
    const bindings = input.bindings;
    if (Array.isArray(bindings) && bindings.every(binding => binding && typeof binding === 'object' &&
      owns('assistant', (binding as Record<string, unknown>).agentId, resources.assistantIds))) return;
  }
  denied();
}

export function rememberCreatedResource(created: CreatedResources, kind: AdminCopilotActionKind, result: unknown) {
  const operation = ADMIN_COPILOT_OPERATIONS.find(item => item.kind === kind);
  if (!operation?.createsResource || !result || typeof result !== 'object') return;
  const id = (result as Record<string, unknown>).id;
  if (typeof id !== 'string') return;
  const resource = kind === 'template.version' ? 'template_version' : kind === 'team.version' ? 'team_version' : operation.targetResource;
  if (!created.has(resource)) created.set(resource, new Set());
  created.get(resource)!.add(id);
}
