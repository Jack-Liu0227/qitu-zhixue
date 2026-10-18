import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TutorProjectContext } from '@qitu/contracts';
import { TutorService } from './tutor.service';
import { buildProjectOpeningBlocks } from './tutor-opening';
import { InMemoryTutorSessionStore } from './tutor-session.store';
import type { LearningPlanStore } from '../learning-plan/learning-plan.store';
import type { TemplateBindingService } from '../templates/templates-binding.service';

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
