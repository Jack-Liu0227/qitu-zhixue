import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConflictException } from '@nestjs/common';
import { teachingContextFixture } from './tutor-teaching-context.test-fixture';
import { resolveTutorTeachingContext } from './tutor-teaching-context';

test('current lesson selects its frozen team independently of governance stage and previous team', async () => {
  const h = teachingContextFixture();
  const second = structuredClone(h.teaching);
  second.teamVersion = { teamVersionId: 'second-version', teamId: 'second-team', leaderAssistantId: 'second-mentor', members: [{ memberId: 'member-2', assistantId: 'second-mentor' }] };
  second.roles = second.roles.map(role => ({ ...role, memberId: 'member-2', assistantId: 'second-mentor' }));
  second.sessionRoutes = [{ sessionIndex: 2, roleSlotId: 'role-frozen' }];
  h.teaching.sessionRoutes = [{ sessionIndex: 1, roleSlotId: 'role-frozen' }];
  h.teaching.sessionAssignments = [{ sessionIndex: 1, teamVersionId: h.teaching.teamVersion.teamVersionId, kind: 'team' }, { sessionIndex: 2, teamVersionId: 'second-version', kind: 'team' }];
  h.teaching.sessionTeamBundles = [second];
  assert.equal((await resolveTutorTeachingContext(h.store, h.project, h.teaching)).role.assistantId, 'session-mentor');
  h.completed.add('plan-frozen:lesson-1');
  const context = await resolveTutorTeachingContext(h.store, h.project, h.teaching);
  assert.equal(context.role.assistantId, 'second-mentor');
  assert.equal(context.bundle.teamVersion.teamVersionId, 'second-version');
  assert.equal(context.bindingTeamVersionId, 'synthetic-team-version');
  assert.equal(h.project.status, 'theory_learning');
  second.templateVersionId = 'other-template';
  await assert.rejects(resolveTutorTeachingContext(h.store, h.project, h.teaching), ConflictException);
});
test('awaiting question selects its persisted session and task instead of stage, title or first missing mastery', async () => {
  const h = teachingContextFixture();
  h.completed.add('plan-frozen:lesson-1');
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

test('mastery never skips a lesson; explicit completion selects the next lesson', async () => {
  const h = teachingContextFixture();
  h.mastered.add('plan-frozen:objective-1');
  h.mastered.add('plan-frozen:objective-2');
  assert.equal((await resolveTutorTeachingContext(h.store, h.project, h.teaching)).lesson.lessonIndex, 1);
  h.completed.add('plan-frozen:lesson-1');
  const result = await resolveTutorTeachingContext(h.store, h.project, h.teaching);
  assert.equal(result.lesson.lessonIndex, 2);
  assert.equal(result.lesson.status, 'current');
  assert.equal(result.objective?.id, 'plan-frozen:objective-2');
  h.completed.add('plan-frozen:lesson-2');
  assert.equal((await resolveTutorTeachingContext(h.store, h.project, h.teaching)).lesson.status, 'completed');
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
