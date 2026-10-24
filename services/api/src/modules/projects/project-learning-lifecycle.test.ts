import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CurrentUser, ProjectTemplateSpec } from '@qitu/contracts';
import { WAVE_TEACHING_TEMPLATE_SPEC } from '@qitu/ai-client/quiz-bank';
import type { AuditWriter } from '../../common/audit/audit.service';
import type { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import type { OutboxWriter } from '../../common/outbox/outbox.service';
import { InMemoryLearningPlanStore, type PlanBundle } from '../learning-plan/learning-plan.store';
import type { LearningSessionProgressService } from '../learning-plan/learning-session-progress.service';
import type { MasteryDomainService } from '../mastery/mastery-domain.service';
import type { TemplateBindingService } from '../templates/templates-binding.service';
import { FakeAuditWriter, FakeIdempotencyStore } from '../templates/templates.test-support';
import { THUNDER_TEMPLATE_SPEC } from '../templates/content/thunder-fighter';
import type { WorksLearningEvidenceService } from '../works/works-learning-evidence.service';
import { ProjectLearningLifecycleService } from './project-learning-lifecycle.service';

const student: CurrentUser = { id: 'isolated-student', role: 'student', email: '', displayName: '' };

/** Synthetic persisted facts are confined to this disposable fixture; wave fullflow tests use real grading. */
async function fixture(spec: ProjectTemplateSpec) {
  const store = new InMemoryLearningPlanStore(), profile = spec.curriculum!.profiles[0]!;
  const now = new Date();
  const bundle: PlanBundle = {
    plan: { id: 'plan', studentUserId: student.id, projectId: null, interest: 'isolated', goal: '', lessonCount: profile.sessions.length,
      lessonMinutes: 60, minutesPerSession: 60, templateVersion: 'frozen', status: 'draft', version: 1,
      idempotencyKey: 'plan', confirmedAt: null, completedAt: null, createdAt: now, updatedAt: now },
    modules: [], objectives: [],
    sessions: profile.sessions.map((session, index) => ({ id: `plan:${session.id}`, planId: 'plan', moduleId: 'module',
      index, lessonIndex: session.sessionIndex, blocks: [], theoryObjectiveIds: [], practiceObjectiveIds: [], mode: 'study' })),
  };
  await store.createPlan(bundle);
  await store.confirmPlan({ planId: 'plan', now, project: { id: 'project', studentId: student.id, templateVersionId: 'frozen',
    status: 'theory_learning', currentStageIndex: 0, stageTotal: 10, progressPercent: 0, title: 'Isolated', subtitle: null, tags: [] } });
  let currentIndex = 2;
  const mastered = new Set<string>(), queried: string[][] = [], events: unknown[] = [];
  const progress = { readProgress: async () => ({ contractReady: true, planRevision: 1,
    currentSessionId: bundle.sessions[currentIndex - 1]!.id, completedCount: currentIndex - 1 }) } as unknown as LearningSessionProgressService;
  const mastery = { checkRequiredObjectives: async (_actor: CurrentUser, _student: string, _plan: string, ids: string[]) => {
    queried.push(ids); return ids.every(id => mastered.has(id));
  } } as unknown as MasteryDomainService;
  const bindings = { getFrozenTeachingBundle: async () => ({ templateVersionId: 'frozen', scheduleProfileId: profile.id, template: spec }) } as unknown as TemplateBindingService;
  const lifecycle = new ProjectLearningLifecycleService(store, progress, bindings, mastery,
    { getLessonProofs: async () => ({ submissions: [], observations: [], approvedArtifacts: [], reflections: [] }) } as unknown as WorksLearningEvidenceService,
    new FakeIdempotencyStore() as unknown as IdempotencyStore, new FakeAuditWriter() as unknown as AuditWriter,
    { write: async (event: unknown) => { events.push(event); return 'event'; } } as OutboxWriter);
  return { store, lifecycle, mastered, queried, events, current: (index: number) => { currentIndex = index; },
    sessionIds: bundle.sessions.map(session => session.id),
    masterLesson: (index: number) => profile.sessions[index - 1]!.objectiveIds.forEach(id => mastered.add(`plan:${id}`)) };
}

test('thunder requires both theory lessons, and readiness never completes or skips a lesson', async () => {
  const f = await fixture(THUNDER_TEMPLATE_SPEC);
  f.masterLesson(2);
  await f.lifecycle.syncAfterAnswer(student, 'plan', 'lesson-2-answer');
  assert.equal((await f.store.findProject('project'))?.status, 'theory_learning');
  assert.equal(f.queried.at(-1)?.length, 4);
  f.current(3);
  await f.lifecycle.syncAfterAnswer(student, 'plan', 'before-lesson-3-answer');
  assert.equal((await f.store.findProject('project'))?.status, 'theory_check');
  f.masterLesson(3);
  await f.lifecycle.syncAfterAnswer(student, 'plan', 'lesson-3-answer');
  assert.equal((await f.store.findProject('project'))?.status, 'practice_ready');
  assert.equal((await f.store.listSessionCompletions('plan', 1)).length, 0);
  const count = f.events.length;
  await f.lifecycle.syncAfterAnswer(student, 'plan', 'lesson-3-answer');
  await f.lifecycle.syncAfterAnswer(student, 'plan', 'another-readiness-request');
  assert.equal(f.events.length, count, 'retries never duplicate project transitions');
});

test('optics fails closed before all readiness objectives and rejects another student', async () => {
  const f = await fixture(WAVE_TEACHING_TEMPLATE_SPEC);
  f.current(3);
  await assert.rejects(f.lifecycle.syncAfterAnswer(student, 'plan', 'no-mastery'), error =>
    (error as { getResponse(): { code: string } }).getResponse().code === 'THEORY_MASTERED_REQUIRED');
  assert.equal((await f.store.findProject('project'))?.status, 'theory_learning');
  f.masterLesson(2);
  await assert.rejects(f.lifecycle.syncAfterAnswer({ ...student, id: 'another-student' }, 'plan', 'unauthorized'));
  assert.equal(f.events.length, 0);
  await f.lifecycle.syncAfterAnswer(student, 'plan', 'recover-existing-mastery');
  assert.equal((await f.store.findProject('project'))?.status, 'practice_building');
});
