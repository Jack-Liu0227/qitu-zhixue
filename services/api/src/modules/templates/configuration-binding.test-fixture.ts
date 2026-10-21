import { OPTICS_16_SESSION_TEMPLATE_SPEC, OPTICS_PHASES } from '@qitu/ai-client/quiz-bank';
import type { TeachingBundleDraft } from '@qitu/contracts';
import type { AuditWriter } from '../../common/audit/audit.service';
import type { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { teachingValueDigest } from './teaching-bundle.canonical';
import { opticsTeachingFixture } from './teaching-bundle.test-fixture';
import { TEAM_PUBLICATION_SCHEMA } from '../platform-registry/team-version.snapshot';
import { teamVersionContentDigest } from '../platform-registry/team-version.service';
import { InMemoryTemplateStore } from './templates.store';
import { InMemoryTemplateBindingStore } from './templates-binding.store';
import { InMemoryTemplateViewerDirectory } from './template-evidence.store';
import { TemplateBindingService } from './templates-binding.service';
import { ProjectBindingRecoveryService } from './project-binding-recovery.service';
import { FakeAuditWriter, FakeIdempotencyStore, actor, DEFAULT_STAGES } from './templates.test-support';
import type { TeamVersionRecord } from './templates-binding.types';

export const configurationAdmin = actor('admin', 'configuration-admin');
export async function configurationBindingFixture() {
  const template = structuredClone(OPTICS_16_SESSION_TEMPLATE_SPEC);
  template.phases = template.phases.map((phase) => ({ ...phase,
    assignedAssistantId: OPTICS_PHASES.find((entry) => entry.phase === phase.phase)?.assignedAssistantId ?? null }));
  const live = opticsTeachingFixture(template);
  Object.assign(live.catalog, { registry: { getAssistantRuntime: async (id: string) => ({
    agent: { enabled: true, capabilities: ['teach'], roleDefinition: id, agentDefinition: 'Synthetic teaching policy.' },
    skills: [], tools: [], mcpServers: [],
  }) } });
  const now = new Date('2026-10-21T00:00:00Z');
  const team: TeamVersionRecord = { id: 'published-team', teamId: live.teamId, version: 2, name: 'Synthetic team',
    description: '', workspaceMode: 'shared', sessionMode: 'auto', leaderAssistantId: live.leaderAssistantId,
    enabled: true, createdBy: configurationAdmin.id, createdAt: now, pblSpec: { phases: ['exploration'] },
    members: live.members.map((member) => {
      const payload = { schemaVersion: TEAM_PUBLICATION_SCHEMA, assistantId: member.assistantId, promptVersion: 'synthetic-v1',
        roleDefinition: member.assistantId, agentDefinition: 'Synthetic teaching policy.',
        model: { modelProviderId: 'isolated-provider', modelId: 'isolated-model' }, skills: [], tools: [], mcpPermissions: [] };
      return { ...member, runtimeSnapshot: { ...payload, digest: teachingValueDigest(payload) } };
    }) };
  team.pblSpec.teamVersionPublication = { schemaVersion: TEAM_PUBLICATION_SCHEMA, digest: teamVersionContentDigest(team) };
  const templates = new InMemoryTemplateStore();
  const store = new InMemoryTemplateBindingStore();
  const directory = new InMemoryTemplateViewerDirectory();
  const audit = new FakeAuditWriter();
  const idempotency = new FakeIdempotencyStore();
  await templates.createTemplate({ id: 'configuration-template', schoolId: null, slug: 'configuration-fixture',
    title: 'Synthetic', summary: 'No learner data', createdBy: configurationAdmin.id, now });
  await templates.setTemplateStatus('configuration-template', 'published', configurationAdmin.id, now, now);
  await templates.createVersion({ id: 'configuration-version', templateId: 'configuration-template', version: 'v1',
    stages: DEFAULT_STAGES, content: { pbl: template }, rubric: [], createdBy: configurationAdmin.id, now });
  await templates.setVersionStatus('configuration-version', 'published', now, now);
  store.seedTeamVersion(team);
  store.seedAffectedProjects('configuration-version', [{ projectId: 'synthetic-project', studentUserId: 'synthetic-student', title: 'Private learner title', planId: null }]);
  const bindings = new TemplateBindingService(templates, directory, store, idempotency as unknown as IdempotencyStore,
    audit as unknown as AuditWriter, live.catalog);
  const recovery = new ProjectBindingRecoveryService(templates, directory, store, bindings, audit as unknown as AuditWriter,
    idempotency as unknown as IdempotencyStore, live.catalog);
  const { binding } = await bindings.createBinding(configurationAdmin, 'configuration-template', 'configuration-version', { teamVersionId: team.id }, 'create');
  const draft: TeachingBundleDraft = live.catalog.prepareDraft((await templates.findVersion('configuration-version'))!, team);
  const activate = async () => {
    await bindings.saveTeachingBundleDraft(configurationAdmin, 'configuration-template', 'configuration-version', binding.id, draft, 'draft');
    await bindings.validateBinding(configurationAdmin, 'configuration-template', 'configuration-version', binding.id, 'validate');
    return bindings.activateBinding(configurationAdmin, 'configuration-template', 'configuration-version', binding.id, 'activate');
  };
  return { live, template, team, draft, templates, store, directory, audit, idempotency, bindings, recovery, binding, activate };
}
