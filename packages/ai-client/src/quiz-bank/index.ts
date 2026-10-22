import type { GradeValue, LearningErrorType, TutorReplyBlock } from '@qitu/contracts';

export * from './optics/index.js';

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
  /** SERVER-PRIVATE — 迷思标签（stable key），与迷思库对齐；仅服务端归因用，不下发。 */
  misconceptionTag?: string;
  /** SERVER-PRIVATE — 迷思库错误类型短码；仅审计 / 卡点归因用，不下发。 */
  errorTypeCode?: string;
}

/** 题库公开投影：字段闭集，结构上不含答案 / 解析 / 判分结果。 */
export type QuizBlockProjection = Extract<TutorReplyBlock, { kind: 'quiz' }>;

/** 光学概念题库：反射 / 折射 / 全反射 / 透镜（F5 光学 PBL 绑定域）。 */
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
    explanation:
      '凸透镜中间厚、边缘薄，对平行光线起会聚作用，平行于主光轴的光线经折射后会聚于焦点。',
    rationaleHint: '放大镜（凸透镜）能把太阳光聚成一个小亮点，这说明光线被怎样处理了？',
    difficulty: 'medium',
  },
  /* ============================ F5 光学 PBL 扩展（服务端私密） ============================ */
  {
    questionId: 'optics.reflection.q2',
    conceptId: 'optics.reflection.law',
    stem: '在反射现象中，入射角和反射角是相对哪条参考线测量的？',
    type: 'single',
    options: [
      { key: 'A', text: '镜面' },
      { key: 'B', text: '法线' },
      { key: 'C', text: '入射光线' },
      { key: 'D', text: '反射光线' },
    ],
    expectedKeys: ['B'],
    explanation: '入射角与反射角都以法线（垂直于镜面的线）为基准测量，而不是相对镜面。',
    rationaleHint: '如果镜子斜着放，法线会指向哪？角应该是相对哪条“垂直的线”量出来的？',
    difficulty: 'easy',
    misconceptionTag: 'optics.reflection.normal_baseline',
    errorTypeCode: 'reflection.normal_baseline',
  },
  {
    questionId: 'optics.reflection.q3',
    conceptId: 'optics.reflection.law',
    stem: '让一束光沿原来反射光的方向射向镜面，它反射后会沿什么方向射出？',
    type: 'single',
    options: [
      { key: 'A', text: '沿原来入射光的方向射出' },
      { key: 'B', text: '沿一个新的随机方向射出' },
      { key: 'C', text: '不再反射' },
      { key: 'D', text: '沿法线方向射出' },
    ],
    expectedKeys: ['A'],
    explanation: '反射光路可逆：让光沿反射光方向射入，它会沿原入射光方向反向射出。',
    rationaleHint: '你从镜子里能看见对方时，对方能看见你吗？光在反射中会不会“记得”来时的路？',
    difficulty: 'easy',
    misconceptionTag: 'optics.reflection.reversibility',
    errorTypeCode: 'reflection.reversibility',
  },
  {
    questionId: 'optics.refraction.q2',
    conceptId: 'optics.refraction.law',
    stem: '光从水中斜射入空气时，折射光线相对法线会怎样偏折？',
    type: 'single',
    options: [
      { key: 'A', text: '偏向法线' },
      { key: 'B', text: '远离法线' },
      { key: 'C', text: '沿法线方向射出' },
      { key: 'D', text: '不发生偏折' },
    ],
    expectedKeys: ['B'],
    explanation: '光从水（光密介质）斜射入空气（光疏介质）时，折射角大于入射角，光线远离法线。',
    rationaleHint: '光从光密斜射向光疏，是“偏向”还是“远离”法线？把上一道题的方向反过来想。',
    difficulty: 'medium',
    misconceptionTag: 'optics.refraction.bend_direction',
    errorTypeCode: 'refraction.bend_direction',
  },
  {
    questionId: 'optics.refraction.q3',
    conceptId: 'optics.refraction.law',
    stem: '某介质的折射率 n = 2，光在该介质中的传播速度是真空光速 c 的多少？',
    type: 'single',
    options: [
      { key: 'A', text: 'c/2' },
      { key: 'B', text: '2c' },
      { key: 'C', text: 'c' },
      { key: 'D', text: '与折射率无关，无法判断' },
    ],
    expectedKeys: ['A'],
    explanation: '折射率定义 n = c/v，所以 v = c/n = c/2；折射率越大，光速越慢。',
    rationaleHint: '由 n = c/v 反推 v：n = 2 时，v 是 c 的一半还是 c 的两倍？',
    difficulty: 'medium',
    misconceptionTag: 'optics.refraction.index_velocity',
    errorTypeCode: 'refraction.index_velocity',
  },
  {
    questionId: 'optics.tir.q1',
    conceptId: 'optics.tir.critical_angle',
    stem: '关于发生全反射的条件，下列说法正确的是？',
    type: 'single',
    options: [
      { key: 'A', text: '只要从光密介质射向光疏介质，就必然发生全反射' },
      { key: 'B', text: '从光密介质射向光疏介质，且入射角大于等于临界角' },
      { key: 'C', text: '只要入射角足够大，任何界面都能发生全反射' },
      { key: 'D', text: '从光疏介质射向光密介质，且入射角大于临界角' },
    ],
    expectedKeys: ['B'],
    explanation:
      '全反射需同时满足两个条件：光从光密射向光疏，且入射角大于等于临界角；只满足“光密到光疏”不够。',
    rationaleHint: '“光密到光疏”和“入射角够大”两个条件，少了哪一个全反射都不会发生？',
    difficulty: 'medium',
    misconceptionTag: 'optics.tir.critical_angle_missing',
    errorTypeCode: 'tir.critical_angle_missing',
  },
  {
    questionId: 'optics.tir.q2',
    conceptId: 'optics.tir.critical_angle',
    stem: '光从折射率 n = 1.5 的玻璃射向空气时，临界角 C 满足什么关系？',
    type: 'single',
    options: [
      { key: 'A', text: 'sinC = 1/1.5' },
      { key: 'B', text: 'sinC = 1.5' },
      { key: 'C', text: 'sinC = 1/2' },
      { key: 'D', text: 'sinC = 1' },
    ],
    expectedKeys: ['A'],
    explanation: '临界角满足 sinC = n₂/n₁（n₂ 为光疏介质折射率），对空气 n₂=1，故 sinC = 1/1.5。',
    rationaleHint: 'sinC = n₂/n₁，n₁ 是玻璃的 1.5、n₂ 是空气的 1；代进去 sinC 会大于 1 吗？',
    difficulty: 'hard',
    misconceptionTag: 'optics.tir.critical_angle_formula',
    errorTypeCode: 'tir.critical_angle_formula',
  },
  {
    questionId: 'optics.lens.q2',
    conceptId: 'optics.lens.ray_rules',
    stem: '一条光线通过凸透镜的光心，经过透镜后它的传播方向会怎样？',
    type: 'single',
    options: [
      { key: 'A', text: '方向不变' },
      { key: 'B', text: '偏折向焦点' },
      { key: 'C', text: '平行于主光轴射出' },
      { key: 'D', text: '沿原路返回' },
    ],
    expectedKeys: ['A'],
    explanation: '过光心的光线经薄透镜后传播方向不变——这是三条特殊光线之一。',
    rationaleHint: '三条特殊光线里，“过光心”的那条在薄透镜里会被“折”一下吗？',
    difficulty: 'easy',
    misconceptionTag: 'optics.lens.optical_center',
    errorTypeCode: 'lens.optical_center',
  },
  {
    questionId: 'optics.lens.q3',
    conceptId: 'optics.lens.ray_rules',
    stem: '凹透镜的焦点位于透镜的哪一侧，属于什么焦点？',
    type: 'single',
    options: [
      { key: 'A', text: '入射侧的虚焦点' },
      { key: 'B', text: '出射侧的实焦点' },
      { key: 'C', text: '出射侧的虚焦点' },
      { key: 'D', text: '入射侧的实焦点' },
    ],
    expectedKeys: ['A'],
    explanation:
      '凹透镜发散光线，其焦点是入射侧（与凸透镜相反）的虚焦点，由折射光线的反向延长线会聚得到。',
    rationaleHint: '凹透镜把光线向外“推开”，这些发散的线往入射方向反向延长会聚在哪一侧？',
    difficulty: 'medium',
    misconceptionTag: 'optics.lens.virtual_focus',
    errorTypeCode: 'lens.virtual_focus',
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
  const isCorrect =
    selected.length === expected.length && selected.every((key, index) => key === expected[index]);
  return {
    questionId: entry.questionId,
    result: isCorrect ? 'correct' : 'incorrect',
    isCorrect,
    score: isCorrect ? 1 : 0,
    errorType: isCorrect ? null : selected.length === 0 ? 'metacognitive' : 'deviation',
  };
}

export { OPTICS_16_COMPLETION_PROFILE_ID, OPTICS_16_COMPLETION_TEMPLATE_SPEC } from './optics/curriculum.js';
export { OPTICS_GUIDED_PROFILE_ID, OPTICS_GUIDED_TEMPLATE_SPEC, OPTICS_GUIDED_ROLE_REQUIREMENTS } from './optics/guided-curriculum.js';
