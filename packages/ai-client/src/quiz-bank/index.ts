import type { GradeValue, LearningErrorType, TutorReplyBlock } from '@qitu/contracts';

/**
 * 不可变题库（代码级常量，零 I/O）。
 *
 * 硬规则：
 * - `expectedKeys` / `explanation` / `rationaleHint` 是**服务端私密**字段，
 *   只经 {@link toQuizBlockProjection} 下发结构化投影，任何读接口与
 *   `tutor_turns.content` 都不得持久化答案 / 解析；
 * - 题库以 `conceptId`（= 掌握域 `knowledgePointId`）为稳定键，判分时由服务
 *   经 `mastery_objective_mappings`（planId + knowledgePointId）解析本计划的
 *   `objectiveId`（决策 D1）——题库不携带 plan 作用域的 `objectiveId`；
 * - 键比较判分（`canonicalizeSelectedKeys` + `gradeQuizKeys`）放在本模块，
 *   因为 `@qitu/ai-client/src/grading/**` 不是本批次可改动的边界。
 */

/** 服务端私密的题库条目（永不下发原文）。 */
export interface QuizBankEntry {
  /** 不可变题号；与下发块 `block.questionId` 一致。 */
  questionId: string;
  /** 稳定概念 id（= knowledgePointId），用于 conceptDeltas 与映射解析。 */
  conceptId: string;
  stem: string;
  /** F1 只发单选；多选后续批次扩展。 */
  type: 'single';
  options: readonly { key: string; text: string }[];
  /** SERVER-PRIVATE — 正确选项 key 集合；绝不投影、绝不落回合。 */
  expectedKeys: readonly string[];
  /** SERVER-PRIVATE — 解析；只在达标或显式 explain 时释放。 */
  explanation: string;
  /** SERVER-PRIVATE — 答错后的引导（不含答案）。 */
  rationaleHint: string;
  difficulty: 'easy' | 'medium' | 'hard';
}

/** 题库公开投影：字段闭集，结构上不含答案 / 解析 / 判分结果。 */
export type QuizBlockProjection = Extract<TutorReplyBlock, { kind: 'quiz' }>;

/** 光学概念：反射 / 折射 / 透镜（F1 光学 PBL 绑定域）。 */
export const QUIZ_BANK: readonly QuizBankEntry[] = [
  {
    questionId: 'optics.reflection.q1',
    conceptId: 'optics.reflection',
    stem: '光射到镜面上发生反射时，入射角与反射角之间是什么关系？',
    type: 'single',
    options: [
      { key: 'A', text: '入射角大于反射角' },
      { key: 'B', text: '入射角等于反射角' },
      { key: 'C', text: '入射角小于反射角' },
      { key: 'D', text: '两者没有固定关系' },
    ],
    expectedKeys: ['B'],
    explanation: '反射定律：反射光线、入射光线与法线在同一平面内，且入射角等于反射角。',
    rationaleHint: '想一想：光被镜面“弹回”时，它撞上去的倾斜程度和离开时的倾斜程度有什么关系？',
    difficulty: 'easy',
  },
  {
    questionId: 'optics.refraction.q1',
    conceptId: 'optics.refraction',
    stem: '光从空气斜射入水中时，传播方向通常会怎样变化？',
    type: 'single',
    options: [
      { key: 'A', text: '不发生任何变化' },
      { key: 'B', text: '偏向法线方向偏折' },
      { key: 'C', text: '远离法线方向偏折' },
      { key: 'D', text: '沿原路返回' },
    ],
    expectedKeys: ['B'],
    explanation: '光从空气（光疏介质）斜射入水（光密介质）时，折射角小于入射角，光线偏向法线。',
    rationaleHint: '把筷子斜插进水里看起来像“折断”，它靠近水面的一端是往哪个方向偏的？',
    difficulty: 'medium',
  },
  {
    questionId: 'optics.lens.q1',
    conceptId: 'optics.lens',
    stem: '凸透镜对通过它的平行光线有什么作用？',
    type: 'single',
    options: [
      { key: 'A', text: '发散光线' },
      { key: 'B', text: '不改变方向' },
      { key: 'C', text: '会聚到焦点' },
      { key: 'D', text: '让光线沿原路返回' },
    ],
    expectedKeys: ['C'],
    explanation: '凸透镜中间厚、边缘薄，对平行光线起会聚作用，平行于主光轴的光线经折射后会聚于焦点。',
    rationaleHint: '放大镜（凸透镜）能把太阳光聚成一个小亮点，这说明光线被怎样处理了？',
    difficulty: 'medium',
  },
];

/** 按不可变题号查题库条目；不存在返回 null。 */
export function findQuizBankEntry(questionId: string): QuizBankEntry | null {
  return QUIZ_BANK.find((entry) => entry.questionId === questionId) ?? null;
}

/** 按稳定 conceptId（= knowledgePointId）查题库条目；不存在返回 null。 */
export function findQuizBankEntryByConcept(conceptId: string): QuizBankEntry | null {
  return QUIZ_BANK.find((entry) => entry.conceptId === conceptId) ?? null;
}

/**
 * 下发给客户端 / 落回合的题库投影。
 *
 * 逐字段构造：`expectedKeys` / `explanation` / `rationaleHint` / `graded` /
 * `correctKeys` 都无法进入投影。正确选项本就以选项文本出现（否则无法作答），
 * 投影不标注哪个是正确的。
 */
export function toQuizBlockProjection(entry: QuizBankEntry): QuizBlockProjection {
  return {
    kind: 'quiz',
    questionId: entry.questionId,
    stem: entry.stem,
    type: entry.type,
    options: entry.options.map((option) => ({ key: option.key, text: option.text })),
    linkedConceptIds: [entry.conceptId],
  };
}

/**
 * 键比较判分的归一化：trim → 过滤空串 → 去重 → 排序。
 *
 * 键序与重复都不影响语义；调用方在幂等哈希前也应先归一化，保证同一语义
 * 请求的不同序列化不会误判为「同 key 不同载荷」。
 */
export function canonicalizeSelectedKeys(selectedKeys: readonly unknown[]): string[] {
  const seen = new Set<string>();
  // 防御非数组负载（契约保证是 string[]，但服务端不得因畸形体 500）。
  if (!Array.isArray(selectedKeys)) return [];
  for (const value of selectedKeys) {
    if (typeof value !== 'string') continue;
    const key = value.trim();
    if (key.length === 0) continue;
    seen.add(key);
  }
  return [...seen].sort();
}

/** 判分结果的最小结构：正确性 + 错误归类，不含解析（释放由服务层决定）。 */
export interface QuizKeyGrade {
  questionId: string;
  result: Extract<GradeValue, 'correct' | 'incorrect'>;
  isCorrect: boolean;
  /** 0..1，供掌握度引擎使用。 */
  score: number;
  errorType: LearningErrorType | null;
}

/**
 * 单选的键集合判分：归一化 + 去重后，键集合与期望键集合**完全相等**才判对。
 *
 * F1 只发单选，故结果只有 correct / incorrect（无 partial）；多选判分属后续批次。
 * 空期望键（数据错误）永不判对，避免把「无答案」误判成「答对」。
 */
export function gradeQuizKeys(
  entry: Pick<QuizBankEntry, 'questionId' | 'expectedKeys'>,
  selectedKeys: readonly string[],
): QuizKeyGrade {
  const expected = canonicalizeSelectedKeys(entry.expectedKeys);
  const selected = canonicalizeSelectedKeys(selectedKeys);
  if (expected.length === 0) {
    return {
      questionId: entry.questionId,
      result: 'incorrect',
      isCorrect: false,
      score: 0,
      errorType: 'structural',
    };
  }
  const isCorrect = selected.length === expected.length && selected.every((key, index) => key === expected[index]);
  return {
    questionId: entry.questionId,
    result: isCorrect ? 'correct' : 'incorrect',
    isCorrect,
    score: isCorrect ? 1 : 0,
    errorType: isCorrect ? null : selected.length === 0 ? 'metacognitive' : 'deviation',
  };
}
