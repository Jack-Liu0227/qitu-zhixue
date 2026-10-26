import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { actor, DEFAULT_STAGES, makeGovernanceHarness, VALID_CREATE_INPUT } from './templates.test-support';
import type { TemplateStatus } from './templates.types';

const admin = actor('admin', 'delete-admin');

async function fixture(status: TemplateStatus = 'draft') {
  const h = makeGovernanceHarness();
  const { template } = await h.service.createTemplate(admin, VALID_CREATE_INPUT, 'create');
  const { version } = await h.service.createVersion(admin, template.id,
    { stages: DEFAULT_STAGES, content: { fixture: true }, rubric: [] }, 'version');
  if (status !== 'draft') await h.store.setVersionStatus(version.id, status, new Date(), new Date());
  return { ...h, template, version };
}

function httpError(status: number, code?: string) {
  return (error: unknown) => {
    const http = error as { getStatus(): number; getResponse(): { code: string } };
    assert.equal(http.getStatus(), status);
    if (code) assert.equal(http.getResponse().code, code);
    return true;
  };
}

for (const status of ['draft', 'piloting', 'published', 'archived'] as const) {
  test(`unused archived course with ${status} version deletes directly and replays without another audit`, async () => {
    const h = await fixture(status);
    await h.service.archiveTemplate(admin, h.template.id, 'archive', 'fixture');
    const first = await h.service.deleteTemplate(admin, h.template.id, 'delete');
    assert.deepEqual(first, { success: true, id: h.template.id });
    assert.equal(await h.store.findTemplate(h.template.id), null);
    assert.deepEqual(await h.store.listVersions(h.template.id), []);
    assert.deepEqual(await h.service.deleteTemplate(admin, h.template.id, 'delete'), first);
    const entries = h.audit.entries.filter(entry => entry.action === 'template.delete');
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.detail?.from, 'archived');
    await assert.rejects(h.service.deleteTemplate(actor('teacher', admin.id), h.template.id, 'delete'), httpError(403));
    await assert.rejects(h.service.deleteTemplate(admin, h.template.id, 'different'), httpError(404, 'TEMPLATE_NOT_FOUND'));
  });
}

test('empty archived course and unused draft can be deleted', async () => {
  const h = makeGovernanceHarness();
  const { template } = await h.service.createTemplate(admin, VALID_CREATE_INPUT, 'create');
  await h.service.archiveTemplate(admin, template.id, 'archive', null);
  assert.equal((await h.service.deleteTemplate(admin, template.id, 'delete')).success, true);
  const draft = await fixture();
  assert.equal((await draft.service.deleteTemplate(admin, draft.template.id, 'delete')).success, true);
});

test('in-use lifecycle states cannot be deleted before archiving, including restored published content', async () => {
  for (const status of ['review', 'piloting', 'published'] as const) {
    const h = await fixture(status);
    await h.store.setTemplateStatus(h.template.id, status, null, null, new Date());
    await assert.rejects(h.service.deleteTemplate(admin, h.template.id, 'delete'), httpError(409, 'TEMPLATE_DELETE_PROTECTED'));
    await h.store.setTemplateStatus(h.template.id, 'draft', null, null, new Date());
    await assert.rejects(h.service.deleteTemplate(admin, h.template.id, 'delete-restored'), httpError(409, 'TEMPLATE_DELETE_PROTECTED'));
    assert.ok(await h.store.findVersion(h.version.id));
    assert.equal(h.audit.entries.some(entry => entry.action === 'template.delete'), false);
  }
});

test('quality verification history protects an archived course and its original content', async () => {
  const h = await fixture();
  await h.service.verifyVersion(admin, h.template.id, h.version.id, 'verify');
  await h.service.archiveTemplate(admin, h.template.id, 'archive', null);
  await assert.rejects(h.service.deleteTemplate(admin, h.template.id, 'delete'), httpError(409, 'TEMPLATE_DELETE_PROTECTED'));
  assert.deepEqual((await h.store.findVersion(h.version.id))?.content, { fixture: true });
  assert.equal(h.audit.entries.some(entry => entry.action === 'template.delete'), false);
});

test('students, parents and teachers cannot delete an archived course', async () => {
  const h = await fixture();
  await h.service.archiveTemplate(admin, h.template.id, 'archive', null);
  for (const role of ['student', 'parent', 'teacher'] as const) {
    await assert.rejects(h.service.deleteTemplate(actor(role, role), h.template.id, role), httpError(403));
  }
  assert.ok(await h.store.findTemplate(h.template.id));
});

test('audit failure preserves the course and all versions; retry can succeed', async () => {
  const h = await fixture();
  await h.service.archiveTemplate(admin, h.template.id, 'archive', null);
  const original = h.audit.write.bind(h.audit);
  h.audit.write = async () => { throw new Error('Synthetic audit outage'); };
  await assert.rejects(h.service.deleteTemplate(admin, h.template.id, 'delete'), /audit outage/);
  assert.ok(await h.store.findTemplate(h.template.id));
  assert.ok(await h.store.findVersion(h.version.id));
  h.audit.write = original;
  assert.equal((await h.service.deleteTemplate(admin, h.template.id, 'delete')).success, true);
});
