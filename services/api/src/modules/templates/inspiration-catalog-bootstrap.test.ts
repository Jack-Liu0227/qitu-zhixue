import assert from 'node:assert/strict';
import { test } from 'node:test';
import { configureInspirationCatalog } from './inspiration-catalog-bootstrap';
import { INSPIRATION_COURSES } from './content/inspiration';
import { inspirationAdmin, inspirationCatalogFixture, inspirationModel } from './inspiration-catalog.test-fixture';
import { TemplatesService } from './templates.service';
import { InMemoryTemplateViewerDirectory } from './template-evidence.store';
import { actor } from './templates.test-support';
import { teachingValueDigest } from './teaching-bundle.canonical';
import { INSPIRATION_DIALOGUE_COURSES } from './content/inspiration/dialogue-courses';

test('dialogue catalog creates separate governed versions and leaves guided bindings unchanged', async () => {
  const h = inspirationCatalogFixture();
  const guided = await configureInspirationCatalog(h.ports, { actor: inspirationAdmin, model: inspirationModel, mode: 'pilot' });
  assert.equal(guided.success, true);
  const before = await Promise.all(guided.results.map(async item => item.status === 'configured'
    ? h.bindingStore.findActiveBinding(item.resource.templateVersionId) : null));
  const options = { actor: inspirationAdmin, model: inspirationModel, mode: 'pilot' as const, progression: 'dialogue' as const };
  const result = await configureInspirationCatalog(h.ports, options);
  assert.equal(result.success, true, JSON.stringify(result.results));
  assert.equal(result.results.length, INSPIRATION_DIALOGUE_COURSES.length);
  assert.equal((await configureInspirationCatalog(h.ports, options)).success, true);
  assert.equal(h.teams.size, 16);
  const after = await Promise.all(guided.results.map(async item => item.status === 'configured'
    ? h.bindingStore.findActiveBinding(item.resource.templateVersionId) : null));
  assert.deepEqual(after, before);
});

test('Admin creates eight real governed curricula and teams; replay creates no duplicates and preserves source grants', async () => {
  const h = inspirationCatalogFixture();
  const result = await configureInspirationCatalog(h.ports, { actor: inspirationAdmin, model: inspirationModel, mode: 'pilot' });
  assert.equal(result.success, true, JSON.stringify(result.results));
  assert.equal(h.assistants.size, 24); assert.equal(h.teams.size, 8);
  const versions = [];
  for (const item of result.results) {
    assert.equal(item.status, 'configured'); if (item.status !== 'configured') continue;
    const binding = await h.bindingStore.findActiveBinding(item.resource.templateVersionId); assert(binding?.bundlePayload);
    assert.equal(binding.status, 'active');
    assert.equal(binding.bundlePayload.sessionAssignments?.length, 8);
    assert.equal(binding.bundlePayload.knowledgeGrant, null);
    assert(binding.bundlePayload.roles.every(role => role.modelByPurpose.dialogue?.modelProviderId === inspirationModel.modelProviderId));
    assert.equal(binding.bundleDigest, teachingValueDigest(binding.bundlePayload));
    versions.push(item.resource.templateVersionId);
  }
  const service = new TemplatesService(h.templates, new InMemoryTemplateViewerDirectory(), undefined, h.bindingStore);
  const visible = await service.listPublishedTemplates(actor('student', 'isolated-viewer'));
  assert.equal(visible.length, 8); assert(visible.every(item => item.lessonCount === 8 && item.lessonMinutes === 60));
  const replay = await configureInspirationCatalog(h.ports, { actor: inspirationAdmin, model: inspirationModel, mode: 'pilot' });
  assert.equal(replay.success, true, JSON.stringify(replay.results));
  assert.equal(h.assistants.size, 24); assert.equal(h.teams.size, 8);
  assert.equal((await h.templates.listTemplates({ visibleToSchoolId: null })).length, 8);
  for (const id of versions) assert.equal((await h.bindingStore.listBindings(id)).length, 1);
});

test('drafts stay invisible, can enter pilot later, and interrupted capture resumes without duplicate resources', async () => {
  const h = inspirationCatalogFixture(), selected = [INSPIRATION_COURSES[5].slug];
  const options = { actor: inspirationAdmin, model: inspirationModel, mode: 'draft' as const, projects: selected };
  h.state.captureFailsOnce = true;
  assert.equal((await configureInspirationCatalog(h.ports, options)).success, false);
  assert.equal(h.assistants.size, 3); assert.equal(h.teams.size, 1);
  const draft = await configureInspirationCatalog(h.ports, options);
  assert.equal(draft.success, true, JSON.stringify(draft.results));
  const service = new TemplatesService(h.templates, new InMemoryTemplateViewerDirectory(), undefined, h.bindingStore);
  assert.equal((await service.listPublishedTemplates(actor('student', 'isolated-viewer'))).length, 0);
  const pilot = await configureInspirationCatalog(h.ports, { ...options, mode: 'pilot' });
  assert.equal(pilot.success, true, JSON.stringify(pilot.results));
  assert.equal(h.assistants.size, 3); assert.equal(h.teams.size, 1);
  assert.equal((await service.listPublishedTemplates(actor('student', 'isolated-viewer'))).length, 1);
});

test('non-Admin, invalid model and selection fail before writes; conflicting assistant is never overwritten', async () => {
  const h = inspirationCatalogFixture();
  const options = { actor: inspirationAdmin, model: inspirationModel, mode: 'draft' as const };
  await assert.rejects(configureInspirationCatalog(h.ports, { ...options, actor: actor('student', 'student') }));
  h.state.modelAvailable = false;
  await assert.rejects(configureInspirationCatalog(h.ports, options), /CATALOG_MODEL_UNAVAILABLE/);
  h.state.modelAvailable = true;
  await assert.rejects(configureInspirationCatalog(h.ports, { ...options, projects: ['unknown'] }));
  assert.equal(h.assistants.size, 0);
  const course = INSPIRATION_COURSES[5];
  await configureInspirationCatalog(h.ports, { ...options, projects: [course.slug] });
  const row = h.assistants.get(course.assistantIds[0]); assert(row);
  row.instructions = 'User edit that must be preserved.';
  const result = await configureInspirationCatalog(h.ports, { ...options, projects: [course.slug] });
  assert.equal(result.success, false);
  assert.equal(row.instructions, 'User edit that must be preserved.');
  assert.equal(h.assistants.size, 3);
});
