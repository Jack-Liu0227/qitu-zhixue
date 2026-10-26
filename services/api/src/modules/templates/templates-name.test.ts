import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryTemplateStore } from './templates.store';

test('template create/rename reserves archived names per ownership scope and leaves rejected writes untouched', async () => {
  const store = new InMemoryTemplateStore();
  const create = (id: string, title: string, schoolId: string | null = null) => store.createTemplate({
    id, title, schoolId, slug: id, summary: 'Synthetic fixture', createdBy: 'admin', now: new Date(),
  });
  await create('first', 'Optics Lab');
  await store.setTemplateStatus('first', 'archived', null, null, new Date());
  await assert.rejects(create('second', '  OPTICS\tLAB '), /同名模板/);
  assert.equal(await store.findTemplate('second'), null);
  await create('second', 'Other');
  await assert.rejects(store.updateTemplate('second', { title: 'optics lab' }, new Date()), /同名模板/);
  assert.equal((await store.findTemplate('second'))!.title, 'Other');
  await store.updateTemplate('first', { title: 'OPTICS LAB' }, new Date());
  await create('school', 'Optics Lab', 'school-a');
  await assert.rejects(create('school-copy', 'optics lab', 'school-a'), /同名模板/);
  await create('another-school', 'Optics Lab', 'school-b');
});
