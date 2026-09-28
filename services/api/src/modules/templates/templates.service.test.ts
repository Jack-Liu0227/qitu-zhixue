import 'reflect-metadata';
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { actor, DEFAULT_STAGES, VALID_CREATE_INPUT } from './templates.test-support';
import type { InMemoryTemplateStore } from './templates.store';
import type { ReadHarness } from './templates.test-support';
import { makeReadHarness } from './templates.test-support';

const NOW = new Date('2026-02-01T00:00:00.000Z');

async function seedTemplate(
  store: InMemoryTemplateStore,
  input: { id: string; slug: string; schoolId: string | null; status?: 'draft' | 'published' },
): Promise<{ versionId: string }> {
  await store.createTemplate({
    ...VALID_CREATE_INPUT,
    id: input.id,
    slug: input.slug,
    schoolId: input.schoolId,
    createdBy: 'admin-1',
    now: NOW,
  });
  const version = await store.createVersion({
    id: `${input.id}-v1`,
    templateId: input.id,
    version: 'v1',
    stages: DEFAULT_STAGES,
    createdBy: 'admin-1',
    now: NOW,
  });
  if (input.status === 'published') {
    await store.setVersionStatus(version.id, 'published', NOW, NOW);
    await store.setTemplateStatus(input.id, 'published', 'admin-1', NOW, NOW);
  }
  return { versionId: version.id };
}

describe('TemplatesService（学生只读作用域）', () => {
  let harness: ReadHarness;

  beforeEach(() => {
    harness = makeReadHarness();
  });

  it('列表 = 平台 ∪ 本校已发布，不含他校 / 未发布', async () => {
    const { store, service, directory } = harness;
    await seedTemplate(store, { id: 'platform', slug: 'platform-1', schoolId: null, status: 'published' });
    await seedTemplate(store, { id: 'own', slug: 'own-1', schoolId: 'school-a', status: 'published' });
    await seedTemplate(store, { id: 'other', slug: 'other-1', schoolId: 'school-b', status: 'published' });
    await seedTemplate(store, { id: 'draft', slug: 'draft-1', schoolId: null });
    directory.setSchoolId('student-a', 'school-a');

    const list = await service.listPublishedTemplates(actor('student', 'student-a'));
    assert.deepEqual(
      list.map((item) => item.id).sort(),
      ['own', 'platform'],
    );
    assert.equal(list.find((item) => item.id === 'platform')?.scope, 'platform');
    assert.equal(list.find((item) => item.id === 'own')?.scope, 'school');
    assert.equal(list.find((item) => item.id === 'platform')?.latestPublishedVersionId, 'platform-v1');
  });

  it('读取他校模板 403，未发布模板 403', async () => {
    const { store, service, directory } = harness;
    await seedTemplate(store, { id: 'other', slug: 'other-1', schoolId: 'school-b', status: 'published' });
    await seedTemplate(store, { id: 'draft', slug: 'draft-1', schoolId: null });
    directory.setSchoolId('student-a', 'school-a');

    await assert.rejects(
      service.getPublishedTemplate(actor('student', 'student-a'), 'other'),
      (error: unknown) => (error as { getStatus?: () => number }).getStatus?.() === 403,
    );
    await assert.rejects(
      service.getPublishedTemplate(actor('student', 'student-a'), 'draft'),
      (error: unknown) => (error as { getStatus?: () => number }).getStatus?.() === 403,
    );
  });

  it('版本列表只返回已发布版本；未发布版本详情 404', async () => {
    const { store, service, directory } = harness;
    const { versionId } = await seedTemplate(store, {
      id: 'platform',
      slug: 'platform-1',
      schoolId: null,
      status: 'published',
    });
    const draftVersion = await store.createVersion({
      id: 'platform-v2',
      templateId: 'platform',
      version: 'v2',
      stages: DEFAULT_STAGES,
      createdBy: 'admin-1',
      now: NOW,
    });
    directory.setSchoolId('student-a', 'school-a');
    const student = actor('student', 'student-a');

    const versions = await service.listPublishedVersions(student, 'platform');
    assert.deepEqual(
      versions.map((version) => version.id),
      [versionId],
    );
    const detail = await service.getPublishedVersion(student, 'platform', versionId);
    assert.equal(detail.id, versionId);
    assert.deepEqual(detail.stages, DEFAULT_STAGES);

    await assert.rejects(
      service.getPublishedVersion(student, 'platform', draftVersion.id),
      (error: unknown) => (error as { getStatus?: () => number }).getStatus?.() === 404,
    );
  });

  it('不存在的模板 404', async () => {
    const { service, directory } = harness;
    directory.setSchoolId('student-a', 'school-a');
    await assert.rejects(
      service.getPublishedTemplate(actor('student', 'student-a'), 'missing'),
      (error: unknown) => (error as { getStatus?: () => number }).getStatus?.() === 404,
    );
  });
});
