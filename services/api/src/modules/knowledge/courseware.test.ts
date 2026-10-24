import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CurrentUser } from '@qitu/contracts';
import { CoursewareService } from './courseware.service';
import { InMemoryCoursewareStore } from './courseware.store';
import { AuditWriter } from '../../common/audit/audit.service';

const admin: CurrentUser = { id: 'admin-fixture', role: 'admin', email: '', displayName: '' };
const student: CurrentUser = { ...admin, id: 'student-fixture', role: 'student' };
const source = { knowledgeBaseId: 'kb', documentRefHash: 'a'.repeat(64), title: 'Authorized wave teaching source' };
const curriculumHash = 'd'.repeat(64);
const content = { title: 'Superposition', steps: [{ caption: 'Compare the displacement of two waves.', tex: 'y=y_1+y_2' }] };
const scope = { projectId: 'project-fixture', planId: 'plan', planRevision: 1, learningSessionId: 'session', activityId: 'session:activity:theory' };
const review = { scientific: true, teaching: true, rendering: true, privacy: true, rights: true, note: 'Isolated review fixture' };
function fixture() {
  const store = new InMemoryCoursewareStore(); let writes = 0;
  const audit = { write: async () => { writes++; return 'audit'; } } as AuditWriter;
  return { store, service: new CoursewareService(store, audit), writes: () => writes };
}
test('project content persists idempotently, nominates metadata-free candidates, and never grants publication', async () => {
  const h = fixture(); const input = { actor: student, scope, content, curriculumHash, sources: [source], objectiveRefs: ['wave-ready-superposition'], key: 'turn-1' };
  const [a, b] = await Promise.all([h.service.capture(input), h.service.capture(input)]);
  assert.deepEqual(a, b); assert.equal(h.writes(), 1);
  assert.equal((await h.store.instances(scope.projectId, scope.planId, 1, scope.learningSessionId)).length, 1);
  assert.deepEqual(await h.service.find(input.objectiveRefs, ['kb'], 'explain', curriculumHash), []);
  const candidates = await h.service.list(admin); assert.equal(candidates.length, 1);
  assert.doesNotMatch(JSON.stringify(candidates), /student-fixture|project-fixture|tutorSessionId|questionId|acknowledgedAt/);
  await assert.rejects(h.service.list(student));
  await assert.rejects(h.service.capture({ ...input, content: { ...content, title: 'Changed' } }));
  const saved = await h.service.acknowledge(student, a, 0, true, 'continue');
  assert.ok(saved.acknowledgedAt); assert.deepEqual(await h.service.acknowledge(student, a, 0, true, 'continue'), saved);
  assert.equal((await h.store.version(candidates[0]!.versionId))?.status, 'candidate');
});
test('feedback is bounded, deduplicated and invalidates stale review without writing learning facts', async () => {
  const h = fixture();
  const instance = await h.service.capture({ actor: student, scope, content, curriculumHash, sources: [source], objectiveRefs: ['wave'], key: 'feedback-content' });
  const [candidate] = await h.service.list(admin); assert.ok(candidate);
  const feedback = await h.service.feedback(student, instance, 'understanding', 'feedback-1');
  assert.deepEqual(await h.service.feedback(student, instance, 'understanding', 'feedback-1'), feedback);
  await h.service.feedback(student, instance, 'understanding', 'feedback-retry');
  const fresh = await h.store.version(candidate.versionId);
  assert.equal(fresh?.feedbackCounts?.understanding, 1);
  assert.equal(fresh?.revision, 2);
  assert.doesNotMatch(JSON.stringify(fresh), /student-fixture|project-fixture|questionId|answer/);
  await assert.rejects(h.service.review(admin, candidate.versionId, { expectedRevision: 1, status: 'published', review }, 'stale-review'));
  await h.service.review(admin, candidate.versionId, { expectedRevision: 2, status: 'withdrawn', review }, 'withdraw-feedback');
  await assert.rejects(h.service.acknowledge(student, instance, 0, true, 'after-withdrawal'));
});
test('review, scope, sources, lineage, immutable versions and withdrawal govern cross-project reuse', async () => {
  const h = fixture(); const input = { content, curriculumHash, sources: [source], objectiveRefs: ['wave-ready-superposition'], use: 'explain', changeSummary: 'Source-grounded example' };
  const candidate = await h.service.create(admin, input, 'create');
  await assert.rejects(h.service.review(student, candidate.versionId, { expectedRevision: 1, status: 'published', review }, 'student-review'));
  await assert.rejects(h.service.review(admin, candidate.versionId, { expectedRevision: 1, status: 'published', review: { ...review, privacy: false } }, 'bad-review'));
  const published = await h.service.review(admin, candidate.versionId, { expectedRevision: 1, status: 'published', review }, 'publish');
  assert.deepEqual(await h.service.find(input.objectiveRefs, [], 'explain', curriculumHash), []);
  assert.equal((await h.service.find(input.objectiveRefs, ['kb'], 'explain', curriculumHash)).length, 1);
  await assert.rejects(h.service.reuse(published.versionId, ['other-objective'], [source], curriculumHash));
  await assert.rejects(h.service.reuse(published.versionId, input.objectiveRefs, [{ ...source, documentRefHash: 'b'.repeat(64) }], curriculumHash));
  const reused = await h.service.reuse(published.versionId, input.objectiveRefs, [source], curriculumHash);
  const instance = await h.service.capture({ actor: student, scope: { ...scope, projectId: 'second-project' },
    content: reused.content, curriculumHash, sources: [source], objectiveRefs: input.objectiveRefs, assetVersionId: reused.versionId, key: 'reuse' });
  assert.equal(instance.assetVersionId, published.versionId); assert.equal(instance.acknowledgedAt, null);
  await assert.rejects(h.service.create(admin, { ...input, sources: [{ ...source, documentRefHash: 'c'.repeat(64) }], parentVersionId: published.versionId }, 'lost-source'));
  const adapted = await h.service.create(admin, { ...input, content: { ...content, title: 'Revised comparison' }, parentVersionId: published.versionId }, 'adapt');
  assert.equal(adapted.assetId, published.assetId); assert.equal(adapted.parentVersionId, published.versionId);
  assert.equal((await h.store.version(published.versionId))?.content.title, content.title);
  await h.service.review(admin, published.versionId, { expectedRevision: 2, status: 'withdrawn', review }, 'withdraw');
  await assert.rejects(h.service.reuse(published.versionId, input.objectiveRefs, [source], curriculumHash));
  assert.deepEqual(await h.service.find(input.objectiveRefs, ['kb'], 'explain', curriculumHash), []);
});
test('unsupported executable content and forged metadata fail before persistence; failed audit rolls back content', async () => {
  const h = fixture();
  await assert.rejects(h.service.create(admin, { content: { title: 'Bad', steps: [{ caption: 'Run', html: '<script />' }] },
    sources: [source], objectiveRefs: ['wave'], use: 'explain', changeSummary: 'invalid' }, 'bad'));
  const failed = new CoursewareService(h.store, { write: async () => { throw Error('audit unavailable'); } } as AuditWriter);
  await assert.rejects(failed.capture({ actor: student, scope, content, curriculumHash, sources: [source], objectiveRefs: ['wave'], key: 'audit-failure' }));
  assert.equal((await h.store.versions()).length, 0); assert.equal((await h.store.instances(scope.projectId, scope.planId, 1, scope.learningSessionId)).length, 0);
});
