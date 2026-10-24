import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateLessonCandidate, GatewayLessonQualityEvaluator, type LessonEvaluationInput } from './lesson-quality-evaluator';
import type { ModelGateway } from '../model-registry/model-gateway';
import { ModelGatewayError } from '../model-registry/model-gateway.errors';

const input = { content: 'A recorded observation.', evidence: [], criteria: [{ id: 'evidence', description: 'Explain the observation.' }] } as unknown as LessonEvaluationInput;
const candidate = { criterionId: 'evidence', meets: true, feedback: 'Supported by the supplied observation.', evidenceQuote: 'recorded observation' };
test('theory defers runnable code to practice while preserving the frozen rubric and negative concept feedback', async () => {
  for (const activity of ['theory', 'practice'] as const) {
    const criteria = [{ id: 'evidence', description: '代码、输入和输出或实际结果相互对应。' }];
    const evaluator = new GatewayLessonQualityEvaluator({ complete: async (_usage: string, request: { messages: { content: string }[] }) => {
      const payload = JSON.parse(request.messages[1]!.content);
      assert.deepEqual(payload.criteria, criteria, 'Do not rewrite the frozen criteria');
      const deferred = JSON.stringify(payload.evaluationScope.deferredRequirements);
      assert.equal(deferred.includes('可运行程序'), activity === 'theory');
      assert.equal(payload.evaluationScope.stage, activity === 'theory' ? 'preparation' : 'evidence_review');
      return { providerId: 'isolated', modelId: 'fixture', text: JSON.stringify({ criteria: [
        { ...candidate, meets: false, evidenceQuote: '', feedback: 'The prediction contradicts the stated coordinate rule.' },
      ] }) };
    } } as unknown as ModelGateway);
    const result = await evaluator.evaluate({ ...input, criteria, kind: 'session_response',
      lesson: { title: 'Programming fixture' } as LessonEvaluationInput['lesson'],
      activity: { activity, evidence: 'session_response' } as LessonEvaluationInput['activity'] });
    assert.equal(result.criteria[0]?.meets, false, 'Scoping never turns incorrect reasoning into a pass');
  }
});
test('legacy review receipts remain owner requirements without circular content scoring or frozen contract mutation', async () => {
  for (const ownerChecks of [true, false]) {
    const description = '两类现象的证据比较档案及作品审核回执与归档回执';
    const lesson = { title: 'Fixture', evidenceRequirements: [description], activityGuidance: { reflect: description },
      ...(ownerChecks ? { completionSpec: { requiredEvidence: [{ kind: 'approved_artifact' }] },
        checkpoint: { requiredGate: 'review_completed_and_archived' } } : {}) } as unknown as LessonEvaluationInput['lesson'];
    const original = JSON.stringify(lesson);
    let calls = 0;
    const evaluator = new GatewayLessonQualityEvaluator({ complete: async (_usage: string, request: { messages: { content: string }[] }) => {
      calls++;
      const payload = JSON.parse(request.messages[1]!.content);
      const expected = ownerChecks ? '两类现象的证据比较档案' : description;
      assert.deepEqual(payload.criteria, [{ id: 'evidence', description: expected }]);
      assert.deepEqual(payload.lesson.evidenceRequirements, [expected]);
      assert.equal(payload.lesson.activityGuidance.reflect, expected);
      assert.deepEqual(payload.ownerManagedRequirements, ownerChecks ? ['artifact_review_receipt', 'project_archive_receipt'] : []);
      assert.equal(payload.studentContent, input.content);
      return { providerId: 'isolated', modelId: 'fixture', text: JSON.stringify({ criteria: [
        { ...candidate, meets: false, evidenceQuote: '', feedback: 'Actual comparison data is missing.' },
      ] }) };
    } } as unknown as ModelGateway);
    const criteria = [{ id: 'evidence', description }];
    const result = await evaluator.evaluate({ ...input, lesson, criteria, kind: 'submitted_artifact' });
    assert.equal(calls, 1); assert.equal(result.criteria[0]?.meets, false);
    assert.equal(JSON.stringify(lesson), original); assert.equal(criteria[0]?.description, description);
  }
});

test('whole-lesson executable-game criterion is scoped to preparation reasoning without changing its frozen identity', async () => {
  const description = '代码、测试输入和实际结果相互对应；不把静态检查当成可玩验证。';
  for (const activity of ['review', 'theory', 'check', 'practice', 'reflect'] as const) {
    const criteria = [{ id: 'evidence', description }];
    const evaluator = new GatewayLessonQualityEvaluator({ complete: async (_usage: string, request: { messages: { content: string }[] }) => {
      const payload = JSON.parse(request.messages[1]!.content);
      assert.equal(payload.criteria[0].id, 'evidence');
      if (['review', 'theory', 'check'].includes(activity)) {
        assert.match(payload.criteria[0].description, /示例输入和预测结果相互对应/);
        assert.doesNotMatch(payload.criteria[0].description, /代码、测试输入和实际结果相互对应/);
      } else assert.equal(payload.criteria[0].description, description);
      return { providerId: 'isolated', modelId: 'fixture', text: JSON.stringify({ criteria: [
        { ...candidate, meets: false, evidenceQuote: '', feedback: 'The predicted reset leaves the game in GAME_OVER.' },
      ] }) };
    } } as unknown as ModelGateway);
    const result = await evaluator.evaluate({ ...input, criteria, kind: 'session_response',
      lesson: { title: 'Frozen programming lesson' } as LessonEvaluationInput['lesson'],
      activity: { activity, evidence: 'session_response' } });
    assert.equal(criteria[0]!.description, description);
    assert.equal(result.criteria[0]?.meets, false);
  }
});

test('owner validation requires all criteria and literal supporting evidence', () => {
  assert.equal(validateLessonCandidate(JSON.stringify({ criteria: [candidate] }), input)[0]?.meets, true);
  for (const value of [ { criteria: [] }, { criteria: [candidate, candidate] },
    { criteria: [{ ...candidate, evidenceQuote: 'invented source' }] },
    { criteria: [{ ...candidate, criterionId: 'foreign' }] },
    { criteria: [{ ...candidate, meets: 'true' }] }, { criteria: [candidate], approved: true } ]) {
    assert.throws(() => validateLessonCandidate(JSON.stringify(value), input));
  }
  assert.equal(validateLessonCandidate(JSON.stringify({ criteria: [{ ...candidate, meets: false, evidenceQuote: '', feedback: 'Add an observation.' }] }), input)[0]?.meets, false);
});

test('evaluation uses the Admin purpose without tools and rejects invalid model output', async () => {
  let calls = 0;
  const evaluator = new GatewayLessonQualityEvaluator({ complete: async (usage: string, request: { tools?: unknown; messages: unknown[] }) => {
    calls++; assert.equal(usage, 'learning.evaluate'); assert.equal(request.tools, undefined); assert.equal(request.messages.length, calls === 1 ? 2 : 4);
    return { providerId: 'isolated', modelId: 'fixture', text: '{"approved":true}' };
  } } as unknown as ModelGateway);
  await assert.rejects(evaluator.evaluate({ ...input, lesson: { title: 'Fixture' } as LessonEvaluationInput['lesson'], kind: 'session_response' }), /学习记录已保存/);
  assert.equal(calls, 2);
});

test('one empty upstream response is retried, while valid negative feedback is returned unchanged', async () => {
  let calls = 0;
  const feedback = { ...candidate, meets: false, evidenceQuote: '', feedback: 'Add an observation.' };
  const evaluator = new GatewayLessonQualityEvaluator({ complete: async () => {
    if (++calls === 1) throw new ModelGatewayError('MODEL_EMPTY_RESPONSE', 'Empty');
    return { providerId: 'isolated', modelId: 'fixture', text: JSON.stringify({ criteria: [feedback] }) };
  } } as unknown as ModelGateway);
  const result = await evaluator.evaluate({ ...input, lesson: { title: 'Fixture' } as LessonEvaluationInput['lesson'], kind: 'session_response' });
  assert.equal(calls, 2); assert.equal(result.criteria[0]?.meets, false);
});

test('repeated empty responses stop after one retry without fabricating an evaluation', async () => {
  let calls = 0;
  const evaluator = new GatewayLessonQualityEvaluator({ complete: async () => {
    calls++; throw new ModelGatewayError('MODEL_EMPTY_RESPONSE', 'Empty');
  } } as unknown as ModelGateway);
  await assert.rejects(evaluator.evaluate({ ...input, lesson: { title: 'Fixture' } as LessonEvaluationInput['lesson'], kind: 'session_response' }));
  assert.equal(calls, 2);
});

test('unsupported quote gets one repair opportunity and never forces acceptance', async () => {
  let calls = 0;
  const evaluator = new GatewayLessonQualityEvaluator({ complete: async () => ({
    providerId: 'isolated', modelId: 'fixture', text: JSON.stringify({ criteria: [++calls === 1
      ? { ...candidate, evidenceQuote: 'invented quotation' }
      : { ...candidate, meets: false, evidenceQuote: '', feedback: 'More evidence is required.' }] }),
  }) } as unknown as ModelGateway);
  const result = await evaluator.evaluate({ ...input, lesson: { title: 'Fixture' } as LessonEvaluationInput['lesson'], kind: 'session_response' });
  assert.equal(calls, 2); assert.equal(result.criteria[0]?.meets, false);
});

test('valid negative evaluation is returned without a repair request', async () => {
  let calls = 0;
  const evaluator = new GatewayLessonQualityEvaluator({ complete: async () => {
    calls++; return { providerId: 'isolated', modelId: 'fixture', text: JSON.stringify({ criteria: [
      { ...candidate, meets: false, evidenceQuote: '', feedback: 'Add an observation.' },
    ] }) };
  } } as unknown as ModelGateway);
  const result = await evaluator.evaluate({ ...input, lesson: { title: 'Fixture' } as LessonEvaluationInput['lesson'], kind: 'session_response' });
  assert.equal(calls, 1); assert.equal(result.criteria[0]?.meets, false);
});
