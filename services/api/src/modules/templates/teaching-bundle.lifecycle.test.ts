import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InMemoryTemplateStore } from './templates.store';
import { InMemoryTemplateBindingStore } from './templates-binding.store';
import { InMemoryTemplateViewerDirectory } from './template-evidence.store';
import { TemplateBindingService } from './templates-binding.service';
import { FakeAuditWriter, FakeIdempotencyStore, actor, DEFAULT_STAGES } from './templates.test-support';
import { opticsTeachingFixture } from './teaching-bundle.test-fixture';
import { OPTICS_16_VERSION_INPUT } from './content/optics';
import { parseTeachingBundleDraft } from './templates-binding.controller';
import type { IdempotencyStore } from '../../common/idempotency';
import type { AuditWriter } from '../../common/audit';

const admin = actor('admin', 'admin-qa');
async function fixture() {
  const templates = new InMemoryTemplateStore();
  const store = new InMemoryTemplateBindingStore();
  const live = opticsTeachingFixture();
  const now = new Date();
  await templates.createTemplate({ id: 'tpl-qa', schoolId: null, slug: 'qa-optics', title: 'QA', summary: 'QA', createdBy: admin.id, now });
  await templates.setTemplateStatus('tpl-qa', 'published', admin.id, now, now);
  await templates.createVersion({ id: 'ver-qa', templateId: 'tpl-qa', version: 'v1',
    stages: DEFAULT_STAGES, content: OPTICS_16_VERSION_INPUT.content, rubric: [], createdBy: admin.id, now });
  await templates.setVersionStatus('ver-qa', 'published', now, now);
  store.seedTeamVersion({ id: 'team-qa', teamId: live.teamId, version: 1, name: 'QA', description: '',
    workspaceMode: 'shared', sessionMode: 'auto', members: live.members,
    leaderAssistantId: live.leaderAssistantId, pblSpec: { phases: ['exploration'] },
    enabled: true, createdBy: admin.id, createdAt: now });
  const service = new TemplateBindingService(templates, new InMemoryTemplateViewerDirectory(), store,
    new FakeIdempotencyStore() as unknown as IdempotencyStore, new FakeAuditWriter() as unknown as AuditWriter, live.catalog);
  const { binding } = await service.createBinding(admin, 'tpl-qa', 'ver-qa', { teamVersionId: 'team-qa' }, 'create');
  const draft = parseTeachingBundleDraft({ ...live.draft, templateVersionId: 'ver-qa', teamVersionId: 'team-qa' });
  const save = () => service.saveTeachingBundleDraft(admin, 'tpl-qa', 'ver-qa', binding.id, draft, 'save');
  const validate = () => service.validateBinding(admin, 'tpl-qa', 'ver-qa', binding.id, 'validate');
  const activate = () => service.activateBinding(admin, 'tpl-qa', 'ver-qa', binding.id, 'activate');
  return { live, service, store, binding, draft, save, validate, activate };
}

test('catalog compilation, validation, activation and project freeze preserve one digest', async () => {
  const h = await fixture();
  await h.save();
  const valid = await h.validate();
  assert.match(valid.binding.bundleDigest!, /^[a-f0-9]{64}$/);
  assert.equal(valid.binding.status, 'validated');
  assert.equal((await h.validate()).replayed, true);
  const active = await h.activate();
  assert.equal(active.binding.bundleDigest, valid.binding.bundleDigest);
  assert.equal(await h.service.freezeProjectBinding({ projectId: 'project-qa', templateVersionId: 'ver-qa', boundAt: new Date() }), 'frozen');
  const snapshot = await h.service.findFrozenSnapshotForProject('project-qa', 'ver-qa');
  assert.equal(snapshot?.bundleDigest, active.binding.bundleDigest);
  const teaching = await h.service.getFrozenTeachingBundle('project-qa', 'ver-qa');
  assert.equal(teaching.sessionRoutes.length, 16);
  await assert.rejects(h.store.updateTeachingBundle(h.binding.id, {
    draft: h.draft, digest: null, payload: null, now: new Date(),
  }));
});

test('catalog drift after validation prevents activation', async () => {
  const h = await fixture();
  await h.save();
  await h.validate();
  Object.assign(h.live.catalog, { models: { listAgentModelOptions: () => [] } });
  await assert.rejects(h.activate(), (error: unknown) =>
    (error as { getResponse(): { issue: string } }).getResponse().issue === 'MODEL_PAIR_NOT_APPROVED');
  assert.equal((await h.store.findBinding(h.binding.id))?.status, 'validated');
});

test('unknown roles, noninteger session routes and unpublished skill pins fail closed', async () => {
  const h = await fixture();
  assert.throws(() => parseTeachingBundleDraft({ ...h.draft, sessionRoutes: [{ sessionIndex: 1.5, roleSlotId: 'role-0' }] }));
  h.draft.skillPins = [{ roleSlotId: 'role-0', canonicalId: 'pbl-cer-coach', version: '1.0.0', packageDigest: 'a'.repeat(64) }];
  await h.save();
  await assert.rejects(h.validate());
  assert.equal((await h.store.findBinding(h.binding.id))?.bundleDigest, null);
});
