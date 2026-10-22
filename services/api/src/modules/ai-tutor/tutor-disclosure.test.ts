import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkAnswerLeak } from './tutor.provider';
import { disclosurePrompt, type TutorDisclosure } from './tutor-disclosure';

const pending: TutorDisclosure = { kind: 'pending_assessment', questionId: 'question-instance',
  prompt: '比较两种模型', options: [{ id: 'option-2', label: 'B', body: '私密目标结论' }],
  protectedTexts: ['私密目标结论', '这是仅在提交后展示的解析'] };

test('ordinary explanations, formulas, worked examples and conclusions are allowed at every hint level', () => {
  for (const level of [null, 1, 2, 3, 4, 5] as const) {
    assert.deepEqual(checkAnswerLeak('结论是：反射角等于入射角。示例中入射角为30°，反射角也是30°。', level), { ok: true });
  }
  assert.equal(checkAnswerLeak('必要解释。'.repeat(80), 1).ok, true);
});

test('pending assessment blocks direct choices and private answers while allowing conceptual hints', () => {
  for (const text of ['答案是B', '选B就行。', '选择 B 项', '正确：B', '这里应使用私密目标结论']) {
    const verdict = checkAnswerLeak(text, 5, pending);
    assert.equal(verdict.ok, false, text);
    assert.doesNotMatch(verdict.replacement ?? '', /私密目标结论|提交后展示的解析/);
  }
  assert.equal(checkAnswerLeak('先比较题目给定的条件，再检查你选择的模型是否适用。', 1, pending).ok, true);
  assert.equal(checkAnswerLeak('请先选择一个选项，再说明你的理由。', 1, pending).ok, true);
});

test('model receives only the public question; answer protection ends when the owner clears pending', () => {
  const prompt = disclosurePrompt(pending);
  assert.doesNotMatch(prompt, /提交后展示的解析|protectedTexts/);
  assert.equal(checkAnswerLeak('答案是B，下面分析原因。', 5, { kind: 'instruction' }).ok, true);
});
