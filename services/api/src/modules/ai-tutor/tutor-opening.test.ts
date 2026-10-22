import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TutorProjectContext } from '@qitu/contracts';
import { TutorService } from './tutor.service';
import { buildProjectOpeningBlocks } from './tutor-opening';
import { InMemoryTutorSessionStore } from './tutor-session.store';
import type { LearningPlanStore } from '../learning-plan/learning-plan.store';
import type { TemplateBindingService } from '../templates/templates-binding.service';
import { WAVE_OPTICS_TEMPLATE_SPEC } from '@qitu/ai-client/quiz-bank';

const context: TutorProjectContext = {
  project: { id: 'project-real', title: 'Frozen project title', stage: 'intent_confirmed', progress: 10, templateVersionId: 'tplv-random-uuid' },
  team: { teamId: 'team-frozen', teamName: 'Frozen team', assistantId: 'assistant-real', assistantName: 'Real mentor' },
  progress: { currentStageIndex: 1, stageTotal: 10, progressPercent: 10 },
  stages: [], currentTask: null,
  phases: [{ phaseId: 'concept_mastery', orderIndex: 1, name: 'Actual frozen phase', status: 'active', requiresGateApproval: true,
    gateRule: 'TheoryMastered', gateStatus: 'pending', requiredDeliverables: [] }],
};

// Exercise store rehydration, not the separate demo-mode six-turn seeded session.
class StorePathFixture extends InMemoryTutorSessionStore {
  override readonly durable: boolean = true;
}

test('frozen lesson openings persist once per actual lesson and revision, including after restart and concurrent reads', async () => {
  const store = new StorePathFixture();
  const sessions = WAVE_OPTICS_TEMPLATE_SPEC.curriculum!.profiles[0]!.sessions;
  const current = structuredClone(context);
  const select = (index: number) => {
    const lesson = sessions[index]!;
    current.lesson = { title: lesson.title, lessonIndex: index + 1, lessonCount: sessions.length, completedCount: index, status: 'current',
      planId: 'actual-plan', planRevision: 1, learningSessionId: `actual-plan:${lesson.id}`, opening: lesson.opening, learningGoal: lesson.learningGoal };
    current.team = { ...context.team!, assistantId: lesson.leadAssistantId!, assistantName: `Mentor for lesson ${index + 1}` };
  };
  select(0);
  const make = () => {
    const tutor = new TutorService('live', { complete: async () => { throw Error('opening must not call a model'); } }, undefined, undefined, undefined, store);
    Object.assign(tutor, { learningStore: { findProject: async () => ({ studentId: 'owner' }) }, getProjectContext: async () => current });
    return tutor;
  };
  await Promise.all([make().resolveSession(current.project!.id, 'owner'), make().resolveSession(current.project!.id, 'owner')]);
  let saved = await store.findByProject(current.project!.id); assert.equal(saved?.turns.length, 1);
  const block = saved!.turns[0]!.blocks[0]; assert.ok(block?.kind === 'learning_opening' && block.mode === 'lesson');
  assert.equal(block.prompt, sessions[0]!.opening!.prompt); assert.equal(block.lessonCount, 8);
  select(1);
  const next = await make().resolveSession(current.project!.id, 'owner');
  assert.equal(next.turns.length, 2); assert.equal(next.turns[1]?.author?.id, sessions[1]!.leadAssistantId);
  assert.equal(next.turns[1]?.author?.role, '课时导师');
  assert.deepEqual((await make().resolveSession(current.project!.id, 'owner')).turns, next.turns);
  current.lesson!.planRevision = 2;
  saved = await make().resolveSession(current.project!.id, 'owner');
  assert.equal(saved.turns.length, 3);
  assert.equal(current.project!.stage, 'intent_confirmed');
});

test('formal opening is lesson-led even when governance stage differs; no static four-phase board is injected', () => {
  const blocks = buildProjectOpeningBlocks({ ...context,
    lesson: { lessonIndex: 7, lessonCount: 12, completedCount: 6, title: '透镜作图', status: 'current' } });
  assert.match(JSON.stringify(blocks), /第 7 \/ 12 课/);
  assert.match(JSON.stringify(blocks), /已完成 6 课时/);
  assert.equal(blocks.some(block => block.kind === 'board' || block.kind === 'pbl_card'), false);
  assert.equal(blocks.some(block => block.kind === 'options'), true);
});

test('opening uses actual project, phase and team, not optics titles, version prefixes or a fixed schedule', () => {
  const blocks = buildProjectOpeningBlocks(context);
  const card = blocks.find((block) => block.kind === 'pbl_card');
  assert.equal(card?.kind === 'pbl_card' && card.phase, 'concept_mastery');
  assert.equal(card?.kind === 'pbl_card' && card.title, context.project!.title);
  assert.match(JSON.stringify(blocks), /Real mentor|Actual frozen phase/);
  assert.doesNotMatch(JSON.stringify(blocks), /16 课时|optics-leader|开启第 1 课时/);
  assert.equal(blocks.some((block) => block.kind === 'optics_experiment'), false);
  assert.deepEqual(buildProjectOpeningBlocks({ ...context, team: undefined }), []);
  assert.deepEqual(buildProjectOpeningBlocks({ ...context, project: null }), []);
});

test('opening is persisted once, reloaded after service restart, and never resets project stage', async () => {
  const store = new StorePathFixture();
  const makeTutor = () => {
    const tutor = new TutorService('live', { complete: async () => { throw Error('opening must not call a model'); } },
      undefined, undefined, undefined, store);
    Object.assign(tutor, {
      learningStore: { findProject: async () => ({ studentId: 'owner' }) } as unknown as LearningPlanStore,
      getProjectContext: async () => context,
    });
    return tutor;
  };
  const first = await makeTutor().resolveSession(context.project!.id, 'owner');
  const second = await makeTutor().resolveSession(context.project!.id, 'owner');
  assert.equal(first.turns.length, 1);
  assert.deepEqual(first.turns, second.turns);
  assert.equal(second.turns[0]?.stageBefore, 'intent_confirmed');
  assert.equal(second.turns[0]?.stageAfter, 'intent_confirmed');
  assert.equal(second.turns[0]?.author?.id, 'assistant-real');
  assert.equal((await store.findByProject(context.project!.id))?.lastSeq, 1);
  // No second source of project state is created by the opening.
  assert.equal(context.project!.stage, 'intent_confirmed');
});

test('a project without a valid frozen binding cannot open a session or silently adopt the active team', async () => {
  const store = new InMemoryTutorSessionStore();
  const tutor = new TutorService('live', { complete: async () => { throw Error('not called'); } },
    undefined, undefined, undefined, store);
  Object.assign(tutor, {
    learningStore: { findProject: async () => ({ id: 'old-project', studentId: 'owner', templateVersionId: 'tplv-any' }) } as unknown as LearningPlanStore,
    platformRegistry: {},
    templateBindings: { findFrozenSnapshotForProject: async () => null } as unknown as TemplateBindingService,
  });
  await assert.rejects(tutor.resolveSession('old-project', 'owner'), /项目缺少有效的冻结团队绑定/);
  assert.equal(await store.findByProject('old-project'), null);
});
