import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { actor, DEFAULT_STAGES, fullEvidence, makeGovernanceHarness, VALID_CREATE_INPUT } from './templates.test-support';
import { TemplatesService } from './templates.service';

const admin = actor('admin', 'restore-admin');
const input = { stages: DEFAULT_STAGES, content: { bootstrapKey: 'isolated-fixture', materials: ['公开材料'] }, rubric: [{ id: 'evidence', label: '证据' }] };

async function archived() {
  const f = makeGovernanceHarness();
  const created = await f.service.createTemplate(admin, VALID_CREATE_INPUT, 'create');
  const first = await f.service.createVersion(admin, created.template.id, input, 'version');
  f.evidence.seed(fullEvidence(first.version.id));
  await f.service.publishVersion(admin, created.template.id, first.version.id, 'publish', '隔离 fixture');
  const historical = await f.store.findVersion(first.version.id);
  const saved = await f.service.archiveTemplate(admin, created.template.id, 'archive', '隔离 fixture');
  return { ...f, template: saved.template, historical };
}

test('restore makes a new editable version, preserves the published source, and remains invisible to students', async () => {
  const f = await archived();
  const result = await f.service.restoreTemplate(admin, f.template.id, f.template.updatedAt, 'restore', '继续编辑');
  assert.equal(result.template.status, 'draft');
  assert.equal(result.version?.status, 'draft');
  assert.equal(result.version?.version, 'v2');
  assert.notEqual(result.version?.id, f.historical?.id);
  assert.deepEqual(result.version?.content, { materials: ['公开材料'] });
  assert.deepEqual(result.version?.stages, input.stages);
  assert.deepEqual(result.version?.rubric, input.rubric);
  assert.deepEqual(await f.store.findVersion(f.historical!.id), f.historical);
  assert.equal(f.audit.entries.at(-1)?.action, 'template.restore');
  const student = new TemplatesService(f.store, f.directory);
  assert.deepEqual(await student.listPublishedTemplates(actor('student', 'student')), []);
  await f.service.updateTemplate(admin, f.template.id, { title: '恢复后编辑' }, 'edit');
  const next = await f.service.createVersion(admin, f.template.id, { ...input, content: { materials: ['修改后的材料'] } }, 'save-edit');
  assert.equal(next.version.version, 'v3');
  assert.deepEqual(await f.store.findVersion(f.historical!.id), f.historical);
  await assert.rejects(f.service.publishVersion(admin, f.template.id, result.version!.id, 'publish-new', '不得复用旧版本证据'),
    error => {
      if (!(error instanceof ConflictException)) return false;
      const response = error.getResponse();
      return typeof response === 'object' && 'code' in response && response.code === 'TEMPLATE_VERIFICATION_INCOMPLETE';
    });
});

test('same restore key replays one version and one audit; changed payload or stale revision fails closed', async () => {
  const f = await archived();
  const first = await f.service.restoreTemplate(admin, f.template.id, f.template.updatedAt, 'restore', '继续编辑');
  const replay = await f.service.restoreTemplate(admin, f.template.id, f.template.updatedAt, 'restore', '继续编辑');
  assert.equal(replay.replayed, true);
  assert.equal(replay.version?.id, first.version?.id);
  assert.equal((await f.store.listVersions(f.template.id)).length, 2);
  assert.equal(f.audit.entries.filter(entry => entry.action === 'template.restore').length, 1);
  await assert.rejects(f.service.restoreTemplate(admin, f.template.id, f.template.updatedAt, 'restore', 'different'));
  await assert.rejects(f.service.restoreTemplate(admin, f.template.id, f.template.updatedAt, 'different-key', '继续编辑'));
  const g = await archived();
  await assert.rejects(g.service.restoreTemplate(admin, g.template.id, '2000-01-01T00:00:00.000Z', 'stale', null));
  assert.equal((await g.store.findTemplate(g.template.id))?.status, 'archived');
  assert.equal((await g.store.listVersions(g.template.id)).length, 1);
});

test('restore is Admin-only; invalid revisions and missing templates do not write', async () => {
  const f = await archived();
  for (const role of ['teacher', 'student', 'parent'] as const) {
    await assert.rejects(f.service.restoreTemplate(actor(role, role), f.template.id, f.template.updatedAt, role, null), ForbiddenException);
  }
  await assert.rejects(f.service.restoreTemplate(admin, f.template.id, 'invalid-date', 'invalid', null), BadRequestException);
  await assert.rejects(f.service.restoreTemplate(admin, 'missing', f.template.updatedAt, 'missing', null), NotFoundException);
  assert.equal(f.audit.entries.filter(entry => entry.action === 'template.restore').length, 0);
  assert.equal((await f.store.findTemplate(f.template.id))?.status, 'archived');
});

test('audit failure leaves the archive and historical versions intact, and the same key can retry', async () => {
  const f = await archived();
  const write = f.audit.write.bind(f.audit);
  f.audit.write = async () => { throw new Error('Synthetic audit outage'); };
  await assert.rejects(f.service.restoreTemplate(admin, f.template.id, f.template.updatedAt, 'restore', null), /audit outage/);
  assert.equal((await f.store.findTemplate(f.template.id))?.status, 'archived');
  assert.equal((await f.store.listVersions(f.template.id)).length, 1);
  f.audit.write = write;
  assert.equal((await f.service.restoreTemplate(admin, f.template.id, f.template.updatedAt, 'restore', null)).template.status, 'draft');
});

test('a previously empty archive restores without inventing course content or a binding', async () => {
  const f = makeGovernanceHarness();
  const created = await f.service.createTemplate(admin, VALID_CREATE_INPUT, 'empty');
  const saved = await f.service.archiveTemplate(admin, created.template.id, 'archive', null);
  const result = await f.service.restoreTemplate(admin, saved.template.id, saved.template.updatedAt, 'restore', null);
  assert.equal(result.version, null);
  assert.equal(result.template.status, 'draft');
  assert.deepEqual(await f.store.listVersions(saved.template.id), []);
});

test('concurrent restore attempts cannot create two editable copies', async () => {
  const f = await archived();
  const outcomes = await Promise.allSettled(['a', 'b'].map(key => f.service.restoreTemplate(admin, f.template.id, f.template.updatedAt, key, null)));
  assert.equal(outcomes.filter(entry => entry.status === 'fulfilled').length, 1);
  assert.equal((await f.store.listVersions(f.template.id)).length, 2);
  assert.equal(f.audit.entries.filter(entry => entry.action === 'template.restore').length, 1);
});
