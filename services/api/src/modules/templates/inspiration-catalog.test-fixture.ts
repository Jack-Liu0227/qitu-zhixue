import assert from 'node:assert/strict';
import type { AdminAssistantConfig, AdminTeamConfig, AdminTeamCreateInput } from '@qitu/contracts';
import type { AuditWriter } from '../../common/audit/audit.service';
import type { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { loadTutorRuntimeSource } from '../../common/tutor-runtime/runtime-source';
import type { KnowledgeCenterService } from '../knowledge/knowledge-center.service';
import type { KnowledgeToolCatalogService } from '../knowledge/knowledge-tool-catalog.service';
import type { ModelRegistryService } from '../model-registry/model-registry.service';
import { builtinToolRegistry } from '../platform-registry/built-in-tools';
import type { EffectiveAgentRuntime, PlatformRegistryService } from '../platform-registry/platform-registry.service';
import { freezeTeamAssistant, TEAM_PUBLICATION_SCHEMA } from '../platform-registry/team-version.snapshot';
import { teamVersionContentDigest, type TeachingTeamCaptureService } from '../platform-registry/teaching-team-capture.service';
import { TemplateBindingService } from './templates-binding.service';
import { InMemoryTemplateBindingStore } from './templates-binding.store';
import type { TeamVersionRecord } from './templates-binding.types';
import { InMemoryTemplateStore } from './templates.store';
import { TemplateGovernanceService } from './templates-governance.service';
import { InMemoryTemplateEvidenceSource, InMemoryTemplateViewerDirectory } from './template-evidence.store';
import { InMemoryTemplateVerificationStore } from './template-verification.store';
import { TeachingBundleCatalog } from './teaching-bundle.catalog';
import { teachingValueDigest } from './teaching-bundle.canonical';
import { actor, FakeAuditWriter, FakeIdempotencyStore } from './templates.test-support';
import type { InspirationCatalogPorts } from './inspiration-catalog-bootstrap';

export const inspirationAdmin = actor('admin', 'isolated-catalog-admin');
export const inspirationModel = { modelProviderId: 'isolated-provider', modelId: 'isolated-model' };

/** Synthetic storage/catalog adapters; real canonical snapshots, bundle compilation and governance owners. */
export function inspirationCatalogFixture() {
  const assistants = new Map<string, AdminAssistantConfig>(), teams = new Map<string, AdminTeamConfig>();
  const templates = new InMemoryTemplateStore(), bindingStore = new InMemoryTemplateBindingStore();
  const viewer = new InMemoryTemplateViewerDirectory(), audit = new FakeAuditWriter();
  const keys = new FakeIdempotencyStore() as unknown as IdempotencyStore;
  const source = loadTutorRuntimeSource();
  const now = '2026-10-24T00:00:00.000Z';
  const state = { modelAvailable: true, captureFailsOnce: false };
  const registry: InspirationCatalogPorts['registry'] & { getAssistantRuntime(id: string): Promise<EffectiveAgentRuntime> } = {
    isModelAvailable: model => state.modelAvailable && teachingValueDigest(model) === teachingValueDigest(inspirationModel),
    listAssistants: async () => [...assistants.values()], listTeams: async () => [...teams.values()],
    createAssistant: async (_actor, input, creationId) => {
      assert(creationId);
      const existing = assistants.get(creationId); if (existing) return existing;
      const row: AdminAssistantConfig = { ...input, id: creationId, source: 'user', createdAt: now, updatedAt: now,
        modelProviderId: input.modelProviderId ?? null, modelId: input.modelId ?? null,
        enabled: true, teamSelectable: true, sortOrder: assistants.size, deletable: true,
        enabledSkills: input.enabledSkills ?? [], toolIds: input.toolIds ?? [], mcpServerIds: input.mcpServerIds ?? [], agentStatus: 'unchecked',
        defaults: { model: { mode: 'inherit' }, permission: { mode: 'inherit' }, thought_level: { mode: 'inherit' },
          skills: { mode: 'inherit', value: [] }, mcps: { mode: 'inherit', value: [] } } };
      assistants.set(row.id, row); return row;
    },
    createTeam: async (_actor, input: AdminTeamCreateInput, creationId) => {
      assert(creationId);
      const existing = teams.get(creationId); if (existing) return existing;
      const { pblSpec: workflow, ...configuration } = input;
      assert.equal(workflow, undefined, 'curriculum lives in the template, not a duplicated workflow');
      const row: AdminTeamConfig = { ...configuration, id: creationId, enabled: true, createdAt: now, updatedAt: now,
        concurrencyLimit: input.concurrencyLimit ?? 1, workspaceMode: input.workspaceMode ?? 'shared', sessionMode: input.sessionMode ?? 'auto',
        members: input.members.map(member => ({ ...member, slotId: member.slotId!, assistantName: assistants.get(member.assistantId)!.name,
          roleLabel: member.roleLabel ?? member.role, status: 'idle' })) };
      teams.set(row.id, row); return row;
    },
    getAssistantRuntime: async id => {
      const assistant = assistants.get(id); assert(assistant);
      return { agent: { id, label: assistant.name, description: assistant.description, role: assistant.role,
        roleDefinition: assistant.role, agentDefinition: assistant.instructions, enabled: true, status: 'ready', parentAgentId: null,
        modelProviderId: inspirationModel.modelProviderId, modelId: inspirationModel.modelId, modelLabel: 'Isolated model',
        modelAvailable: state.modelAvailable, promptVersion: teachingValueDigest(assistant.instructions), capabilities: ['teach'],
        skillIds: [...assistant.enabledSkills], toolIds: [...assistant.toolIds], mcpServerIds: [], mcpToolIds: {} },
      skills: source.skills.filter(skill => assistant.enabledSkills.includes(skill.id)), policy: source.policy,
      tools: builtinToolRegistry.listForAgentIds([...assistant.toolIds]), mcpServers: [] };
    },
  };
  const capture = { capture: async (user: typeof inspirationAdmin, id: string, body: unknown, key: string) => {
    assert.equal(user.role, 'admin');
    if (state.captureFailsOnce) { state.captureFailsOnce = false; throw new Error('Isolated capture interruption'); }
    const team = teams.get(id); assert(team);
    assert.deepEqual(body, { expectedUpdatedAt: team.updatedAt });
    const members = await Promise.all(team.members.map(async member => ({ slotId: member.slotId, assistantId: member.assistantId,
      role: member.role, roleLabel: member.roleLabel, runtimeSnapshot: freezeTeamAssistant(await registry.getAssistantRuntime(member.assistantId)) })));
    const row: TeamVersionRecord = { id: `capture-${teachingValueDigest([id, key]).slice(0, 24)}`, teamId: id, version: 1,
      name: team.name, description: team.description, workspaceMode: team.workspaceMode, sessionMode: team.sessionMode,
      leaderAssistantId: team.leaderAssistantId, enabled: true, members, pblSpec: {}, createdBy: user.id, createdAt: new Date(now) };
    row.pblSpec.teamVersionPublication = { schemaVersion: TEAM_PUBLICATION_SCHEMA, sourceUpdatedAt: team.updatedAt, digest: teamVersionContentDigest(row) };
    return row;
  } } as unknown as TeachingTeamCaptureService;
  const catalog = new TeachingBundleCatalog(registry as unknown as PlatformRegistryService,
    { listAgentModelOptions: () => [{ providerId: inspirationModel.modelProviderId, modelId: inspirationModel.modelId, available: state.modelAvailable }] } as unknown as ModelRegistryService,
    {} as KnowledgeCenterService, {} as KnowledgeToolCatalogService, bindingStore);
  const governance = new TemplateGovernanceService(templates, new InMemoryTemplateEvidenceSource(), new InMemoryTemplateVerificationStore(), viewer, keys, audit as unknown as AuditWriter);
  const bindings = new TemplateBindingService(templates, viewer, bindingStore, keys, audit as unknown as AuditWriter, catalog, capture);
  const ports: InspirationCatalogPorts = { registry, templates, bindingStore, governance, bindings };
  return { ports, state, assistants, teams, audit, templates, bindingStore, bindings, registry };
}
