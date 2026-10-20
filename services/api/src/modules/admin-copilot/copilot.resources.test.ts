import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { ADMIN_COPILOT_CONTRACT_VERSION, type CurrentUser } from '@qitu/contracts';
import type { AuditWriter } from '../../common/audit/audit.service';
import { loadTutorRuntimeSource } from '../../common/tutor-runtime/runtime-source';
import { CopilotResources, managementSkill, MANAGEMENT_SKILL_ID, MANAGEMENT_OPERATIONS_DIGEST } from './copilot.resources';
import { CopilotOperations } from './copilot.operations';
import { PlatformRegistryService } from '../platform-registry/platform-registry.service';
import type { Database } from '@qitu/database';
import type { TemplateGovernanceService } from '../templates/templates-governance.service';
import type { KnowledgeCenterService } from '../knowledge/knowledge-center.service';
import type { ModelRegistryService } from '../model-registry/model-registry.service';
import type { ImaSettingsService } from '../platform-registry/ima-settings.service';

const actor: CurrentUser = { id: 'admin-fixture', role: 'admin', displayName: 'Fixture', email: 'fixture@example.invalid' };

test('IMA toggle uses the unified revisioned owner and preserves other engine configuration', async () => {
  const current = { knowledgeEngines: {
    'ima-main': { provider: 'ima', enabled: true, config: { allowedKnowledgeBaseIds: ['textbook'] } },
    native: { provider: 'llamaindex', enabled: true, config: { chunk_size: 800 } },
  }, mcpServers: {}, platformTools: { 'project-knowledge': { enabled: true, boundAssistants: ['coach'] } } };
  let saves = 0;
  const center = { configuration: async () => ({ revision: 12, config: current }),
    save: async (_actor: CurrentUser, input: { expectedRevision: number; config: typeof current }) => {
      assert.equal(input.expectedRevision, 12); assert.equal(input.config.knowledgeEngines['ima-main'].enabled, false);
      assert.deepEqual(input.config.knowledgeEngines['ima-main'].config.allowedKnowledgeBaseIds, ['textbook']);
      assert.deepEqual(input.config.knowledgeEngines.native, current.knowledgeEngines.native);
      assert.deepEqual(input.config.platformTools, current.platformTools); saves++;
      return { revision: 13, config: input.config };
    } };
  const operations = new CopilotOperations({} as never, {} as never, center as never, {} as never, {} as never,
    { update: () => { throw new Error('Legacy IMA owner must not be used'); } } as never);
  await operations.execute(actor, 'ima.configure', { expectedRevision: 12, enabled: false }, 'toggle');
  await assert.rejects(operations.execute(actor, 'ima.configure', { enabled: false }, 'missing-revision'));
  await assert.rejects(operations.execute(actor, 'ima.configure', { expectedRevision: 12, enabled: false, assistantBindings: [] }, 'legacy-shape'));
  assert.equal(saves, 1);
  assert.equal(current.knowledgeEngines['ima-main'].enabled, true);
});
test('management loader fails closed for missing, unpublished, revoked, empty or incorrectly scoped skills', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qitu-management-scope-'));
  const previous = process.env.QITU_PROJECT_ROOT;
  process.env.QITU_PROJECT_ROOT = root;
  const directory = join(root, '.agents', 'skills', MANAGEMENT_SKILL_ID);
  mkdirSync(directory, { recursive: true });
  try {
    const unavailable = (error: unknown) => (error as { getResponse(): { code: string } }).getResponse().code === 'COPILOT_SKILL_UNAVAILABLE';
    await assert.rejects(managementSkill(), unavailable);
    for (const [runtime, status, body] of [
      ['teaching', 'published', 'fixture'], ['admin', 'reviewed', 'fixture'],
      ['admin', 'revoked', 'fixture'], ['admin', 'published', ''],
    ]) {
      writeFileSync(join(directory, 'SKILL.md'), `---\nruntime: ${runtime}\nstatus: ${status}\n---\n${body}`);
      await assert.rejects(managementSkill(), unavailable);
    }
    writeFileSync(join(directory, 'SKILL.md'), `---\nruntime: admin\nstatus: published\nversion: ${ADMIN_COPILOT_CONTRACT_VERSION}\n---\nSYNTHETIC_ADMIN\n<!-- qitu-copilot-contract: {\"version\":\"${ADMIN_COPILOT_CONTRACT_VERSION}\",\"operationsDigest\":\"${MANAGEMENT_OPERATIONS_DIGEST}\"} -->`);
    assert.match((await managementSkill()).content, /SYNTHETIC_ADMIN/);
  } finally {
    if (previous === undefined) delete process.env.QITU_PROJECT_ROOT; else process.env.QITU_PROJECT_ROOT = previous;
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    rmSync(root, { recursive: true, force: true });
  }
});

test('skill draft is excluded, digest publication enables canonical discovery, replay is safe and content is immutable', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qitu-copilot-skill-'));
  const previous = process.env.QITU_PROJECT_ROOT;
  process.env.QITU_PROJECT_ROOT = root;
  mkdirSync(join(root, '.agents', 'skills'), { recursive: true });
  const audits: string[] = [];
  const resources = new CopilotResources(null, { write: async entry => { audits.push(entry.action); return 'audit'; } } as AuditWriter);
  try {
    const input = { id: 'fixture-optics-v2', description: 'Teach qualitative diffraction', version: '2', content: '# Inquiry\nAsk for evidence before drawing conclusions.' };
    const draft = await resources.createSkill(actor, input, 'create');
    assert.equal(draft.status, 'draft');
    const adapter = new CopilotOperations({} as PlatformRegistryService, {} as TemplateGovernanceService,
      {} as KnowledgeCenterService, {} as ModelRegistryService, resources, {} as ImaSettingsService);
    const initialRead = await adapter.readback(actor, 'skill.create', draft) as { status: string; enabled: boolean; digest: string };
    assert.equal(initialRead.status, 'draft');
    assert.equal(initialRead.enabled, false);
    assert.equal(initialRead.digest, draft.digest);
    await assert.rejects(resources.readSkill({ ...actor, role: 'student' }, input.id));
    await assert.rejects(resources.readSkill(actor, 'missing-skill'));
    for (const badId of ['../fixture-optics-v2', 'Fixture-optics', 'a'.repeat(65)]) {
      await assert.rejects(resources.readSkill(actor, badId));
    }
    const unsafeDirectory = join(root, '.agents', 'skills', 'unmanaged-draft');
    mkdirSync(unsafeDirectory);
    const draftHeader = '---\nname: unmanaged-draft\nversion: "1"\nruntime: dev-only\nstatus: quarantined\n';
    writeFileSync(join(unsafeDirectory, 'SKILL.md'), draftHeader + '---\nUnmanaged draft');
    await assert.rejects(resources.readSkill(actor, 'unmanaged-draft'));
    writeFileSync(join(unsafeDirectory, 'SKILL.md'), draftHeader + 'managed-by: admin-copilot\nstatus: quarantined\n---\nDuplicate metadata');
    await assert.rejects(resources.readSkill(actor, 'unmanaged-draft'));
    assert.equal('content' in initialRead, false);


    assert.equal(loadTutorRuntimeSource().skills.length, 0);
    await assert.rejects(resources.publishSkill(actor, { id: input.id, digest: '0'.repeat(64) }, 'bad-digest'));
    const published = await resources.publishSkill(actor, { id: input.id, digest: draft.digest }, 'publish');
    assert.equal(published.status, 'published');
    const afterPublish = await adapter.readback(actor, 'skill.create', draft) as { status: string; enabled: boolean; digest: string };
    assert.equal(afterPublish.status, 'published');
    assert.equal(afterPublish.enabled, true);
    assert.equal(afterPublish.digest, published.digest);

    assert.equal(loadTutorRuntimeSource().skills[0]?.id, input.id);
    assert.deepEqual(await resources.publishSkill(actor, { id: input.id, digest: draft.digest }, 'publish'), published);
    await assert.rejects(resources.createSkill(actor, { ...input, content: 'changed' }, 'overwrite'));
    await assert.rejects(resources.createSkill(actor, { ...input, id: '../escape' }, 'escape'));
    assert.match(readFileSync(join(root, '.agents', 'skills', input.id, 'SKILL.md'), 'utf8'), /status: published/);
    assert.ok(audits.includes('admin.copilot.skill.publish.requested'));
    await assert.rejects(resources.revokeSkill({ ...actor, role: 'student' }, { id: input.id, digest: published.digest }, 'denied'));
    const revoked = await resources.revokeSkill(actor, { id: input.id, digest: published.digest }, 'revoke');
    assert.equal(revoked.status, 'revoked');
    for (const [kind, receipt] of [['skill.create', draft], ['skill.publish', published], ['skill.revoke', revoked]] as const) {
      const current = await adapter.readback(actor, kind, receipt) as { status: string; enabled: boolean; digest: string };
      assert.equal(current.status, 'revoked');
      assert.equal(current.enabled, false);
      assert.equal(current.digest, revoked.digest);
      assert.equal('content' in current, false);
      assert.deepEqual(await adapter.readback(actor, kind, receipt), current);
    }

    assert.deepEqual(await resources.revokeSkill(actor, { id: input.id, digest: published.digest }, 'revoke'), revoked);
    assert.equal(loadTutorRuntimeSource().skills.find(skill => skill.id === input.id)?.status, 'unavailable');
    await assert.rejects(resources.publishSkill(actor, { id: input.id, digest: draft.digest }, 'republish'));

  } finally {
    if (previous === undefined) delete process.env.QITU_PROJECT_ROOT; else process.env.QITU_PROJECT_ROOT = previous;
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    rmSync(root, { recursive: true, force: true });
  }
});

function operations(registry: object = {}, templates: object = {}) {
  return new CopilotOperations(registry as PlatformRegistryService, templates as TemplateGovernanceService,
    {} as KnowledgeCenterService, {} as ModelRegistryService, {} as CopilotResources, {} as ImaSettingsService);
}
test('assistant/team adapter uses stable creation identities and requires an expected revision to modify existing resources', async () => {
  const ids: string[] = [];
  const o = operations({ createAssistant: async (_actor: unknown, _input: unknown, id: string) => { ids.push(id); return { id }; } });
  const input = { name: 'Concept Coach', description: 'Concept practice', role: 'coach', instructions: 'Guide learner reasoning and ask questions.' };
  await o.execute(actor, 'assistant.create', input, 'stable-key');
  await o.execute(actor, 'assistant.create', input, 'stable-key');
  assert.equal(ids[0], ids[1]);
  await assert.rejects(o.execute(actor, 'assistant.update', { id: 'coach', patch: { name: 'Updated' } }, 'update'));
});
test('workflow adapter cannot disable theory gate or allow autonomous advancement', async () => {
  let writes = 0;
  const o = operations({ updateTeam: async () => { writes++; return {}; } });
  const phases = ['exploration', 'concept_mastery', 'guided_practice', 'deliverable_review']
    .map(phase => ({ phase, title: phase, assignedAssistantId: 'coach' }));
  for (const override of [{ theoryMasteredGate: false }, { allowAutonomousAdvance: true }]) {
    await assert.rejects(o.execute(actor, 'workflow.update', { id: 'team', expectedUpdatedAt: 'now',
      pblSpec: { projectId: 'optics', projectName: 'Optics', targetDomain: 'physics', phases,
        theoryMasteredGate: true, allowAutonomousAdvance: false, ...override } }, 'unsafe'));
  }
  assert.equal(writes, 0);
  await o.execute(actor, 'workflow.update', { id: 'team', expectedUpdatedAt: 'now',
    pblSpec: { projectId: 'optics', projectName: 'Optics', targetDomain: 'physics', phases,
      theoryMasteredGate: true, allowAutonomousAdvance: false } }, 'safe');
  assert.equal(writes, 1);
});
test('template version adapter clones actual content and preserves curriculum when only team association changes', async () => {
  let captured: Record<string, unknown> | undefined;
  const source = { id: 'v1', stages: [{ id: 'theory', label: 'Theory' }],
    content: { pblSpec: { sessions: [{ objectiveId: 'frozen-objective' }] }, untouched: 'keep' }, rubric: [{ id: 'r1' }] };
  const o = operations({ listTeams: async () => [{ id: 'new-team', enabled: true }] }, {
    listGovernedVersions: async () => [source],
    createVersion: async (_actor: unknown, _id: string, input: Record<string, unknown>) => { captured = input; return { version: { id: 'v2' } }; },
  });
  await o.execute(actor, 'template.version', { templateId: 't', sourceVersionId: 'v1', contentPatch: { linkedTeamId: 'new-team' } }, 'new-version');
  assert.deepEqual(captured, { stages: source.stages, content: { ...source.content, linkedTeamId: 'new-team' }, rubric: source.rubric });
  await assert.rejects(o.execute(actor, 'template.version', { templateId: 't', sourceVersionId: 'foreign-version' }, 'foreign'));
  await assert.rejects(o.execute(actor, 'template.version', { templateId: 't', sourceVersionId: 'v1', contentPatch: { linkedTeamId: 'missing-team' } }, 'missing'));
});
test('domain owner locks the selected row and rejects stale assistant/team updates before writing', async () => {
  let locks = 0;
  let writes = 0;
  const db = {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
    select: () => ({ from: () => ({ where: () => ({ for: async () => {
      locks++;
      return [{ id: 'target', updatedAt: new Date('2026-10-21T01:00:00Z') }];
    } }) }) }),
    update: () => { writes++; throw new Error('unexpected write'); },
  } as unknown as Database;
  const registry = new PlatformRegistryService(db, 'test', {} as AuditWriter, {} as ModelRegistryService);
  const stale = '2026-10-21T00:00:00.000Z';
  const expected = (error: unknown) => (error as { getResponse(): { code: string } }).getResponse().code === 'COPILOT_RESOURCE_CHANGED';
  await assert.rejects(registry.updateAssistant(actor, 'target', { name: 'changed' }, stale), expected);
  await assert.rejects(registry.updateTeam(actor, 'target', { name: 'changed' }, stale), expected);
  assert.equal(locks, 2);
  assert.equal(writes, 0);
});


test('scope resolution prefers the actual bound team and never trusts draft metadata for an active binding', async () => {
  const o = new CopilotOperations({ listTeams: async () => [{ id: 'draft-team', leaderAssistantId: 'draft-leader', members: [] }] } as unknown as PlatformRegistryService,
    { listGovernedVersions: async () => [{ id: 'v1', status: 'published', content: { linkedTeamId: 'draft-team' } }] } as unknown as TemplateGovernanceService,
    {} as KnowledgeCenterService, {} as ModelRegistryService,
    { readTeamVersion: async () => ({ teamId: 'bound-team', leaderAssistantId: 'bound-leader', members: [{ assistantId: 'bound-coach' }] }) } as unknown as CopilotResources,
    {} as ImaSettingsService,
    { resolveActiveBinding: async () => ({ teamVersionId: 'tv1' }) } as unknown as import('../templates/templates-binding.service').TemplateBindingService);
  assert.deepEqual(await o.scopeResources(actor, 'template', 'v1'), {
    bindingStatus: 'active', teamIds: ['bound-team'], assistantIds: ['bound-leader', 'bound-coach'],
  });
});

test('draft associations are labeled as draft and unpublished-version activation is rejected by owner', async () => {
  const o = new CopilotOperations({ listTeams: async () => [{ id: 'draft-team', leaderAssistantId: 'draft-leader', members: [] }] } as unknown as PlatformRegistryService,
    { listGovernedVersions: async () => [{ id: 'v1', status: 'draft', content: { linkedTeamId: 'draft-team' } }] } as unknown as TemplateGovernanceService,
    {} as KnowledgeCenterService, {} as ModelRegistryService, {} as CopilotResources, {} as ImaSettingsService,
    { resolveActiveBinding: async () => null, activateBinding: async () => { throw new Error('BINDING_TEMPLATE_VERSION_NOT_FOUND'); } } as unknown as import('../templates/templates-binding.service').TemplateBindingService);
  assert.equal((await o.scopeResources(actor, 'template', 'v1')).bindingStatus, 'draft_reference');
  await assert.rejects(o.execute(actor, 'binding.activate', { templateId: 'template', versionId: 'v1', bindingId: 'b1' }, 'activate'), /BINDING_TEMPLATE_VERSION_NOT_FOUND/);
  for (const role of ['student', 'teacher'] as const) {
    await assert.rejects(o.execute({ ...actor, role }, 'binding.activate', { templateId: 'template', versionId: 'v1', bindingId: 'b1' }, 'forbidden'));
  }
});

test('binding receipt reads current owner state and preserves the IDs needed for dependent actions', async () => {
  const calls: unknown[][] = [];
  const o = new CopilotOperations({} as PlatformRegistryService, {} as TemplateGovernanceService,
    {} as KnowledgeCenterService, {} as ModelRegistryService, {} as CopilotResources, {} as ImaSettingsService,
    { createBinding: async (...args: unknown[]) => { calls.push(args); return { binding: { id: 'b1', status: 'draft' } }; },
      getTeachingBundle: async () => ({ binding: { id: 'b1', status: 'validated', validation: { valid: true } } }) } as unknown as import('../templates/templates-binding.service').TemplateBindingService);
  const mutation = await o.execute(actor, 'binding.create', { templateId: 't1', versionId: 'v1', teamVersionId: 'tv1' }, 'stable');
  assert.equal(calls[0]?.[4], 'stable');
  assert.deepEqual(await o.readback(actor, 'binding.create', mutation), { id: 'b1', status: 'validated', validation: { valid: true }, templateId: 't1', versionId: 'v1' });
});
