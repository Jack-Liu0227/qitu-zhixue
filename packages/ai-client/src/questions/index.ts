import type { KnowledgeType, QuestionKind } from '@qitu/contracts';

/**
 * 题库与题面边界（纯函数，零 I/O）。
 *
 * 硬规则：`QuestionCard` 是**服务端专属**结构，持有 `expectedAnswer` 与
 * `explanation`；任何下发客户端的响应只能经过 `toPublicQuestion` 的结构化投影，
 * 该投影**逐字段构造**，因此不可能夹带答案 / 解析 / 关键词。
 *
 * 对应 DeepTutor 的 `learning/question_card.py:build_question_card` 与
 * `learning/pending.py:public_pending_question`：题面接口绝不下发答案，
 * 判分结束后才由 `grading` 释放解析。
 */

export type { QuestionKind };

export type QuestionDifficulty = 'easy' | 'medium' | 'hard';

export interface QuestionOption {
  id: string;
  label: string;
  body: string;
}

/** 服务端题面，含答案与解析，**绝不下发**。 */
export interface QuestionCard {
  questionId: string;
  objectiveId: string;
  prompt: string;
  questionType: QuestionKind;
  expectedAnswer: string;
  options: readonly QuestionOption[];
  explanation: string;
  difficulty: QuestionDifficulty;
  /** 开放题关键词；仅服务端判分使用。 */
  keywords: readonly string[];
}

/** 下发给客户端的题面投影；字段闭集，结构上不含答案。 */
export interface PublicQuestion {
  questionId: string;
  prompt: string;
  questionType: QuestionKind;
  options: QuestionOption[];
  allowFreeText: true;
  attempt: number;
}

/** 生成题面所需的最小目标输入。 */
export interface QuestionObjectiveInput {
  id: string;
  name: string;
  type: KnowledgeType;
}

export interface BuildQuestionInput {
  objective: QuestionObjectiveInput;
  /** 同一目标内的题序，用于区分题干、避免重复。 */
  index: number;
  /** 确定性种子；相同输入必须得到相同题面。 */
  seed?: string;
}

const QUESTION_KINDS: readonly QuestionKind[] = ['choice', 'short', 'open'];

export function isQuestionKind(value: unknown): value is QuestionKind {
  return typeof value === 'string' && (QUESTION_KINDS as readonly string[]).includes(value);
}

/**
 * 结构化投影：显式挑选字段，**不**做展开 / `delete`。
 *
 * 这样即使 `QuestionCard` 将来新增字段（如 `answerHint`），也无法意外泄漏。
 * `attempt` 由调用方从服务端 pending 状态给出。
 */
export function toPublicQuestion(card: QuestionCard, attempt = 1): PublicQuestion {
  return {
    questionId: card.questionId,
    prompt: card.prompt,
    questionType: card.questionType,
    options: card.options.map((option) => ({
      id: option.id,
      label: option.label,
      body: option.body,
    })),
    allowFreeText: true,
    attempt: Math.max(1, Math.floor(attempt)),
  };
}

/**
 * 断言投影不含答案。
 *
 * 选择题的正确答案本就以选项内容出现（否则无法作答），因此这里校验的是：
 * - 投影字段是**闭集**（不可能混入 `expectedAnswer` / `explanation` / `keywords`）；
 * - 解析与关键词不出现；
 * - 没有任何选项携带「这是正确答案」的标注。
 *
 * 非选择题的答案字符串另由 `assertNoAnswerTextLeak` 校验。
 */
export function assertNoAnswerLeak(publicQuestion: PublicQuestion, card: QuestionCard): void {
  const allowedKeys = new Set([
    'questionId',
    'prompt',
    'questionType',
    'options',
    'allowFreeText',
    'attempt',
  ]);
  for (const key of Object.keys(publicQuestion)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`题面投影出现非白名单字段：${key}`);
    }
  }
  const serialized = JSON.stringify(publicQuestion);
  if (card.explanation.trim().length >= 2 && serialized.includes(card.explanation)) {
    throw new Error('题面投影泄漏了解析');
  }
  for (const keyword of card.keywords) {
    if (keyword.trim().length >= 2 && serialized.includes(keyword)) {
      throw new Error(`题面投影泄漏了关键词：${keyword}`);
    }
  }
  for (const option of publicQuestion.options) {
    if ('correct' in option || 'isAnswer' in option) {
      throw new Error('选项不得标注正确答案');
    }
  }
}

/** 非选择题的答案文本不得出现在投影里。 */
export function assertNoAnswerTextLeak(publicQuestion: PublicQuestion, card: QuestionCard): void {
  if (card.questionType === 'choice') return;
  const serialized = JSON.stringify(publicQuestion);
  if (card.expectedAnswer.trim().length >= 2 && serialized.includes(card.expectedAnswer)) {
    throw new Error('题面投影泄漏了答案文本');
  }
}

/** 稳定哈希，仅用于生成确定性的题目 id / 干扰项。 */
function stableHash(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** 等长干扰项：与正确答案长度对齐，避免用长度暴露答案。 */
export function buildMatchedDistractors(correct: string, count = 3, seed = ''): string[] {
  const length = Math.max(1, correct.length);
  const base = stableHash(`${seed}:${correct}`);
  const distractors = new Set<string>();
  let cursor = 0;
  while (distractors.size < count && cursor < count * 8) {
    const candidate = mutate(correct, base + cursor);
    const trimmed = candidate.slice(0, length);
    if (trimmed !== correct && trimmed.length === length) distractors.add(trimmed);
    cursor += 1;
  }
  // 极端情况下补足：用稳定的同长占位符，仍然不含答案。
  let filler = 0;
  while (distractors.size < count) {
    const placeholder = '·'.repeat(length);
    distractors.add(filler % 2 === 0 ? placeholder : `${placeholder}${filler}`.slice(0, length));
    filler += 1;
  }
  return [...distractors];
}

function mutate(value: string, seed: number): string {
  const alphabet = '的一是在不了有和人这中大为上个国我以要他时来用们';
  const chars = [...value];
  if (chars.length === 0) return alphabet[seed % alphabet.length]!;
  const position = seed % chars.length;
  const replacement = alphabet[(seed + chars.length) % alphabet.length]!;
  chars[position] = chars[position] === replacement ? alphabet[(seed + 1) % alphabet.length]! : replacement;
  return chars.join('');
}

/**
 * 难度模板生成：同一目标内每题题干唯一，且难度在 easy/medium/hard 间轮转。
 *
 * 这里刻意只做**确定性模板**：真实模型输出必须走校验器，模板只保证结构合法、
 * 题干不重复。`type` 决定题型，`index` 决定难度与题干措辞。
 */
export function buildQuestion(input: BuildQuestionInput): QuestionCard {
  const { objective, index } = input;
  const seed = input.seed ?? objective.id;
  const questionType = questionKindForType(objective.type, index);
  const difficulty = difficultyFor(index);
  const questionId = `q-${objective.id}-${index}`;
  const prompt = promptFor(objective, index, questionType);
  const expectedAnswer = expectedAnswerFor(objective, index);
  const options = buildOptions(questionType, expectedAnswer, seed, index);
  return {
    questionId,
    objectiveId: objective.id,
    prompt,
    questionType,
    expectedAnswer,
    options,
    explanation: explanationFor(objective, expectedAnswer),
    difficulty,
    keywords: questionType === 'open' ? keywordList(expectedAnswer) : [],
  };
}

function questionKindForType(type: KnowledgeType, index: number): QuestionKind {
  if (type === 'memory') return index % 2 === 0 ? 'choice' : 'short';
  if (type === 'procedure') return index % 3 === 0 ? 'choice' : 'short';
  return 'open';
}

function difficultyFor(index: number): QuestionDifficulty {
  const order: QuestionDifficulty[] = ['easy', 'medium', 'hard'];
  return order[index % order.length]!;
}

function promptFor(
  objective: QuestionObjectiveInput,
  index: number,
  questionType: QuestionKind,
): string {
  const ordinal = ['第一', '第二', '第三', '第四', '第五', '第六'][index % 6] ?? `${index + 1}`;
  if (questionType === 'choice') {
    return `关于「${objective.name}」，${ordinal}题：下面哪一项的说法正确？`;
  }
  if (questionType === 'short') {
    return `请用一句话说明「${objective.name}」（${ordinal}题）。`;
  }
  return `请结合自己的话讲清「${objective.name}」为什么重要（${ordinal}题）。`;
}

function expectedAnswerFor(objective: QuestionObjectiveInput, index: number): string {
  return `${objective.name}的关键点${index + 1}`;
}

function buildOptions(
  questionType: QuestionKind,
  correct: string,
  seed: string,
  index: number,
): QuestionOption[] {
  if (questionType !== 'choice') return [];
  const distractors = buildMatchedDistractors(correct, 3, `${seed}:${index}`);
  const bodies = [correct, ...distractors];
  return bodies.map((body, optionIndex) => ({
    id: `opt-${optionIndex}`,
    label: String.fromCharCode(65 + optionIndex),
    body,
  }));
}

function explanationFor(objective: QuestionObjectiveInput, expectedAnswer: string): string {
  return `「${objective.name}」的要点是：${expectedAnswer}。`;
}

function keywordList(expectedAnswer: string): string[] {
  return expectedAnswer
    .split(/[\s,，。；;：:、]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
}
