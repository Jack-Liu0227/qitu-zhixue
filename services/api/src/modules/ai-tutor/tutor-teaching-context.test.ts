import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConflictException } from '@nestjs/common';
import { teachingContextFixture } from './tutor-teaching-context.test-fixture';
import { resolveTutorTeachingContext } from './tutor-teaching-context';
test('awaiting question selects its persisted session and task instead of stage, title or first missing mastery', async () => {
  const h = teachingContextFixture();
  h.setPending(2);
  const context = await resolveTutorTeachingContext(h.store, h.project, h.teaching);
  assert.equal(context.lesson.lessonIndex, 2);
  assert.equal(context.lesson.title, 'Frozen lesson 2');
  assert.equal(context.lesson.learningSessionId, 'plan-frozen:lesson-2');
  assert.equal(context.lesson.planRevision, 7);
  assert.equal(context.lesson.checkpoint, 'TheoryMastered');
  assert.equal(context.currentTask?.id, 'plan-frozen:objective-2');
  assert.equal(context.role.assistantId, 'session-mentor');
});

test('owner mastery selects remaining objective but does not declare session or checkpoint completion', async () => {
  const h = teachingContextFixture();
  h.mastered.add('plan-frozen:objective-1');
  assert.equal((await resolveTutorTeachingContext(h.store, h.project, h.teaching)).lesson.lessonIndex, 2);
  h.mastered.add('plan-frozen:objective-2');
  const result = await resolveTutorTeachingContext(h.store, h.project, h.teaching);
  assert.equal(result.lesson.status, 'current');
  assert.equal(result.objective, null);
});

test('invalid sessions, route membership, revision and cross-session pending facts are rejected', async () => {
  for (const mutation of [
    (h: ReturnType<typeof teachingContextFixture>) => { h.bundle.sessions[0]!.lessonIndex = 1.5; },
    (h: ReturnType<typeof teachingContextFixture>) => { h.bundle.sessions[0]!.lessonIndex = 16; },
    (h: ReturnType<typeof teachingContextFixture>) => { h.bundle.sessions[0]!.id = 'other-plan:lesson-1'; },
    (h: ReturnType<typeof teachingContextFixture>) => { h.teaching.sessionRoutes = []; },
    (h: ReturnType<typeof teachingContextFixture>) => { h.teaching.teamVersion.members = []; },
    (h: ReturnType<typeof teachingContextFixture>) => { h.plan.version = 1.5; },
    (h: ReturnType<typeof teachingContextFixture>) => { h.setPending(2, 1); },
  ]) {
    const h = teachingContextFixture(); mutation(h);
    await assert.rejects(resolveTutorTeachingContext(h.store, h.project, h.teaching), ConflictException);
  }
});
