import {
  assertNoAnswerLeak,
  assertNoAnswerTextLeak,
  buildMatchedDistractors,
  buildQuestion,
  isQuestionKind,
  toPublicQuestion,
} from './index.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** 题库题面边界断言，由 `pnpm --filter @qitu/ai-client test` 调用。 */
export function runQuestionAssertions(): void {
  const card = buildQuestion({
    objective: { id: 'obj-1', name: '光合作用', type: 'memory' },
    index: 0,
  });
  const publicQuestion = toPublicQuestion(card, 2);

  assert(
    JSON.stringify(Object.keys(publicQuestion).sort()) ===
      JSON.stringify(['allowFreeText', 'attempt', 'options', 'prompt', 'questionId', 'questionType']),
    '题面投影字段必须是闭集',
  );
  assert(publicQuestion.attempt === 2, 'attempt 应透传');
  assert(!('expectedAnswer' in publicQuestion), '投影不得含 expectedAnswer');
  assert(!('explanation' in publicQuestion), '投影不得含 explanation');
  assertNoAnswerLeak(publicQuestion, card);
  const serialized = JSON.stringify(publicQuestion);
  assert(!serialized.includes(card.explanation), '序列化后不得含解析');

  // 非选择题：答案文本也不得出现在投影中
  const openCard = buildQuestion({
    objective: { id: 'obj-open', name: '牛顿第一定律', type: 'concept' },
    index: 0,
  });
  const openPublic = toPublicQuestion(openCard, 1);
  assertNoAnswerLeak(openPublic, openCard);
  assertNoAnswerTextLeak(openPublic, openCard);
  assert(!JSON.stringify(openPublic).includes(openCard.expectedAnswer), '非选择题不得泄漏答案文本');

  // 等长干扰项
  const correct = '光合作用的关键点1';
  const distractors = buildMatchedDistractors(correct, 3, 'seed');
  assert(distractors.length === 3, '应产出三个干扰项');
  assert(new Set(distractors).size === 3, '干扰项互不重复');
  for (const distractor of distractors) {
    assert(distractor.length === correct.length, '干扰项必须与正确答案等长');
    assert(distractor !== correct, '干扰项不得等于答案');
  }

  // 确定性 + 题干唯一
  const a = buildQuestion({ objective: { id: 'obj-2', name: '牛顿第一定律', type: 'concept' }, index: 1 });
  const b = buildQuestion({ objective: { id: 'obj-2', name: '牛顿第一定律', type: 'concept' }, index: 1 });
  const c = buildQuestion({ objective: { id: 'obj-2', name: '牛顿第一定律', type: 'concept' }, index: 2 });
  assert(JSON.stringify(a) === JSON.stringify(b), '同输入必须确定性复现');
  assert(a.prompt !== c.prompt, '不同 index 题干应变化');
  assert(a.questionType === 'open', 'concept 目标应为开放题');

  // 题型闭集
  assert(isQuestionKind('choice') && isQuestionKind('short') && isQuestionKind('open'), '合法题型');
  assert(!isQuestionKind('essay') && !isQuestionKind(42), '非法题型应被拒');
}
