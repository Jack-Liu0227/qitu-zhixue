import type { QuestionCard } from '../questions/index.js';
import {
  classifyError,
  gradeAnswer,
  GradingError,
  keywordOverlap,
  normalizeAnswer,
  remediationFor,
  similarityRatio,
} from './index.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function card(
  partial: Partial<QuestionCard> & Pick<QuestionCard, 'questionType' | 'expectedAnswer'>,
): QuestionCard {
  return {
    questionId: 'q-1',
    objectiveId: 'obj-1',
    prompt: '题干',
    options: [],
    explanation: '这是解析',
    difficulty: 'easy',
    keywords: [],
    ...partial,
  };
}

/** 判分纯函数断言，由 `pnpm --filter @qitu/ai-client test` 调用。 */
export function runGradingAssertions(): void {
  // 选择题
  const choice = card({
    questionType: 'choice',
    expectedAnswer: '正确答案',
    options: [
      { id: 'opt-0', label: 'A', body: '正确答案' },
      { id: 'opt-1', label: 'B', body: '干扰项一' },
    ],
  });
  assert(gradeAnswer(choice, 'opt-0').result === 'correct', '选项 id 应判对');
  assert(gradeAnswer(choice, 'A').result === 'correct', '选项标签应判对');
  assert(gradeAnswer(choice, ' 正确答案 ').result === 'correct', '选项内容应判对');
  assert(gradeAnswer(choice, 'opt-1').result === 'incorrect', '错误选项应判错');

  // 短答
  const short = card({ questionType: 'short', expectedAnswer: 'abcdefghij' });
  assert(gradeAnswer(short, 'abcdefghij').result === 'correct', '短答精确匹配');
  assert(gradeAnswer(short, 'abcdefghi').result === 'correct', '短答模糊 2*M/T>=0.85');
  const long = card({
    questionType: 'short',
    expectedAnswer: '这是一段超过三十个字符的期望答案用于验证不会进行模糊匹配的逻辑',
  });
  assert(long.expectedAnswer.length > 30, '测试样本应超长');
  assert(gradeAnswer(long, long.expectedAnswer).result === 'correct', '超长精确匹配');
  assert(gradeAnswer(long, long.expectedAnswer.slice(0, -1)).result === 'incorrect', '超长不做模糊');

  // 开放题
  const open = card({ questionType: 'open', expectedAnswer: '水 阳光 二氧化碳' });
  assert(gradeAnswer(open, '需要水和阳光以及二氧化碳').result === 'correct', '关键词全覆盖判对');
  assert(gradeAnswer(open, '阳光').result === 'partial', '关键词部分覆盖判部分');
  assert(gradeAnswer(open, '不知道').result === 'incorrect', '无关键词判错');

  // 工具函数
  assert(similarityRatio('abcd', 'abcd') === 1, '相似度相同为 1');
  assert(similarityRatio('abc', 'xyz') === 0, '相似度不同为 0');
  assert(keywordOverlap('水 阳光 二氧化碳', '水和阳光') === 0.5, '关键词重合 1/2');
  assert(normalizeAnswer('  A，B. ') === 'ab', '归一化去标点压缩空白');

  // 非 correct 必有错误归类与补救
  for (const answer of ['', '不知道', '阳光']) {
    const result = gradeAnswer(open, answer);
    assert(result.result !== 'correct', '样本应非正确');
    assert(result.errorType !== null, '必须给出错误归类');
    assert(result.remediation !== null && result.remediation.length > 0, '必须给出补救建议');
  }
  for (const errorType of ['structural', 'deviation', 'application', 'metacognitive'] as const) {
    assert(remediationFor(errorType).length > 0, `${errorType} 必须有补救建议`);
  }

  // 四类错误可稳定触达
  assert(gradeAnswer(open, '').errorType === 'metacognitive', '空答 → metacognitive');
  assert(gradeAnswer(open, '阳光').errorType === 'application', '部分 → application');
  assert(gradeAnswer(open, '完全无关的回答内容').errorType === 'structural', '严重偏离 → structural');
  const wide = card({ questionType: 'open', expectedAnswer: '水分 阳光 土壤 空气' });
  assert(gradeAnswer(wide, '水分').result === 'incorrect', '命中 1/4 关键词判错');
  assert(classifyError(wide, '水分', 'incorrect') === 'deviation', '方向对但偏 → deviation');

  // 解析只随 GradeResult 释放；非 awaiting 拒绝
  const shortForExplanation = card({ questionType: 'short', expectedAnswer: 'abc' });
  assert(gradeAnswer(shortForExplanation, 'abc').explanation === '这是解析', '解析随结果释放');
  let threw = false;
  try {
    gradeAnswer(shortForExplanation, 'abc', 'answered');
  } catch (error) {
    threw = error instanceof GradingError && error.code === 'QUESTION_NOT_AWAITING';
  }
  assert(threw, '已作答题再次判分应被拒');
}
