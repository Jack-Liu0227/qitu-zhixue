import type {
  KnowledgeType,
  LearningPlanErrorCode,
  NextAction,
  SessionBlockKind,
  SessionMode,
} from '@qitu/contracts';

/**
 * 兴趣 → 4/8 周学习计划（纯函数，零 I/O，不写状态）。
 *
 * 设计基线：`docs/student/learning-plan.md` §1 / §3 / §7，产物契约
 * `.pi/skills/tutor-engine/references/contracts.md` 的 `curriculum-spec.md` 小节。
 *
 * 三条不可协商的硬规则：
 *
 * 1. **两阶段生成，永不一步到位**。第一阶段 `explore` 澄清兴趣与先验知识，
 *    第二阶段 `plan` 产出结构化计划。`planCurriculum` 只接受 `explore` 阶段的
 *    产物（带 brand 的结构）；把兴趣字符串直接喂给计划生成会被拒绝。
 * 2. **模型输出是不可信输入**。`validateCurriculumPlan` 只报错、不修补；
 *    任何一条不满足都由调用方（`plan-api`）拒绝并重试。
 * 3. **理论结构化地门禁实践**。每节课先理论 + 检查，再实践；实践目标的
 *    `prerequisiteIds` 只能指向**同节或更早**课次的理论目标。这是生成期的
 *    构造不变量，不是运行期才检查的开关。
 *
 * 本模块**不**计算掌握度（`mastery/` 负责）、不判分（`grading/` 负责）、
 * 不落库、不发 `TheoryMastered`（服务端负责）。它只接收服务端给出的
 * 「已掌握目标 id」这类投影，决定下一节课排什么。
 */

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/**
 * 冻结的课程模板版本。
 *
 * 计划确认（`confirmCurriculumPlan`）后不可漂移；与
 * `services/api/src/modules/learning-plan/plan-generator.ts` 的
 * `CURRICULUM_TEMPLATE_VERSION` 取值一致（当前双写，plan-api 迁移后可改为
 * 从本模块 re-export）。
 */
export const CURRICULUM_TEMPLATE_VERSION = 'curriculum-plan-v1';

/** 两阶段的 prompt / 模板版本，用于轮次与计划的审计字段。 */
export const CURRICULUM_PROMPT_VERSIONS = {
  explore: 'curriculum-explore-v1',
  plan: 'curriculum-plan-v1',
} as const;

/** `explore` 阶段产物的 brand，`plan` 阶段据此拒绝「未经探索」的计划生成。 */
export const CURRICULUM_EXPLORATION_BRAND = 'curriculum-exploration-v1';

/** 合法的计划周数闭集。 */
export const PLAN_WEEK_OPTIONS = [4, 8] as const;

/** 每周课次密度（对齐迁移 0008 与 mastery 的「1 天 == 1 课次」映射）。 */
export const SESSIONS_PER_WEEK = 5;

/** 每节课固定 1 小时。 */
export const MINUTES_PER_SESSION = 60;

/** 单节课的目标上限。 */
export const MAX_OBJECTIVES_PER_SESSION = 4;

/** 目标措辞上限（一句话能力描述）。 */
export const MAX_OBJECTIVE_LENGTH = 120;

/** 兴趣与目标的长度限制（与 plan-api 的请求校验保持一致）。 */
export const MIN_INTEREST_LENGTH = 1;
export const MAX_INTEREST_LENGTH = 60;
export const MAX_GOAL_LENGTH = 200;

/** intake 画像缺省值（缺字段时降级，不阻塞计划生成）。 */
export const DEFAULT_PRIOR_KNOWLEDGE = '零基础';
export const DEFAULT_TARGET_LEVEL = '入门';
export const DEFAULT_TIME_BUDGET_MINUTES_PER_WEEK = SESSIONS_PER_WEEK * MINUTES_PER_SESSION;

/** 未注入时钟时的固定时间戳：保证「无环境随机、无环境时间」也确定。 */
export const CURRICULUM_EPOCH = '1970-01-01T00:00:00.000Z';

/** 理论与实践两类目标，决定用哪种掌握门槛。 */
export const THEORY_KNOWLEDGE_TYPES: readonly KnowledgeType[] = ['memory', 'concept'];
export const PRACTICE_KNOWLEDGE_TYPES: readonly KnowledgeType[] = ['procedure', 'design'];

/** 能力动词标记：目标措辞必须是「能力」，不是话题清单。 */
export const ABILITY_MARKERS: readonly string[] = [
  '能',
  '会',
  '可以',
  '掌握',
  '完成',
  '实现',
  '做出',
  '写出',
  '解释',
  '说出',
  '复述',
  '说明',
  '设计',
  '运行',
  '调试',
  '拆出',
  '画出',
  '搭出',
  '提交',
  '用',
];

const WEEKLY_THEMES: readonly string[] = [
  '基本概念与运行流程',
  '条件与规则判断',
  '重复与循环',
  '数据结构与集合',
  '输入输出与交互',
  '函数与复用',
  '状态与错误处理',
  '组合、打磨与作品发布',
];

/**
 * 目标措辞模板：**一节课一个维度**（day-1 索引），保证同一周内不同课次的
 * 目标句子互不重复；`rng` 只在「能 / 可以」两个前缀间做等价选择。
 */
const ABILITY_PREFIXES: readonly string[] = ['能', '可以'];

const THEORY_ABILITY_DIMENSIONS: readonly ((interest: string, theme: string) => string)[] = [
  (interest, theme) => `用自己的话说出「${theme}」的核心含义，并指出它在「${interest}」里管什么`,
  (interest, theme) => `举出一个具体例子说明「${theme}」在「${interest}」里的作用`,
  (interest, theme) => `说出「${theme}」的关键规则和适用条件`,
  (interest, theme) => `指出「${theme}」最容易出错的一处，并解释为什么错`,
  (interest, theme) => `说明「${theme}」和前面内容的关系，并预测下一步会发生什么`,
];

const PRACTICE_ABILITY_DIMENSIONS: readonly ((interest: string, theme: string) => string)[] = [
  (interest, theme) => `用「${theme}」完成「${interest}」里的一个小任务，并提交可观察的证据`,
  (interest, theme) => `独立做出「${interest}」中用到「${theme}」的可用成果，并说明做对了什么`,
  (interest, theme) => `调试「${interest}」中与「${theme}」有关的一处错误，并写出修改前后的差别`,
  (interest, theme) => `把「${interest}」中与「${theme}」有关的那段整理成可以重复使用的部分`,
  (interest, theme) => `检查「${interest}」里与「${theme}」有关的结果，并判断它是否符合预期`,
];

/**
 * 生成一句话能力句。
 *
 * 拒绝话题清单：句子必须有可观察的动词（说出 / 完成 / 调试 / 检查…），
 * 且同一周内不同课次落在不同维度上，措辞不重复。
 */
function objectiveForDay(
  dimensions: readonly ((interest: string, theme: string) => string)[],
  interest: string,
  theme: string,
  day: number,
  rng: () => number,
): string {
  const dimension = dimensions[(day - 1) % dimensions.length] ?? dimensions[0];
  if (dimension === undefined) throw new CurriculumPlanError('LEARNING_PLAN_INVALID', '缺少目标措辞模板');
  const prefixIndex = Math.min(ABILITY_PREFIXES.length - 1, Math.floor(rng() * ABILITY_PREFIXES.length));
  return `${ABILITY_PREFIXES[prefixIndex]}${dimension(interest, theme)}`;
}

// ---------------------------------------------------------------------------
// 错误
// ---------------------------------------------------------------------------

/**
 * 计划生成 / 校验 / 确认的错误。
 *
 * `code` 直接复用 `@qitu/contracts` 的 `LearningPlanErrorCode`（只读类型导入），
 * 避免在本模块另造一套错误码；HTTP 层由 `plan-api` 翻译。
 */
export class CurriculumPlanError extends Error {
  readonly errors: readonly CurriculumValidationError[];

  constructor(
    readonly code: LearningPlanErrorCode,
    message: string,
    errors: readonly CurriculumValidationError[] = [],
  ) {
    super(message);
    this.name = 'CurriculumPlanError';
    this.errors = errors;
  }
}

export interface CurriculumValidationError {
  path: string;
  message: string;
}

export interface CurriculumValidationResult {
  ok: boolean;
  errors: readonly CurriculumValidationError[];
}

// ---------------------------------------------------------------------------
// explore 阶段的产物与输入
// ---------------------------------------------------------------------------

/** 学习者 intake 画像（产品文档 4.3）：缺字段即降级，不阻塞。 */
export interface CurriculumIntakeProfile {
  priorKnowledge?: string | null;
  targetLevel?: string | null;
  timeBudgetMinutesPerWeek?: number | null;
  preferences?: readonly string[] | null;
}

/** 降级后的画像：全部字段有值，`degradedFields` 记录哪些用了缺省。 */
export interface CurriculumNormalizedIntakeProfile {
  priorKnowledge: string;
  targetLevel: string;
  timeBudgetMinutesPerWeek: number;
  preferences: readonly string[];
  degradedFields: readonly string[];
}

export interface CurriculumExploreInput {
  interest: string;
  weeks: LearningPlanWeeks;
  goal?: string | null;
  profile?: CurriculumIntakeProfile | null;
  seed?: number;
  /** 注入时钟；省略时用 `deps.now()`，再无则用固定 `CURRICULUM_EPOCH`。 */
  now?: string | Date;
}

/**
 * `explore` 阶段产物。
 *
 * 不是「计划」，而是「已澄清的输入 + 待追问的问题」。带 brand 的结构是
 * `planCurriculum` 的唯一合法输入，用来在结构上阻止「一步到位」。
 */
export interface CurriculumExploration {
  readonly phase: 'explore';
  readonly brand: typeof CURRICULUM_EXPLORATION_BRAND;
  readonly profileVersion: string;
  readonly interest: string;
  readonly weeks: LearningPlanWeeks;
  readonly goal: string;
  readonly goalIsDefaulted: boolean;
  readonly profile: CurriculumNormalizedIntakeProfile;
  /** 探索期推导的兴趣标签；**不得**直接覆盖长期兴趣档案（产品文档 4.3）。 */
  readonly interestTags: readonly string[];
  /** 需要向学生追问的澄清问题（1..3 条，领域无关）。 */
  readonly clarifyingQuestions: readonly string[];
  readonly missingIntakeFields: readonly string[];
  readonly exploredAt: string;
  readonly seed: number;
}

/** `plan` 阶段从 `explore` 阶段继承的证据快照（不可改写）。 */
export interface CurriculumExplorationSnapshot {
  readonly phase: 'explore';
  readonly brand: typeof CURRICULUM_EXPLORATION_BRAND;
  readonly profileVersion: string;
  readonly exploredAt: string;
  readonly seed: number;
  readonly interest: string;
  readonly weeks: LearningPlanWeeks;
  readonly missingIntakeFields: readonly string[];
  readonly clarifyingQuestions: readonly string[];
}

// ---------------------------------------------------------------------------
// 计划形状：Module（周）→ Session（每节 1h）→ Objective（能力目标）
// ---------------------------------------------------------------------------

export interface CurriculumObjective {
  id: string;
  moduleId: string;
  name: string;
  type: KnowledgeType;
  /** 一句话能力描述（不是话题清单）。 */
  objective: string;
  /** 前置目标；只能是同节或更早课次的理论目标。 */
  prerequisiteIds: readonly string[];
  ordinal: number;
}

export interface CurriculumSessionBlock {
  id: string;
  kind: SessionBlockKind;
  minutes: number;
  objectiveIds: readonly string[];
  prerequisiteObjectiveIds: readonly string[];
}

export interface CurriculumSession {
  id: string;
  moduleId: string;
  /** 0 起的全局课次下标：掌握度与复习调度都按它对齐。 */
  index: number;
  week: number;
  day: number;
  title: string;
  mode: SessionMode;
  blocks: readonly CurriculumSessionBlock[];
  /** 本节理论门禁目标：全部达标才由服务端发出 `TheoryMastered`。 */
  theoryObjectiveIds: readonly string[];
  practiceObjectiveIds: readonly string[];
}

export interface CurriculumModule {
  id: string;
  name: string;
  weekIndex: number;
  objective: string;
  ordinal: number;
}

/**
 * 计划草稿：**意图确认之前**的产物。
 *
 * `projectId` 在此阶段恒为 `null`——学生未明确确认意图就不得创建正式项目。
 * `templateVersion` 在确认时冻结，之后不可漂移。
 */
export interface CurriculumPlanDraft {
  readonly phase: 'plan';
  readonly templateVersion: string;
  readonly weeks: LearningPlanWeeks;
  readonly minutesPerSession: typeof MINUTES_PER_SESSION;
  readonly title: string;
  readonly interest: string;
  readonly goal: string;
  readonly projectId: null;
  readonly modules: readonly CurriculumModule[];
  readonly objectives: readonly CurriculumObjective[];
  readonly sessions: readonly CurriculumSession[];
  readonly exploration: CurriculumExplorationSnapshot;
  readonly generatedAt: string;
  readonly seed: number;
}

/** 计划确认后的投影：唯一多出来的就是服务端写入的 `projectId` 与确认时间。 */
export interface CurriculumConfirmedPlan extends Omit<CurriculumPlanDraft, 'projectId'> {
  readonly projectId: string;
  readonly confirmedAt: string;
  readonly templateVersionFrozen: true;
}

/** 已存在的确认记录（由服务端传入，用于幂等重放判定）。 */
export interface CurriculumConfirmationRecord {
  planKey: string;
  projectId: string;
  idempotencyKey: string;
  templateVersion: string;
  confirmedAt: string;
}

export interface CurriculumConfirmationInput {
  plan: CurriculumPlanDraft;
  /** 服务端创建的项目实例 id。 */
  projectId: string;
  /** 服务端写入的意图确认时间（`IntentDraft.confirmedAt`）。 */
  confirmedAt: string | Date;
  /** 必填幂等键。 */
  idempotencyKey: string;
  /** 已存在的确认记录；命中同一幂等键时返回 replay，不产生第二个项目。 */
  existing?: CurriculumConfirmationRecord | null;
  /** 服务端持有的冻结版本；不一致即拒绝。 */
  expectedTemplateVersion?: string | null;
}

export interface CurriculumConfirmationResult {
  plan: CurriculumConfirmedPlan;
  replayed: boolean;
}

export interface CurriculumPlanOptions {
  goal?: string | null;
  seed?: number;
  now?: string | Date;
  templateVersion?: string;
}

export interface CurriculumPlanRequest {
  interest: string;
  weeks: LearningPlanWeeks;
  goal?: string | null;
  profile?: CurriculumIntakeProfile | null;
  seed?: number;
  now?: string | Date;
  templateVersion?: string;
}

export interface CurriculumGenerationResult {
  exploration: CurriculumExploration;
  plan: CurriculumPlanDraft;
}

/** 可注入依赖：时钟与 RNG 必须来自外部，禁止环境随机。 */
export interface CurriculumGenerationDeps {
  now?: () => string | Date;
  rng?: (seed: number) => () => number;
}

// ---------------------------------------------------------------------------
// 确定性工具
// ---------------------------------------------------------------------------

/** FNV-1a 32 位散列：把输入折叠成稳定种子（无环境随机）。 */
export function hashCurriculumSeed(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** mulberry32：同一 seed 必然产生同一序列。 */
export function createDeterministicRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 由（画像 + 兴趣 + 周数 + 目标）派生种子：相同输入永远相同计划。 */
export function deriveCurriculumSeed(input: {
  interest: string;
  weeks: LearningPlanWeeks;
  goal: string;
  profile?: CurriculumIntakeProfile | null;
}): number {
  const preferences = [...(input.profile?.preferences ?? [])].map((item) => String(item)).join(',');
  return hashCurriculumSeed(
    [
      input.interest,
      String(input.weeks),
      input.goal,
      input.profile?.priorKnowledge ?? '',
      input.profile?.targetLevel ?? '',
      String(input.profile?.timeBudgetMinutesPerWeek ?? ''),
      preferences,
    ].join('|'),
  );
}

// ---------------------------------------------------------------------------
// 阶段 1：explore（澄清兴趣与先验知识）
// ---------------------------------------------------------------------------

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeInterest(raw: unknown): string {
  const text = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  if (text.length < MIN_INTEREST_LENGTH || text.length > MAX_INTEREST_LENGTH) {
    throw new CurriculumPlanError(
      'LEARNING_PLAN_INVALID',
      `interest 长度必须在 ${MIN_INTEREST_LENGTH}..${MAX_INTEREST_LENGTH} 之间`,
      [{ path: 'interest', message: 'interest length is invalid' }],
    );
  }
  return text;
}

function assertPlanWeeks(weeks: unknown): asserts weeks is LearningPlanWeeks {
  if (weeks !== 4 && weeks !== 8) {
    throw new CurriculumPlanError('LEARNING_PLAN_INVALID', 'weeks 必须是 4 或 8', [
      { path: 'weeks', message: 'weeks must be 4 or 8' },
    ]);
  }
}

function normalizeGoal(raw: unknown, interest: string, weeks: LearningPlanWeeks): {
  goal: string;
  defaulted: boolean;
} {
  const text = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  if (text.length > MAX_GOAL_LENGTH) {
    throw new CurriculumPlanError('LEARNING_PLAN_INVALID', `goal 不能超过 ${MAX_GOAL_LENGTH} 字`, [
      { path: 'goal', message: 'goal is too long' },
    ]);
  }
  if (text.length === 0) {
    return {
      goal: `用 ${weeks} 周时间掌握「${interest}」的核心知识与实践能力`,
      defaulted: true,
    };
  }
  return { goal: text, defaulted: false };
}

function normalizeProfile(profile: CurriculumIntakeProfile | null | undefined): {
  profile: CurriculumNormalizedIntakeProfile;
  missing: string[];
} {
  const missing: string[] = [];
  const degradedFields: string[] = [];

  const priorKnowledge = isNonEmptyString(profile?.priorKnowledge) ? profile.priorKnowledge.trim() : null;
  if (priorKnowledge === null) {
    missing.push('priorKnowledge');
    degradedFields.push('priorKnowledge');
  }

  const targetLevel = isNonEmptyString(profile?.targetLevel) ? profile.targetLevel.trim() : null;
  if (targetLevel === null) {
    missing.push('targetLevel');
    degradedFields.push('targetLevel');
  }

  const rawBudget = profile?.timeBudgetMinutesPerWeek;
  const budget =
    typeof rawBudget === 'number' && Number.isFinite(rawBudget) && rawBudget > 0
      ? Math.floor(rawBudget)
      : null;
  if (budget === null) {
    missing.push('timeBudgetMinutesPerWeek');
    degradedFields.push('timeBudgetMinutesPerWeek');
  }

  const rawPreferences = profile?.preferences ?? null;
  const preferences = Array.isArray(rawPreferences)
    ? rawPreferences
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
        .slice(0, 5)
    : [];
  if (preferences.length === 0) {
    missing.push('preferences');
    degradedFields.push('preferences');
  }

  return {
    profile: {
      priorKnowledge: priorKnowledge ?? DEFAULT_PRIOR_KNOWLEDGE,
      targetLevel: targetLevel ?? DEFAULT_TARGET_LEVEL,
      timeBudgetMinutesPerWeek: budget ?? DEFAULT_TIME_BUDGET_MINUTES_PER_WEEK,
      preferences,
      degradedFields,
    },
    missing,
  };
}

/** 兴趣标签只在探索期推导；**不**写入长期兴趣档案（产品文档 4.3）。 */
export function deriveInterestTags(interest: string): string[] {
  const parts = interest
    .split(/[\s、,，/和]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const tags = parts.length > 0 ? parts : [interest.trim()];
  return [...new Set(tags)].slice(0, 5);
}

/** 澄清问题：只问当前未知的信息，不重复问已知的。 */
export function buildClarifyingQuestions(interest: string, missing: readonly string[]): string[] {
  const questions: string[] = [];
  if (missing.includes('priorKnowledge')) {
    questions.push(`你以前接触过「${interest}」吗？用过哪些工具或做过什么？`);
  }
  if (missing.includes('targetLevel')) {
    questions.push(`学完这一期，你希望做出什么样的成果？`);
  }
  if (missing.includes('timeBudgetMinutesPerWeek')) {
    questions.push('你每周大概能投入多少时间动手练习？');
  }
  if (questions.length === 0) {
    questions.push(`你更想先做出「${interest}」的哪一个最小可用成果？`);
  }
  return questions.slice(0, 3);
}

function resolveNow(value: string | Date | undefined, deps?: CurriculumGenerationDeps): string {
  const raw = value ?? deps?.now?.();
  if (raw === undefined) return CURRICULUM_EPOCH;
  const date = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new CurriculumPlanError('LEARNING_PLAN_INVALID', '注入的时钟不是合法时间', [
      { path: 'now', message: 'now is not a valid date' },
    ]);
  }
  return date.toISOString();
}

/**
 * 阶段 1：澄清兴趣与先验知识。
 *
 * 只产出「已澄清的输入 + 待追问的问题」，不产出计划。缺失的 intake 字段按
 * 缺省值降级并在 `missingIntakeFields` 里留痕，绝不静默丢弃。
 */
export function exploreCurriculumInterest(
  input: CurriculumExploreInput,
  deps?: CurriculumGenerationDeps,
): CurriculumExploration {
  const interest = normalizeInterest(input.interest);
  assertPlanWeeks(input.weeks);
  const weeks = input.weeks;
  const { goal, defaulted } = normalizeGoal(input.goal, interest, weeks);
  const { profile, missing } = normalizeProfile(input.profile);
  const seed =
    typeof input.seed === 'number' && Number.isFinite(input.seed)
      ? Math.floor(input.seed) >>> 0
      : deriveCurriculumSeed({ interest, weeks, goal, profile: input.profile });

  return {
    phase: 'explore',
    brand: CURRICULUM_EXPLORATION_BRAND,
    profileVersion: CURRICULUM_PROMPT_VERSIONS.explore,
    interest,
    weeks,
    goal,
    goalIsDefaulted: defaulted,
    profile,
    interestTags: deriveInterestTags(interest),
    clarifyingQuestions: buildClarifyingQuestions(interest, missing),
    missingIntakeFields: missing,
    exploredAt: resolveNow(input.now, deps),
    seed,
  };
}

// ---------------------------------------------------------------------------
// 阶段 2：plan（产出结构化计划）
// ---------------------------------------------------------------------------

interface BlockShape {
  review: number;
  theory: number;
  check: number;
  practice: number;
}
/**
 * 60 分钟分块表。
 *
 * - 4 周：1–2 周 10/25/10/15，3–4 周 10/20/10/20；
 * - 8 周：1–5 周 10/20/10/20，6–8 周 10/15/10/25；
 * - 首节课：0/40/20/0（没有到期复习，也不排实践，先立理论门禁）。
 *
 * 复习/理论/检查/实践四段之和恒为 60，且实践占比逐周上升。
 */
export function blockShapeFor(weeks: LearningPlanWeeks, week: number, firstSession: boolean): BlockShape {
  if (firstSession) return { review: 0, theory: 40, check: 20, practice: 0 };
  if (weeks === 8) {
    return week >= 6
      ? { review: 10, theory: 15, check: 10, practice: 25 }
      : { review: 10, theory: 20, check: 10, practice: 20 };
  }
  return week >= 3
    ? { review: 10, theory: 20, check: 10, practice: 20 }
    : { review: 10, theory: 25, check: 10, practice: 15 };
}

/** 周主题：4 周计划把 8 周的两周主题压进同一周（理论深度下降）。 */
export function themeIndexFor(weeks: LearningPlanWeeks, week: number, day: number): number {
  if (weeks === 8) return Math.min(WEEKLY_THEMES.length - 1, week - 1);
  const base = (week - 1) * 2;
  return Math.min(WEEKLY_THEMES.length - 1, base + (day >= 4 ? 1 : 0));
}

function theoryObjectiveId(sessionIndex: number): string {
  return `obj-s${sessionIndex}-t`;
}

function practiceObjectiveId(sessionIndex: number): string {
  return `obj-s${sessionIndex}-p`;
}

function assertExploration(value: unknown): asserts value is CurriculumExploration {
  const candidate = value as Partial<CurriculumExploration> | null;
  if (
    candidate === null ||
    typeof candidate !== 'object' ||
    candidate.phase !== 'explore' ||
    candidate.brand !== CURRICULUM_EXPLORATION_BRAND
  ) {
    throw new CurriculumPlanError(
      'LEARNING_PLAN_TRANSITION_INVALID',
      '计划必须来自 explore 阶段：请先澄清兴趣与先验知识，再生成计划',
      [{ path: 'exploration', message: 'plan requires the explore phase output' }],
    );
  }
}

/**
 * 阶段 2：由 `explore` 产物生成计划。
 *
 * 生成期即保证「理论门禁实践」：第 `s` 节课的实践目标，其 `prerequisiteIds`
 * 指向第 `s-1` 节课的理论目标（只能更早），同节理论再经 `check` 分块门禁。
 * 因此结构上不可能出现「实践排在其理论之前」。
 */
export function planCurriculum(
  exploration: CurriculumExploration,
  options: CurriculumPlanOptions = {},
  deps?: CurriculumGenerationDeps,
): CurriculumPlanDraft {
  assertExploration(exploration);

  const weeks = exploration.weeks;
  assertPlanWeeks(weeks);
  const interest = exploration.interest;
  const { goal } = normalizeGoal(options.goal ?? exploration.goal, interest, weeks);
  const templateVersion = options.templateVersion ?? CURRICULUM_TEMPLATE_VERSION;
  if (!isNonEmptyString(templateVersion)) {
    throw new CurriculumPlanError('LEARNING_PLAN_INVALID', 'templateVersion 不能为空', [
      { path: 'templateVersion', message: 'templateVersion must be a non-empty string' },
    ]);
  }

  const seed =
    typeof options.seed === 'number' && Number.isFinite(options.seed)
      ? Math.floor(options.seed) >>> 0
      : exploration.seed;
  const rng = (deps?.rng ?? createDeterministicRng)(seed);
  const pick = (
    templates: readonly ((interest: string, theme: string) => string)[],
    theme: string,
  ): string => {
    const index = Math.min(templates.length - 1, Math.floor(rng() * templates.length));
    return (templates[index] ?? templates[0]!)(interest, theme);
  };

  const totalSessions = weeks * SESSIONS_PER_WEEK;
  const modules: CurriculumModule[] = [];
  for (let week = 1; week <= weeks; week += 1) {
    const theme = WEEKLY_THEMES[themeIndexFor(weeks, week, 1)] ?? WEEKLY_THEMES[0]!;
    modules.push({
      id: `mod-w${week}`,
      name: `第 ${week} 周 · ${interest}（${theme}）`,
      weekIndex: week,
      objective: `完成第 ${week} 周「${theme}」的理论理解与实践任务`,
      ordinal: week,
    });
  }

  const objectives: CurriculumObjective[] = [];
  const sessions: CurriculumSession[] = [];

  for (let index = 0; index < totalSessions; index += 1) {
    const week = Math.floor(index / SESSIONS_PER_WEEK) + 1;
    const day = (index % SESSIONS_PER_WEEK) + 1;
    const moduleId = `mod-w${week}`;
    const theme = WEEKLY_THEMES[themeIndexFor(weeks, week, day)] ?? WEEKLY_THEMES[0]!;
    const firstSession = index === 0;
    const shape = blockShapeFor(weeks, week, firstSession);
    const previousTheoryId = index > 0 ? theoryObjectiveId(index - 1) : null;

    const theoryType: KnowledgeType = index % 2 === 0 ? 'memory' : 'concept';
    const theoryId = theoryObjectiveId(index);
    objectives.push({
      id: theoryId,
      moduleId,
      name: `${interest} · ${theme} 理论要点`,
      type: theoryType,
      objective: objectiveForDay(THEORY_ABILITY_DIMENSIONS, interest, theme, day, rng),
      prerequisiteIds: previousTheoryId === null ? [] : [previousTheoryId],
      ordinal: objectives.length,
    });

    const blocks: CurriculumSessionBlock[] = [];

    if (shape.review > 0) {
      const reviewObjectiveIds = [
        previousTheoryId,
        index > 1 ? theoryObjectiveId(index - 2) : null,
      ].filter((value): value is string => value !== null);
      blocks.push({
        id: `blk-${index}-review`,
        kind: 'review',
        minutes: shape.review,
        objectiveIds: reviewObjectiveIds,
        prerequisiteObjectiveIds: [],
      });
    }

    blocks.push({
      id: `blk-${index}-theory`,
      kind: 'theory',
      minutes: shape.theory,
      objectiveIds: [theoryId],
      prerequisiteObjectiveIds: previousTheoryId === null ? [] : [previousTheoryId],
    });
    blocks.push({
      id: `blk-${index}-check`,
      kind: 'check',
      minutes: shape.check,
      objectiveIds: [theoryId],
      prerequisiteObjectiveIds: [],
    });

    const practiceObjectiveIds: string[] = [];
    if (!firstSession && shape.practice > 0 && previousTheoryId !== null) {
      const practiceId = practiceObjectiveId(index);
      const practiceType: KnowledgeType = index % 3 === 2 ? 'design' : 'procedure';
      objectives.push({
        id: practiceId,
        moduleId,
        name: `${interest} · ${theme} 实践任务`,
        type: practiceType,
        objective: objectiveForDay(PRACTICE_ABILITY_DIMENSIONS, interest, theme, day, rng),
        prerequisiteIds: [previousTheoryId],
        ordinal: objectives.length,
      });
      practiceObjectiveIds.push(practiceId);
      blocks.push({
        id: `blk-${index}-practice`,
        kind: 'practice',
        minutes: shape.practice,
        objectiveIds: [practiceId],
        prerequisiteObjectiveIds: [previousTheoryId],
      });
    }

    const mode: SessionMode = firstSession ? 'outline' : day === SESSIONS_PER_WEEK ? 'review' : 'study';
    sessions.push({
      id: `sess-${index + 1}`,
      moduleId,
      index,
      week,
      day,
      title: `第 ${week} 周第 ${day} 节：${theme}`,
      mode,
      blocks,
      theoryObjectiveIds: [theoryId],
      practiceObjectiveIds,
    });
  }

  return {
    phase: 'plan',
    templateVersion,
    weeks,
    minutesPerSession: MINUTES_PER_SESSION,
    title: `${interest} · ${weeks} 周学习计划`,
    interest,
    goal,
    projectId: null,
    modules,
    objectives,
    sessions,
    exploration: {
      phase: 'explore',
      brand: CURRICULUM_EXPLORATION_BRAND,
      profileVersion: exploration.profileVersion,
      exploredAt: exploration.exploredAt,
      seed: exploration.seed,
      interest: exploration.interest,
      weeks: exploration.weeks,
      missingIntakeFields: exploration.missingIntakeFields,
      clarifyingQuestions: exploration.clarifyingQuestions,
    },
    generatedAt: resolveNow(options.now, deps),
    seed,
  };
}

/** 一次走完两阶段：`explore → plan`。任何一步失败都抛错，不产物半成品。 */
export function generateCurriculumPlan(
  request: CurriculumPlanRequest,
  deps?: CurriculumGenerationDeps,
): CurriculumGenerationResult {
  const exploration = exploreCurriculumInterest(request, deps);
  const plan = planCurriculum(
    exploration,
    {
      goal: request.goal,
      seed: request.seed,
      now: request.now,
      templateVersion: request.templateVersion,
    },
    deps,
  );
  return { exploration, plan };
}

// ---------------------------------------------------------------------------
// 校验：严格、可枚举、只报错不修补
// ---------------------------------------------------------------------------

/** `memory | concept` 是理论目标；`procedure | design` 是实践目标。 */
export function isTheoryObjective(knowledgeType: KnowledgeType): boolean {
  return knowledgeType === 'memory' || knowledgeType === 'concept';
}

export function isPracticeObjective(knowledgeType: KnowledgeType): boolean {
  return knowledgeType === 'procedure' || knowledgeType === 'design';
}

/** 一节课涉及的全部目标（分块引用 + 理论门禁 + 实践），按出现顺序去重。 */
export function sessionObjectiveIds(session: CurriculumSession): string[] {
  const ids = [
    ...session.blocks.flatMap((block) => [...block.objectiveIds]),
    ...session.theoryObjectiveIds,
    ...session.practiceObjectiveIds,
  ];
  return [...new Set(ids)];
}

/**
 * 目标措辞校验：一句话「能力」，不是话题清单。
 *
 * 拒绝而不是修补：模型给出「变量、循环和函数」这类话题清单时，
 * `plan-api` 必须重新生成，不得替它补动词。
 */
export function validateObjectiveWording(text: string): CurriculumValidationResult {
  const errors: CurriculumValidationError[] = [];
  if (!isNonEmptyString(text)) {
    errors.push({ path: 'objective', message: 'objective must be a non-empty sentence' });
    return { ok: false, errors };
  }
  const trimmed = text.trim();
  if (trimmed.length > MAX_OBJECTIVE_LENGTH) {
    errors.push({
      path: 'objective',
      message: `objective must be at most ${MAX_OBJECTIVE_LENGTH} characters`,
    });
  }
  const endings = trimmed.match(/[。！？!?；;]/g) ?? [];
  const singleSentence = endings.length === 0 || (endings.length === 1 && /[。！？!?；;]$/.test(trimmed));
  if (!singleSentence) {
    errors.push({ path: 'objective', message: 'objective must be a single sentence' });
  }
  if (!ABILITY_MARKERS.some((marker) => trimmed.includes(marker))) {
    errors.push({
      path: 'objective',
      message: 'objective must describe an ability, not a topic list',
    });
  }
  if (/[、，,]$/.test(trimmed) || /等$/.test(trimmed)) {
    errors.push({ path: 'objective', message: 'objective must not be a topic list' });
  }
  return { ok: errors.length === 0, errors };
}

interface PlanIndex {
  objectiveById: Map<string, CurriculumObjective>;
  /** 目标首次出现的课次下标（按 session 顺序扫描）。 */
  objectiveSessionIndex: Map<string, number>;
}

function buildPlanIndex(plan: CurriculumPlanDraft): PlanIndex {
  const objectiveById = new Map<string, CurriculumObjective>();
  for (const objective of plan.objectives) objectiveById.set(objective.id, objective);
  const objectiveSessionIndex = new Map<string, number>();
  for (const session of plan.sessions) {
    for (const objectiveId of sessionObjectiveIds(session)) {
      if (!objectiveSessionIndex.has(objectiveId)) {
        objectiveSessionIndex.set(objectiveId, session.index);
      }
    }
  }
  return { objectiveById, objectiveSessionIndex };
}

function hasPrerequisiteCycle(plan: CurriculumPlanDraft, index: PlanIndex): string | null {
  const edges = new Map<string, string[]>();
  const push = (from: string, to: string): void => {
    const list = edges.get(from);
    if (list === undefined) edges.set(from, [to]);
    else list.push(to);
  };
  for (const objective of plan.objectives) {
    for (const prerequisite of objective.prerequisiteIds) push(objective.id, prerequisite);
  }
  for (const session of plan.sessions) {
    for (const block of session.blocks) {
      for (const prerequisite of block.prerequisiteObjectiveIds) {
        for (const objectiveId of block.objectiveIds) push(objectiveId, prerequisite);
      }
    }
  }

  const state = new Map<string, 0 | 1 | 2>();
  const visit = (id: string): boolean => {
    if (!index.objectiveById.has(id)) return false;
    const status = state.get(id) ?? 0;
    if (status === 1) return true;
    if (status === 2) return false;
    state.set(id, 1);
    for (const next of edges.get(id) ?? []) {
      if (visit(next)) return true;
    }
    state.set(id, 2);
    return false;
  };
  for (const objective of plan.objectives) {
    if (visit(objective.id)) return objective.id;
  }
  return null;
}

function isIsoDate(value: unknown): boolean {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function validatePlanEnvelope(plan: CurriculumPlanDraft, errors: CurriculumValidationError[]): void {
  if (plan.phase !== 'plan') {
    errors.push({ path: 'phase', message: 'plan draft must carry phase=plan' });
  }
  const weeks = plan.weeks as number;
  if (!(PLAN_WEEK_OPTIONS as readonly number[]).includes(weeks)) {
    errors.push({ path: 'weeks', message: 'weeks must be 4 or 8' });
  }
  if (plan.minutesPerSession !== MINUTES_PER_SESSION) {
    errors.push({ path: 'minutesPerSession', message: 'each session must last exactly 60 minutes' });
  }
  if (!isNonEmptyString(plan.templateVersion)) {
    errors.push({ path: 'templateVersion', message: 'templateVersion must be a non-empty string' });
  }
  if (!isNonEmptyString(plan.title)) {
    errors.push({ path: 'title', message: 'title must be a non-empty string' });
  }
  const interest = plan.interest ?? '';
  if (interest.length < MIN_INTEREST_LENGTH || interest.length > MAX_INTEREST_LENGTH) {
    errors.push({
      path: 'interest',
      message: `interest must be ${MIN_INTEREST_LENGTH}..${MAX_INTEREST_LENGTH} characters`,
    });
  }
  if ((plan.goal ?? '').length > MAX_GOAL_LENGTH) {
    errors.push({ path: 'goal', message: `goal must be at most ${MAX_GOAL_LENGTH} characters` });
  }
  if ((plan.projectId as unknown) !== null) {
    errors.push({
      path: 'projectId',
      message: 'draft plan must not carry a projectId before intent confirmation',
    });
  }

  const exploration = plan.exploration;
  if (exploration === null || typeof exploration !== 'object') {
    errors.push({ path: 'exploration', message: 'plan must be produced by the explore phase' });
  } else {
    if (exploration.phase !== 'explore' || exploration.brand !== CURRICULUM_EXPLORATION_BRAND) {
      errors.push({
        path: 'exploration',
        message: 'plan must be produced by the explore phase before planning',
      });
    }
    if (exploration.interest !== plan.interest || exploration.weeks !== plan.weeks) {
      errors.push({
        path: 'exploration',
        message: 'exploration snapshot must match the plan interest and weeks',
      });
    }
    if (!isIsoDate(exploration.exploredAt)) {
      errors.push({ path: 'exploration.exploredAt', message: 'exploredAt must be an ISO timestamp' });
    }
  }
  if (!isIsoDate(plan.generatedAt)) {
    errors.push({ path: 'generatedAt', message: 'generatedAt must be an ISO timestamp' });
  } else if (
    exploration !== null &&
    typeof exploration === 'object' &&
    isIsoDate(exploration.exploredAt) &&
    Date.parse(plan.generatedAt) < Date.parse(exploration.exploredAt)
  ) {
    errors.push({ path: 'generatedAt', message: 'plan cannot be generated before the explore phase' });
  }

  const moduleIds = new Set<string>();
  const weekIndexes = new Set<number>();
  for (const [position, module] of plan.modules.entries()) {
    if (moduleIds.has(module.id)) {
      errors.push({ path: `modules[${position}].id`, message: `duplicate module id ${module.id}` });
    }
    moduleIds.add(module.id);
    if (module.weekIndex < 1 || module.weekIndex > weeks) {
      errors.push({ path: `modules[${position}].weekIndex`, message: 'module week is out of range' });
    }
    if (weekIndexes.has(module.weekIndex)) {
      errors.push({ path: `modules[${position}].weekIndex`, message: 'duplicate module week' });
    }
    weekIndexes.add(module.weekIndex);
    if (module.ordinal <= 0) {
      errors.push({ path: `modules[${position}].ordinal`, message: 'module ordinal must be positive' });
    }
  }
  if (plan.modules.length !== weeks) {
    errors.push({ path: 'modules', message: 'a plan must contain exactly one module per week' });
  }
  if (plan.sessions.length !== weeks * SESSIONS_PER_WEEK) {
    errors.push({
      path: 'sessions',
      message: `a plan must contain exactly ${weeks * SESSIONS_PER_WEEK} sessions (${SESSIONS_PER_WEEK} per week)`,
    });
  }
}

const KNOWLEDGE_TYPES: readonly KnowledgeType[] = ['memory', 'concept', 'procedure', 'design'];
const SESSION_BLOCK_KINDS: readonly SessionBlockKind[] = ['review', 'theory', 'check', 'practice'];

function validatePlanObjectives(
  plan: CurriculumPlanDraft,
  index: PlanIndex,
  errors: CurriculumValidationError[],
): void {
  const seen = new Set<string>();
  const moduleIds = new Set(plan.modules.map((module) => module.id));
  for (const [position, objective] of plan.objectives.entries()) {
    const path = `objectives[${position}]`;
    if (seen.has(objective.id)) {
      errors.push({ path: `${path}.id`, message: `duplicate objective id ${objective.id}` });
    }
    seen.add(objective.id);
    if (!KNOWLEDGE_TYPES.includes(objective.type)) {
      errors.push({ path: `${path}.type`, message: 'objective must carry a valid KnowledgeType' });
    }
    if (!moduleIds.has(objective.moduleId)) {
      errors.push({ path: `${path}.moduleId`, message: `unknown module ${objective.moduleId}` });
    }
    const wording = validateObjectiveWording(objective.objective);
    for (const error of wording.errors) {
      errors.push({ path: `${path}.${error.path}`, message: error.message });
    }
    for (const prerequisite of objective.prerequisiteIds) {
      if (prerequisite === objective.id) {
        errors.push({ path: `${path}.prerequisiteIds`, message: 'objective cannot require itself' });
      } else if (!index.objectiveById.has(prerequisite)) {
        errors.push({
          path: `${path}.prerequisiteIds`,
          message: `unknown prerequisite ${prerequisite}`,
        });
      }
    }
  }
  const cyclic = hasPrerequisiteCycle(plan, index);
  if (cyclic !== null) {
    errors.push({
      path: 'objectives',
      message: `prerequisite graph must be acyclic (cycle through ${cyclic})`,
    });
  }
}

function validatePlanSessions(
  plan: CurriculumPlanDraft,
  index: PlanIndex,
  errors: CurriculumValidationError[],
): void {
  const moduleById = new Map(plan.modules.map((module) => [module.id, module]));
  for (const [position, session] of plan.sessions.entries()) {
    const path = `sessions[${position}]`;
    if (session.index !== position) {
      errors.push({ path: `${path}.index`, message: 'session index must match its plan position' });
    }
    if (session.week < 1 || session.week > (plan.weeks as number)) {
      errors.push({ path: `${path}.week`, message: 'session week is out of range' });
    }
    if (session.day < 1 || session.day > SESSIONS_PER_WEEK) {
      errors.push({ path: `${path}.day`, message: 'session day is out of range' });
    }
    const module = moduleById.get(session.moduleId);
    if (module === undefined) {
      errors.push({ path: `${path}.moduleId`, message: `unknown module ${session.moduleId}` });
    } else if (module.weekIndex !== session.week) {
      errors.push({ path: `${path}.moduleId`, message: 'session week does not match its module' });
    }

    let minutes = 0;
    let lastTheoryOrCheckBlock = -1;
    let firstPracticeBlock = -1;
    for (const [blockPosition, block] of session.blocks.entries()) {
      const blockPath = `${path}.blocks[${blockPosition}]`;
      minutes += block.minutes;
      if (!SESSION_BLOCK_KINDS.includes(block.kind)) {
        errors.push({ path: `${blockPath}.kind`, message: 'unknown session block kind' });
      }
      if (!Number.isInteger(block.minutes) || block.minutes <= 0) {
        errors.push({ path: `${blockPath}.minutes`, message: 'block minutes must be positive integers' });
      }
      if (block.kind === 'theory' || block.kind === 'check') lastTheoryOrCheckBlock = blockPosition;
      if (block.kind === 'practice' && firstPracticeBlock === -1) firstPracticeBlock = blockPosition;
      for (const objectiveId of [...block.objectiveIds, ...block.prerequisiteObjectiveIds]) {
        if (!index.objectiveById.has(objectiveId)) {
          errors.push({ path: blockPath, message: `unknown objective ${objectiveId}` });
        }
      }
      if (block.kind === 'practice' && block.prerequisiteObjectiveIds.length === 0) {
        errors.push({
          path: `${blockPath}.prerequisiteObjectiveIds`,
          message: 'practice blocks need a theory prerequisite',
        });
      }
    }
    if (minutes !== MINUTES_PER_SESSION) {
      errors.push({
        path: `${path}.blocks`,
        message: 'session blocks must total exactly 60 minutes',
      });
    }
    if (firstPracticeBlock !== -1 && firstPracticeBlock < lastTheoryOrCheckBlock) {
      errors.push({
        path: `${path}.blocks`,
        message: 'practice block must be scheduled after theory and check blocks',
      });
    }

    const objectiveIds = sessionObjectiveIds(session);
    if (objectiveIds.length > MAX_OBJECTIVES_PER_SESSION) {
      errors.push({
        path,
        message: `a session may contain at most ${MAX_OBJECTIVES_PER_SESSION} objectives`,
      });
    }
    for (const objectiveId of session.theoryObjectiveIds) {
      const objective = index.objectiveById.get(objectiveId);
      if (objective === undefined) {
        errors.push({ path: `${path}.theoryObjectiveIds`, message: `unknown objective ${objectiveId}` });
      } else if (!isTheoryObjective(objective.type)) {
        errors.push({
          path: `${path}.theoryObjectiveIds`,
          message: `theory objective ${objectiveId} must be memory or concept`,
        });
      }
    }
    for (const objectiveId of session.practiceObjectiveIds) {
      const objective = index.objectiveById.get(objectiveId);
      if (objective === undefined) {
        errors.push({
          path: `${path}.practiceObjectiveIds`,
          message: `unknown objective ${objectiveId}`,
        });
        continue;
      }
      if (!isPracticeObjective(objective.type)) {
        errors.push({
          path: `${path}.practiceObjectiveIds`,
          message: `practice objective ${objectiveId} must be procedure or design`,
        });
      }
      const theoryCandidates = [...session.theoryObjectiveIds, ...objective.prerequisiteIds].filter(
        (candidateId) => {
          const candidate = index.objectiveById.get(candidateId);
          return candidate !== undefined && isTheoryObjective(candidate.type);
        },
      );
      const gated = theoryCandidates.some(
        (candidateId) => (index.objectiveSessionIndex.get(candidateId) ?? Number.POSITIVE_INFINITY) <= session.index,
      );
      if (!gated) {
        errors.push({
          path: `${path}.practiceObjectiveIds`,
          message: `practice objective ${objectiveId} needs a theory objective in the same or an earlier session`,
        });
      }
    }
    if (session.practiceObjectiveIds.length > 0 && session.theoryObjectiveIds.length === 0) {
      errors.push({
        path,
        message: 'a session with practice objectives must declare its theory gate',
      });
    }
  }
}

/**
 * 严格校验计划。模型输出是不可信输入：这里**只报错，不修补**，
 * 调用方（`plan-api`）必须拒绝并重试。
 */
export function validateCurriculumPlan(plan: CurriculumPlanDraft): CurriculumValidationResult {
  const errors: CurriculumValidationError[] = [];
  if (plan === null || typeof plan !== 'object') {
    return { ok: false, errors: [{ path: 'plan', message: 'plan must be an object' }] };
  }
  const index = buildPlanIndex(plan);
  validatePlanEnvelope(plan, errors);
  validatePlanObjectives(plan, index, errors);
  validatePlanSessions(plan, index, errors);
  return { ok: errors.length === 0, errors };
}

/** 校验失败即抛 `CurriculumPlanError`（`LEARNING_PLAN_INVALID`）。 */
export function assertValidCurriculumPlan(plan: CurriculumPlanDraft): void {
  const result = validateCurriculumPlan(plan);
  if (!result.ok) {
    const first = result.errors[0];
    throw new CurriculumPlanError(
      'LEARNING_PLAN_INVALID',
      `学习计划未通过校验：${first?.message ?? 'unknown error'}`,
      result.errors,
    );
  }
}

// ---------------------------------------------------------------------------
// 确定性推进：下一节课排什么
// ---------------------------------------------------------------------------

/**
 * 服务端投影进来的推进状态。
 *
 * 本模块**不**计算掌握度，只消费「已掌握目标 id」；掌握度门槛在 `mastery/`。
 */
export interface CurriculumProgressState {
  masteredObjectiveIds: readonly string[];
  /** 当前有待答题的目标（最高优先级）。 */
  pendingQuestionObjectiveId?: string | null;
  /** 有到期复习的目标。 */
  dueReviewObjectiveId?: string | null;
}

export interface CurriculumNextStep {
  action: NextAction;
  sessionId: string | null;
  sessionIndex: number | null;
  objectiveId: string | null;
  knowledgeType: KnowledgeType | null;
  /** 所选课次的理论目标是否全部达标（服务端 `TheoryMastered` 判定）。 */
  theoryMastered: boolean;
  /** 实践分块是否解锁：恒等于 `theoryMastered`。 */
  practiceUnlocked: boolean;
  reason: string;
}

function sessionTheoryMastered(
  session: CurriculumSession,
  mastered: ReadonlySet<string>,
): boolean {
  if (session.theoryObjectiveIds.length === 0) return false;
  return session.theoryObjectiveIds.every((objectiveId) => mastered.has(objectiveId));
}

function sessionComplete(session: CurriculumSession, mastered: ReadonlySet<string>): boolean {
  return [...session.theoryObjectiveIds, ...session.practiceObjectiveIds].every((objectiveId) =>
    mastered.has(objectiveId),
  );
}

function locateObjective(
  plan: CurriculumPlanDraft,
  objectiveId: string,
): { session: CurriculumSession | null; knowledgeType: KnowledgeType | null } {
  const objective = plan.objectives.find((candidate) => candidate.id === objectiveId) ?? null;
  const session =
    plan.sessions.find((candidate) => sessionObjectiveIds(candidate).includes(objectiveId)) ?? null;
  return { session, knowledgeType: objective?.type ?? null };
}

/**
 * 确定性推进选择。
 *
 * 优先级固定为 `answer_pending → review → 首个未完成课次 → complete`；
 * 同一输入必然得到同一结果（无随机、无时钟）。`practiceUnlocked` 只可能来自
 * 理论门禁，调用方不能通过传入状态绕过它。
 */
export function selectNextCurriculumStep(
  plan: CurriculumPlanDraft,
  progress: CurriculumProgressState,
): CurriculumNextStep {
  const mastered = new Set(progress.masteredObjectiveIds);

  const pending = progress.pendingQuestionObjectiveId ?? null;
  if (pending !== null) {
    const { session, knowledgeType } = locateObjective(plan, pending);
    const gate = session === null ? false : sessionTheoryMastered(session, mastered);
    return {
      action: 'answer_pending',
      sessionId: session?.id ?? null,
      sessionIndex: session?.index ?? null,
      objectiveId: pending,
      knowledgeType,
      theoryMastered: gate,
      practiceUnlocked: gate,
      reason: '有未回答的题目：先完成当前问题，不推进新的目标',
    };
  }

  const dueReview = progress.dueReviewObjectiveId ?? null;
  if (dueReview !== null) {
    const { session, knowledgeType } = locateObjective(plan, dueReview);
    const gate = session === null ? false : sessionTheoryMastered(session, mastered);
    return {
      action: 'review',
      sessionId: session?.id ?? null,
      sessionIndex: session?.index ?? null,
      objectiveId: dueReview,
      knowledgeType,
      theoryMastered: gate,
      practiceUnlocked: gate,
      reason: '有到期的复习目标：先按间隔复习序列巩固，再开新课',
    };
  }

  const session = plan.sessions.find((candidate) => !sessionComplete(candidate, mastered)) ?? null;
  if (session === null) {
    return {
      action: 'complete',
      sessionId: null,
      sessionIndex: null,
      objectiveId: null,
      knowledgeType: null,
      theoryMastered: false,
      practiceUnlocked: false,
      reason: '计划内全部目标已掌握，且没有到期复习',
    };
  }

  const gate = sessionTheoryMastered(session, mastered);
  const nextTheory = session.theoryObjectiveIds.find((objectiveId) => !mastered.has(objectiveId));
  if (nextTheory !== undefined) {
    const knowledgeType =
      plan.objectives.find((objective) => objective.id === nextTheory)?.type ?? null;
    const action: NextAction =
      knowledgeType === 'concept' || knowledgeType === 'design' ? 'assess' : 'probe';
    return {
      action,
      sessionId: session.id,
      sessionIndex: session.index,
      objectiveId: nextTheory,
      knowledgeType,
      theoryMastered: false,
      practiceUnlocked: false,
      reason:
        action === 'assess'
          ? '本节理论目标属于 concept/design：先用「讲给我听」做质化检查'
          : '本节理论目标尚未达标：先探测与讲解，实践分块保持锁定',
    };
  }

  const nextPractice = session.practiceObjectiveIds.find((objectiveId) => !mastered.has(objectiveId));
  return {
    action: 'practice',
    sessionId: session.id,
    sessionIndex: session.index,
    objectiveId: nextPractice ?? null,
    knowledgeType:
      nextPractice === undefined
        ? null
        : plan.objectives.find((objective) => objective.id === nextPractice)?.type ?? null,
    theoryMastered: gate,
    practiceUnlocked: gate,
    reason: '本节理论目标全部达标：解锁实践分块',
  };
}

// ---------------------------------------------------------------------------
// 模板版本冻结与意图确认
// ---------------------------------------------------------------------------

/**
 * 计划的去重键：`(interest, weeks, templateVersion)`。
 *
 * 服务端再叠加 `studentId` 组成本产品的去重键（对齐 `GenerateLearningPlanResponse`
 * 的 `deduplicated` 语义）。
 */
export function curriculumPlanKey(plan: Pick<CurriculumPlanDraft, 'interest' | 'weeks' | 'templateVersion'>): string {
  return `${plan.interest}|${plan.weeks}|${plan.templateVersion}`;
}

/** 冻结校验：已冻结的版本不允许漂移。 */
export function assertTemplateVersionFrozen(
  plan: { templateVersion: string },
  expectedTemplateVersion: string,
): void {
  if (plan.templateVersion !== expectedTemplateVersion) {
    throw new CurriculumPlanError(
      'LEARNING_PLAN_VERSION_MISMATCH',
      `模板版本不允许漂移：计划为 ${plan.templateVersion}，服务端持有 ${expectedTemplateVersion}`,
      [{ path: 'templateVersion', message: 'templateVersion drifted' }],
    );
  }
}

function confirmedPlanFrom(
  plan: CurriculumPlanDraft,
  projectId: string,
  confirmedAt: string,
): CurriculumConfirmedPlan {
  return {
    ...plan,
    projectId,
    confirmedAt,
    templateVersionFrozen: true,
  };
}

/**
 * 意图确认 → 冻结模板版本。
 *
 * 硬规则：
 * - 学生未确认意图就不得有正式项目：`plan.projectId` 必须是 `null`；
 * - 确认时间不得早于 `explore` 阶段（不能先建项目再补意图）；
 * - 同一幂等键重放返回首次结果（`replayed: true`），不产生第二个项目；
 * - 幂等键被换 payload 复用即拒绝（`LEARNING_PLAN_TRANSITION_INVALID`）。
 *
 * 本函数是纯函数：读取既有确认记录、返回新值，**不落库**。
 */
export function confirmCurriculumPlan(
  input: CurriculumConfirmationInput,
): CurriculumConfirmationResult {
  assertValidCurriculumPlan(input.plan);

  if (!isNonEmptyString(input.projectId)) {
    throw new CurriculumPlanError('LEARNING_PLAN_INVALID', 'projectId 不能为空', [
      { path: 'projectId', message: 'projectId must be a non-empty string' },
    ]);
  }
  if (!isNonEmptyString(input.idempotencyKey)) {
    throw new CurriculumPlanError('LEARNING_PLAN_INVALID', '幂等键必填', [
      { path: 'idempotencyKey', message: 'idempotencyKey must be a non-empty string' },
    ]);
  }
  const confirmedAt = input.confirmedAt instanceof Date ? input.confirmedAt.toISOString() : input.confirmedAt;
  if (!isIsoDate(confirmedAt)) {
    throw new CurriculumPlanError('LEARNING_PLAN_INVALID', 'confirmedAt 必须是合法时间', [
      { path: 'confirmedAt', message: 'confirmedAt must be an ISO timestamp' },
    ]);
  }
  if (
    isIsoDate(input.plan.exploration.exploredAt) &&
    Date.parse(confirmedAt) < Date.parse(input.plan.exploration.exploredAt)
  ) {
    throw new CurriculumPlanError(
      'LEARNING_PLAN_TRANSITION_INVALID',
      '意图确认不能早于探索阶段：请先完成兴趣澄清再创建项目',
      [{ path: 'confirmedAt', message: 'confirmation cannot precede the explore phase' }],
    );
  }

  const expected = input.expectedTemplateVersion ?? null;
  if (expected !== null) assertTemplateVersionFrozen(input.plan, expected);

  const planKey = curriculumPlanKey(input.plan);
  const existing = input.existing ?? null;
  if (existing !== null) {
    if (existing.idempotencyKey !== input.idempotencyKey) {
      throw new CurriculumPlanError(
        'LEARNING_PLAN_TRANSITION_INVALID',
        '计划已确认，不能再确认第二次',
        [{ path: 'planId', message: 'plan is already confirmed' }],
      );
    }
    if (existing.planKey !== planKey || existing.projectId !== input.projectId) {
      throw new CurriculumPlanError(
        'LEARNING_PLAN_TRANSITION_INVALID',
        '同一幂等键不能用于不同的确认内容',
        [{ path: 'idempotencyKey', message: 'idempotency key reused with a different payload' }],
      );
    }
    assertTemplateVersionFrozen(input.plan, existing.templateVersion);
    return {
      plan: confirmedPlanFrom(input.plan, existing.projectId, existing.confirmedAt),
      replayed: true,
    };
  }

  return {
    plan: confirmedPlanFrom(input.plan, input.projectId, confirmedAt),
    replayed: false,
  };
}

// ---------------------------------------------------------------------------
// 兼容层：plan-api 当前消费的旧版草稿形状
// ---------------------------------------------------------------------------

export type LearningPlanWeeks = 4 | 8;

export interface LearningPlanBlock {
  id: string;
  title: string;
  minutes: number;
  objectiveIds: readonly string[];
  activity: 'explore' | 'learn' | 'practice' | 'reflect' | 'review';
  prerequisiteObjectiveIds: readonly string[];
}

export interface LearningPlanSession {
  id: string;
  week: number;
  day: number;
  title: string;
  blocks: readonly LearningPlanBlock[];
}

export interface LearningPlanDraft {
  templateVersion: string;
  weeks: LearningPlanWeeks;
  title: string;
  interest: string;
  sessions: readonly LearningPlanSession[];
}

export interface LearningPlanValidationError {
  path: string;
  message: string;
}

export interface LearningPlanValidationResult {
  ok: boolean;
  errors: readonly LearningPlanValidationError[];
}

/** 旧版 `SessionBlockKind` → `activity` 投影，plan-api 的 `blockKind()` 的逆映射。 */
function activityForBlockKind(kind: SessionBlockKind): LearningPlanBlock['activity'] {
  switch (kind) {
    case 'review':
      return 'review';
    case 'theory':
      return 'learn';
    case 'check':
      return 'reflect';
    case 'practice':
      return 'practice';
    default:
      return 'learn';
  }
}

/**
 * 把新形状投影成旧版校验器认识的草稿。
 *
 * 生成器刻意让实践的 `prerequisiteIds` 只指向**更早**课次的理论目标，因此
 * 新形状同时通过 `validateCurriculumPlan` 与 `validateLearningPlanDraft`。
 */
export function toLegacyLearningPlanDraft(plan: CurriculumPlanDraft): LearningPlanDraft {
  return {
    templateVersion: plan.templateVersion,
    weeks: plan.weeks,
    title: plan.title,
    interest: plan.interest,
    sessions: plan.sessions.map((session) => ({
      id: session.id,
      week: session.week,
      day: session.day,
      title: session.title,
      blocks: session.blocks.map((block) => ({
        id: block.id,
        title: block.kind,
        minutes: block.minutes,
        objectiveIds: [...block.objectiveIds],
        activity: activityForBlockKind(block.kind),
        prerequisiteObjectiveIds: [...block.prerequisiteObjectiveIds],
      })),
    })),
  };
}

/**
 * 校验旧版计划草稿（plan-api 仍在消费）。
 *
 * 语义：实践分块必须引用**本节之前**已出现在计划里的理论目标；只报错、不修补。
 * 新代码请使用 `validateCurriculumPlan`。
 */
export function validateLearningPlanDraft(draft: LearningPlanDraft): LearningPlanValidationResult {
  const errors: LearningPlanValidationError[] = [];
  if (draft.weeks !== 4 && draft.weeks !== 8) {
    errors.push({ path: 'weeks', message: 'weeks must be 4 or 8' });
  }
  if (draft.sessions.length !== draft.weeks * 5) {
    errors.push({ path: 'sessions', message: 'each plan must contain five learning sessions per week' });
  }

  const objectiveIds = new Set<string>();
  const completed = new Set<string>();
  for (const [sessionIndex, session] of draft.sessions.entries()) {
    if (session.week < 1 || session.week > draft.weeks) {
      errors.push({ path: `sessions[${sessionIndex}].week`, message: 'session week is outside the plan range' });
    }
    const minutes = session.blocks.reduce((sum, block) => sum + block.minutes, 0);
    if (minutes !== 60) {
      errors.push({ path: `sessions[${sessionIndex}].blocks`, message: 'session blocks must total exactly 60 minutes' });
    }
    const sessionObjectives = new Set<string>();
    for (const [blockIndex, block] of session.blocks.entries()) {
      if (block.minutes <= 0) {
        errors.push({ path: `sessions[${sessionIndex}].blocks[${blockIndex}].minutes`, message: 'block minutes must be positive' });
      }
      for (const objectiveId of block.objectiveIds) {
        objectiveIds.add(objectiveId);
        sessionObjectives.add(objectiveId);
      }
      for (const prerequisite of block.prerequisiteObjectiveIds) {
        if (!completed.has(prerequisite)) {
          errors.push({
            path: `sessions[${sessionIndex}].blocks[${blockIndex}].prerequisiteObjectiveIds`,
            message: `prerequisite ${prerequisite} is not mastered before this session`,
          });
        }
      }
      if (block.activity === 'practice' && block.prerequisiteObjectiveIds.length === 0) {
        errors.push({
          path: `sessions[${sessionIndex}].blocks[${blockIndex}].prerequisiteObjectiveIds`,
          message: 'practice blocks need a theory prerequisite',
        });
      }
    }
    if (sessionObjectives.size > 4) {
      errors.push({ path: `sessions[${sessionIndex}]`, message: 'a session may contain at most four objectives' });
    }
    for (const objectiveId of sessionObjectives) completed.add(objectiveId);
  }

  if (objectiveIds.size === 0) {
    errors.push({ path: 'sessions', message: 'a plan must contain at least one objective' });
  }
  return { ok: errors.length === 0, errors };
}
