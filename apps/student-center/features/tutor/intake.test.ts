import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  advanceToConfirmed,
  advanceToRecommend,
  confirmIntake,
  createIntakeState,
  recommendOpeningTurn,
  shouldShowIntakeOpening,
  type IntakeState,
} from './intake.js';
import type { ExplorationView, TutorTurn } from '@qitu/contracts';
import type { InspirationTemplate } from '../inspiration/types.js';

const template: InspirationTemplate = {
  id: 'kinetic-energy',
  title: '动手学动能定理 PBL',
  summary: 'Physics project',
  subject: '物理',
  tags: ['物理实验', '动能定理'],
  difficulty: '进阶',
  durationWeeks: 3,
  stages: [],
  outcome: 'Lab report',
  coverEmoji: '⚡',
};

function explorationView(id: string): ExplorationView {
  const now = new Date().toISOString();
  return {
    id,
    source: 'free',
    templateVersionId: null,
    status: 'awaiting_confirmation',
    intentDraft: null,
    projectId: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe('intake state machine', () => {
  it('creates initial interest phase', () => {
    const state = createIntakeState('exploration-1');
    assert.equal(state.phase, 'interest');
    assert.equal(state.explorationId, 'exploration-1');
    assert.deepEqual(state.recommendedTemplates, []);
    assert.equal(state.confirmedTemplateId, null);
  });

  it('creates recommend phase when deep-linked', () => {
    const state = createIntakeState('exploration-2', 'thunder-fighter');
    assert.equal(state.phase, 'recommend');
    assert.equal(state.explorationId, 'exploration-2');
  });

  it('advances from interest to recommend', () => {
    const initial = createIntakeState('exploration-3');
    const next = advanceToRecommend(initial, [template]);
    assert.equal(next.phase, 'recommend');
    assert.deepEqual(next.recommendedTemplates, [template]);
  });

  it('does not advance to recommend if not in interest phase', () => {
    const state: IntakeState = {
      phase: 'recommend', recommendedTemplates: [], confirmedTemplateId: null, explorationId: 'exploration-4',
    };
    const next = advanceToRecommend(state, []);
    assert.equal(next.phase, 'recommend');
    assert.strictEqual(next, state);
  });

  it('advances from recommend to confirmed', () => {
    const state: IntakeState = {
      phase: 'recommend', recommendedTemplates: [], confirmedTemplateId: null, explorationId: 'exploration-5',
    };
    const next = advanceToConfirmed(state, template.id);
    assert.equal(next.phase, 'confirmed');
    assert.equal(next.confirmedTemplateId, template.id);
  });

  it('does not advance to confirmed if not in recommend phase', () => {
    const state: IntakeState = {
      phase: 'interest', recommendedTemplates: [], confirmedTemplateId: null, explorationId: 'exploration-6',
    };
    const next = advanceToConfirmed(state, template.id);
    assert.equal(next.phase, 'interest');
    assert.equal(next.confirmedTemplateId, null);
  });

  it('keeps recommend phase when updateIntentDraft fails', async () => {
    const source = {
      updateIntentDraft: async () => { throw new Error('draft failed'); },
      confirmIntent: async () => { throw new Error('must not run'); },
    };
    const result = await confirmIntake(
      { ...createIntakeState('exploration-failed-draft'), phase: 'recommend', recommendedTemplates: [template] },
      template,
      '我想研究小车',
      source,
      () => 'key',
    );
    assert.equal(result.state.phase, 'recommend');
    assert.equal(result.response, null);
    assert.ok(result.error instanceof Error);
  });

  it('keeps recommend phase when confirmIntent fails', async () => {
    const source = {
      updateIntentDraft: async () => explorationView('exploration-failed-confirm'),
      confirmIntent: async () => { throw new Error('confirm failed'); },
    };
    const result = await confirmIntake(
      { ...createIntakeState('exploration-failed-confirm'), phase: 'recommend', recommendedTemplates: [template] },
      template,
      '我想研究小车',
      source,
      () => 'key',
    );
    assert.equal(result.state.phase, 'recommend');
    assert.equal(result.response, null);
  });

  it('sends only note in confirm request and does not double-submit a replay', async () => {
    const requests: unknown[] = [];
    const source = {
      updateIntentDraft: async () => explorationView('exploration-replayed'),
      confirmIntent: async (_id: string, request: unknown) => {
        requests.push(request);
        return {
          exploration: explorationView('exploration-replayed'),
          project: { id: 'project-replayed', title: '小车实验', stage: 'intent_confirmed' as const, progress: 0 },
          replayed: true,
        };
      },
    };
    const result = await confirmIntake(
      { ...createIntakeState('exploration-replayed'), phase: 'recommend', recommendedTemplates: [template] },
      template,
      '我想研究小车',
      source,
      () => 'key',
    );
    assert.deepEqual(requests, [{ note: '我想研究小车' }]);
    assert.equal(result.response?.replayed, true);
    assert.equal(result.state.phase, 'confirmed');
  });

  it('persists only the fields the student actually provided', async () => {
    const drafts: unknown[] = [];
    const source = {
      updateIntentDraft: async (_id: string, request: unknown) => {
        drafts.push(request);
        return explorationView('exploration-draft');
      },
      confirmIntent: async () => ({
        exploration: explorationView('exploration-draft'),
        project: { id: 'project-draft', title: '小车实验', stage: 'intent_confirmed' as const, progress: 0 },
        replayed: false,
      }),
    };
    await confirmIntake(
      { ...createIntakeState('exploration-draft'), phase: 'recommend', recommendedTemplates: [template] },
      { ...template, tags: ['  物理实验  ', '', '动能定理'] },
      '  我想研究小车  ',
      source,
      () => 'key',
    );
    // The template's subject/outcome are NOT the student's preferred form or
    // beneficiary: writing them into the draft would fabricate intent.
    assert.deepEqual(drafts, [{ coreInterests: ['物理实验', '动能定理'], goalUser: '我想研究小车' }]);
  });

  it('leaves the goal empty when the student said nothing', async () => {
    const drafts: unknown[] = [];
    const source = {
      updateIntentDraft: async (_id: string, request: unknown) => {
        drafts.push(request);
        return explorationView('exploration-empty-goal');
      },
      confirmIntent: async () => ({
        exploration: explorationView('exploration-empty-goal'),
        project: { id: 'project-empty-goal', title: '物理实验 主题项目', stage: 'intent_confirmed' as const, progress: 0 },
        replayed: false,
      }),
    };
    await confirmIntake(
      { ...createIntakeState('exploration-empty-goal'), phase: 'recommend', recommendedTemplates: [template] },
      template,
      '   ',
      source,
      () => 'key',
    );
    assert.deepEqual(drafts, [{ coreInterests: ['物理实验', '动能定理'], goalUser: null }]);
  });

  it('names the deep-linked direction in the recommendation opening', () => {
    const turn = recommendOpeningTurn('动手学动能定理 PBL');
    assert.equal(turn.role, 'assistant');
    assert.equal(turn.blocks[0]?.kind, 'text');
    const text = turn.blocks[0]?.kind === 'text' ? turn.blocks[0].text : '';
    assert.ok(text.includes('动手学动能定理 PBL'));
    // The zero-side-effect promise is part of the copy, not of model behaviour.
    assert.ok(text.includes('只有你点确认之后'));
  });

  it('shows intake opening when no server turns exist', () => assert.equal(shouldShowIntakeOpening([]), true));

  it('hides intake opening when server turns exist', () => {
    const turns: TutorTurn[] = [{
      turnId: 'turn-1', role: 'assistant', blocks: [{ kind: 'text', text: 'Hello' }], hintLevel: null,
      stageBefore: null, stageAfter: null, seq: 1, createdAt: new Date().toISOString(), modality: 'text',
    }];
    assert.equal(shouldShowIntakeOpening(turns), false);
  });

  it('shows intake opening when only local echo exists', () => {
    const turns: TutorTurn[] = [{
      turnId: 'local-echo-abc', role: 'student', blocks: [{ kind: 'text', text: 'Hi' }], hintLevel: null,
      stageBefore: null, stageAfter: null, seq: 1, createdAt: new Date().toISOString(), modality: 'text',
    }];
    assert.equal(shouldShowIntakeOpening(turns), true);
  });
});
