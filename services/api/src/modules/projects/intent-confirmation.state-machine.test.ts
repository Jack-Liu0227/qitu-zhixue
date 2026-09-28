import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canCreateFormalProject,
  closeExploration,
  computeStageProgress,
  confirmIntent,
  FORMAL_PROJECT_START_STAGE,
  IntentConfirmationError,
  isIntentDraftConfirmable,
  markAwaitingConfirmation,
  PROJECT_STAGE_ORDER,
} from './intent-confirmation.state-machine';

const draft = {
  goalUser: '为社区老人',
  coreInterests: ['适老化', '声音交互'],
  preferredForm: '小程序',
  targetBeneficiary: '独居老人',
};

describe('T6 意图确认状态机', () => {
  test('核心不变式：未确认时绝不创建正式项目', () => {
    // 空草稿 / 有内容但未确认 / 已关闭 —— 都不允许创建项目。
    assert.equal(canCreateFormalProject('exploring', null), false);
    assert.equal(canCreateFormalProject('exploring', { ...draft, confirmedAt: null }), false);
    assert.equal(
      canCreateFormalProject('awaiting_confirmation', { ...draft, confirmedAt: null }),
      false,
    );
    assert.equal(canCreateFormalProject('closed', { ...draft, confirmedAt: null }), false);
    // 只有「已确认 + 有确认凭据」才放行。
    assert.equal(canCreateFormalProject('confirmed', { ...draft, confirmedAt: null }), false);
    assert.equal(
      canCreateFormalProject('confirmed', { ...draft, confirmedAt: '2025-01-01T00:00:00.000Z' }),
      true,
    );
  });

  test('候选意图未形成时不能进入确认阶段（避免诱导误确认）', () => {
    assert.throws(
      () => markAwaitingConfirmation('exploring', { ...draft, coreInterests: [] }),
      (error: unknown) =>
        error instanceof IntentConfirmationError && error.code === 'INTENT_DRAFT_INCOMPLETE',
    );
    assert.throws(
      () => markAwaitingConfirmation('exploring', null),
      (error: unknown) =>
        error instanceof IntentConfirmationError && error.code === 'INTENT_DRAFT_INCOMPLETE',
    );
    // 只有空白标签同样视为未形成。
    assert.equal(isIntentDraftConfirmable({ ...draft, coreInterests: ['   '] }), false);
  });

  test('exploring → awaiting_confirmation → confirmed 正向路径', () => {
    const awaiting = markAwaitingConfirmation('exploring', draft);
    assert.equal(awaiting, 'awaiting_confirmation');

    const confirmed = confirmIntent(awaiting, draft, '2025-06-01T08:00:00.000Z');
    assert.equal(confirmed.status, 'confirmed');
    assert.equal(confirmed.draft.confirmedAt, '2025-06-01T08:00:00.000Z');
    assert.notEqual(confirmed.draft.coreInterests, draft.coreInterests, '应做防御性拷贝');
    assert.equal(canCreateFormalProject(confirmed.status, confirmed.draft), true);
  });

  test('不能从 exploring 直接确认（必须经过 awaiting_confirmation）', () => {
    assert.throws(
      () => confirmIntent('exploring', draft, '2025-06-01T08:00:00.000Z'),
      (error: unknown) =>
        error instanceof IntentConfirmationError &&
        error.code === 'EXPLORATION_TRANSITION_INVALID',
    );
  });

  test('已确认的探索不能再次确认或关闭', () => {
    assert.throws(
      () => confirmIntent('confirmed', draft, '2025-06-02T00:00:00.000Z'),
      (error: unknown) =>
        error instanceof IntentConfirmationError &&
        error.code === 'EXPLORATION_TRANSITION_INVALID',
    );
    assert.throws(
      () => closeExploration('confirmed'),
      (error: unknown) =>
        error instanceof IntentConfirmationError &&
        error.code === 'EXPLORATION_TRANSITION_INVALID',
    );
  });

  test('未确认的探索可以关闭，且关闭是幂等的', () => {
    assert.equal(closeExploration('exploring'), 'closed');
    assert.equal(closeExploration('awaiting_confirmation'), 'closed');
    assert.equal(closeExploration('closed'), 'closed');
  });

  test('正式项目固定从 intent_confirmed 起步，且阶段索引由服务端计算', () => {
    assert.equal(FORMAL_PROJECT_START_STAGE, 'intent_confirmed');
    assert.equal(PROJECT_STAGE_ORDER[0], 'exploration');
    assert.equal(PROJECT_STAGE_ORDER[PROJECT_STAGE_ORDER.length - 1], 'completed');

    const start = computeStageProgress(FORMAL_PROJECT_START_STAGE);
    assert.equal(start.currentStageIndex, 1);
    assert.equal(start.stageTotal, PROJECT_STAGE_ORDER.length);
    assert.ok(start.progressPercent > 0 && start.progressPercent < 100);

    const done = computeStageProgress('completed');
    assert.equal(done.currentStageIndex, PROJECT_STAGE_ORDER.length - 1);
    assert.equal(done.progressPercent, 100);
  });
});
