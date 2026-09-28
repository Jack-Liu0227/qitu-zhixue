import type { GradeValue, LearningErrorType } from '@qitu/contracts';
import type { QuestionCard } from '../questions/index.js';

/**
 * 确定性判分（纯函数，零 I/O）。
 *
 * 对齐 DeepTutor `learning/grading.py`：
 * - 选择：精确匹配（去空格）；
 * - 短答：精确，或当期望答案 ≤30 字符时相似度 `2*M/T >= 0.85`；
 * - 开放：关键词重合 `>= 0.6`。
 *
 * 判分只在服务端进行；`explanation` 只随 `GradeResult` 释放，题面接口永不携带。
 * 任何错误归类都必须附带一条 remedial（补救）建议。
 */

/** 短答参与模糊匹配的期望答案长度上限。 */
export const SHORT_ANSWER_MAX_LENGTH = 30;
/** 短答相似度阈值。 */
export const SHORT_SIMILARITY_THRESHOLD = 0.85;
/** 短答部分正确的相似度下界。 */
export const SHORT_PARTIAL_THRESHOLD = 0.6;
/** 开放题关键词重合阈值。 */
export const OPEN_KEYWORD_OVERLAP_THRESHOLD = 0.6;
/** 开放题部分正确的关键词重合下界。 */
export const OPEN_PARTIAL_THRESHOLD = 0.3;

export type QuestionState = 'awaiting' | 'answered';

export class GradingError extends Error {
  constructor(
    readonly code: 'QUESTION_NOT_AWAITING',
    message: string,
  ) {
    super(message);
    this.name = 'GradingError';
  }
}

/** 拒绝给非 AWAITING 的题判分（防重复作答 / 越权重判）。 */
export function assertAwaiting(state: QuestionState): void {
  if (state !== 'awaiting') {
    throw new GradingError('QUESTION_NOT_AWAITING', '该题已作答或不在等待作答状态，拒绝重复判分');
  }
}

export interface GradeResult {
  questionId: string;
  result: GradeValue;
  isCorrect: boolean;
  /** 0..1。 */
  score: number;
  /** 仅在此结构内释放解析。 */
  explanation: string;
  errorType: LearningErrorType | null;
  remediation: string | null;
}

/** 归一化：小写、去首尾空白、压缩内部空白、去掉常见标点。 */
export function normalizeAnswer(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s\u3000]+/g, ' ')
    .replace(/[。．.，,；;：:！!？?、"'“”‘’（）()【】\[\]]/g, '')
    .trim();
}

/** 最长公共子序列长度（LCS）。 */
function longestCommonSubsequence(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const previous = new Array<number>(b.length + 1).fill(0);
  const current = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      current[j] =
        a[i - 1] === b[j - 1]
          ? (previous[j - 1] ?? 0) + 1
          : Math.max(previous[j] ?? 0, current[j - 1] ?? 0);
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j] ?? 0;
  }
  return current[b.length] ?? 0;
}

/** `2*M/T` 相似度，等价于 Python `difflib.SequenceMatcher.ratio()`。 */
export function similarityRatio(left: string, right: string): number {
  const a = [...normalizeAnswer(left)];
  const b = [...normalizeAnswer(right)];
  const total = a.length + b.length;
  if (total === 0) return 1;
  const match = longestCommonSubsequence(a, b);
  return (2 * match) / total;
}

/** 开放题关键词列表：按常见分隔符切分，保留长度 ≥2 的词。 */
export function extractKeywords(expectedAnswer: string): string[] {
  return [...new Set(
    expectedAnswer
      .split(/[\s,，。；;：:、/|]+/)
      .map((part) => normalizeAnswer(part))
      .filter((part) => part.length >= 2),
  )];
}

/** 开放题关键词重合比例。期望答案无关键词时退化为相似度。 */
export function keywordOverlap(expectedAnswer: string, answer: string): number {
  const keywords = extractKeywords(expectedAnswer);
  if (keywords.length === 0) return similarityRatio(expectedAnswer, answer);
  const normalized = normalizeAnswer(answer);
  const hit = keywords.filter((keyword) => normalized.includes(keyword)).length;
  return hit / keywords.length;
}

/** 错误归类：空答 → metacognitive；严重偏离 → structural；部分 → application；其余 → deviation。 */
export function classifyError(
  card: QuestionCard,
  answer: string,
  result: GradeValue,
): LearningErrorType | null {
  if (result === 'correct') return null;
  const normalized = normalizeAnswer(answer);
  if (normalized.length === 0) return 'metacognitive';
  const overlap = keywordOverlap(card.expectedAnswer, answer);
  const similarity = similarityRatio(card.expectedAnswer, answer);
  if (result === 'partial') return 'application';
  if (overlap < 0.2 && similarity < 0.3) return 'structural';
  return 'deviation';
}

/** 每个错误类型都必须给出一条补救建议。 */
export function remediationFor(errorType: LearningErrorType): string {
  switch (errorType) {
    case 'structural':
      return '先回到「这题在问哪个知识点」，用一句话复述目标，再重新作答。';
    case 'deviation':
      return '你抓住了方向但偏了重点，对照目标里最关键的词，把答案收窄。';
    case 'application':
      return '你已经理解大意，补上缺失的一步，把它完整说清楚。';
    case 'metacognitive':
      return '先写出你现在确定的部分，哪怕只有一个词，也比空着更容易推进。';
    default:
      return '回顾这一节的理论要点后再试一次。';
  }
}

function gradeChoice(card: QuestionCard, answer: string): GradeValue {
  const normalized = normalizeAnswer(answer);
  const correctIndex = card.options.findIndex(
    (option) => normalizeAnswer(option.body) === normalizeAnswer(card.expectedAnswer),
  );
  const correctOption = correctIndex >= 0 ? card.options[correctIndex] : undefined;
  if (correctOption === undefined) return 'incorrect';
  if (
    normalized === normalizeAnswer(correctOption.id) ||
    normalized === normalizeAnswer(correctOption.label) ||
    normalized === normalizeAnswer(correctOption.body)
  ) {
    return 'correct';
  }
  return 'incorrect';
}

function gradeShort(card: QuestionCard, answer: string): GradeValue {
  if (normalizeAnswer(answer) === normalizeAnswer(card.expectedAnswer)) return 'correct';
  if (card.expectedAnswer.length > SHORT_ANSWER_MAX_LENGTH) return 'incorrect';
  const ratio = similarityRatio(card.expectedAnswer, answer);
  if (ratio >= SHORT_SIMILARITY_THRESHOLD) return 'correct';
  if (ratio >= SHORT_PARTIAL_THRESHOLD) return 'partial';
  return 'incorrect';
}

function gradeOpen(card: QuestionCard, answer: string): GradeValue {
  const overlap = keywordOverlap(card.expectedAnswer, answer);
  if (overlap >= OPEN_KEYWORD_OVERLAP_THRESHOLD) return 'correct';
  if (overlap >= OPEN_PARTIAL_THRESHOLD) return 'partial';
  return 'incorrect';
}

/**
 * 判分入口。
 *
 * @param state 题面状态；默认 `'awaiting'`，非 awaiting 直接抛出（拒绝重判）。
 */
export function gradeAnswer(
  card: QuestionCard,
  answer: string,
  state: QuestionState = 'awaiting',
): GradeResult {
  assertAwaiting(state);
  const trimmed = typeof answer === 'string' ? answer : '';
  let result: GradeValue;
  if (card.questionType === 'choice') result = gradeChoice(card, trimmed);
  else if (card.questionType === 'short') result = gradeShort(card, trimmed);
  else result = gradeOpen(card, trimmed);

  const score = result === 'correct' ? 1 : result === 'partial' ? 0.5 : 0;
  const errorType = classifyError(card, trimmed, result);
  return {
    questionId: card.questionId,
    result,
    isCorrect: result === 'correct',
    score,
    explanation: card.explanation,
    errorType,
    remediation: errorType === null ? null : remediationFor(errorType),
  };
}
