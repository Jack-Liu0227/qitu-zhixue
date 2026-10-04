import type { ProjectSummary } from './project';

/**
 * 4/8 周学习计划与掌握度契约。
 *
 * 服务端 owns 全部状态：计划结构、`templateVersion` 冻结、掌握度、`TheoryMastered`
 * 与阶段推进。本文件里的请求体刻意只保留学生真正能表达的内容（兴趣、周数、作答、
 * 证据引用），**没有任何** `stage` / `mastery` / `theoryMastered` / `projectId` 字段；
 * 客户端塞入这些字段不会生效，服务端按白名单拒绝。
 *
 * 形状对齐 `docs/student/learning-plan.md` §3，并与迁移 0008 的
 * `learning_plans` / `learning_modules` / `learning_objectives` / `learning_sessions`
 * / `mastery_records` / `mastery_attempts` 一一对应。
 */

/** 计划生命周期。只由服务端状态迁移，客户端不可写。 */
export type LearningPlanStatus = 'draft' | 'active' | 'completed' | 'archived';

/** 计划周数，只允许 4 或 8。 */
export type LearningPlanWeeks = 4 | 8;

/** 四类目标，决定用哪种掌握门槛。 */
export type KnowledgeType = 'memory' | 'concept' | 'procedure' | 'design';

/** 单个目标的掌握状态。 */
export type ObjectiveStatus = 'new' | 'learning' | 'mastered';

/** 会话模式（对齐 DT 的 outline / study / review）。 */
export type SessionMode = 'outline' | 'study' | 'review';

/** 题型闭集。 */
export type QuestionKind = 'choice' | 'short' | 'open';

/** 60 分钟课的四个分块。 */
export type SessionBlockKind = 'review' | 'theory' | 'check' | 'practice';

/** 计划块的旧版活动枚举（复用 `packages/ai-client` 的 curriculum 校验器）。 */
export type LearningPlanBlockActivity = 'explore' | 'learn' | 'practice' | 'reflect' | 'review';

/** 判分结果。 */
export type GradeValue = 'correct' | 'incorrect' | 'partial';

/** 错误归类四分法。 */
export type LearningErrorType = 'structural' | 'deviation' | 'application' | 'metacognitive';

/** 推进动作优先级（`answer_pending → review → probe → practice/assess → complete`）。 */
export type NextAction =
  | 'answer_pending'
  | 'review'
  | 'probe'
  | 'practice'
  | 'assess'
  | 'complete';

/**
 * 本模块的稳定错误码。
 *
 * 刻意**不**并入 `ApiErrorCode`（那是跨模块冻结的联合，新增需要单独评审）；
 * 学习计划模块用自己的联合，HTTP 层直接把这些字符串放进 problem details。
 */
export type LearningPlanErrorCode =
  | 'LEARNING_PLAN_NOT_FOUND'
  | 'LEARNING_PLAN_FORBIDDEN'
  | 'LEARNING_PLAN_TRANSITION_INVALID'
  | 'LEARNING_PLAN_INVALID'
  | 'LEARNING_PLAN_VERSION_MISMATCH'
  | 'LEARNING_SESSION_NOT_FOUND'
  | 'THEORY_MASTERED_REQUIRED'
  | 'QUESTION_NOT_AWAITING'
  | 'EVIDENCE_INVALID'
  | 'LEARNING_PLAN_UNAVAILABLE';

/** 每节 60 分钟的分块。服务端校验合计 = `minutesPerSession`。 */
export interface SessionBlock {
  kind: SessionBlockKind;
  minutes: number;
}

/** 目标投影（不含前置的循环图内部结构之外的服务端字段）。 */
export interface LearningObjectiveView {
  id: string;
  moduleId: string;
  name: string;
  type: KnowledgeType;
  objective: string;
  prerequisiteIds: string[];
  ordinal: number;
}

/** 模块（周）投影。 */
export interface LessonModuleView {
  id: string;
  name: string;
  weekIndex: number;
  objective: string;
  ordinal: number;
  objectives: LearningObjectiveView[];
}

/** 单节课投影。`theoryMastered` / `practiceUnlocked` 是服务端计算，不是客户端输入。 */
export interface LessonSessionView {
  id: string;
  moduleId: string;
  index: number;
  week: number;
  day: number;
  title: string;
  blocks: SessionBlock[];
  theoryObjectiveIds: string[];
  practiceObjectiveIds: string[];
  mode: SessionMode;
  theoryMastered: boolean;
  practiceUnlocked: boolean;
}

/** 计划完整投影。`projectId` 在确认前恒为 `null`。 */
export interface LearningPlanView {
  id: string;
  studentUserId: string;
  projectId: string | null;
  interest: string;
  goal: string;
  weeks: LearningPlanWeeks;
  minutesPerSession: number;
  templateVersion: string;
  status: LearningPlanStatus;
  version: number;
  modules: LessonModuleView[];
  sessions: LessonSessionView[];
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 生成计划。模型输出不可信，服务端校验通过才会落库为草稿。 */
export interface GenerateLearningPlanRequest {
  interest: string;
  weeks: LearningPlanWeeks;
  goal?: string | null;
}

export interface GenerateLearningPlanResponse {
  plan: LearningPlanView;
  /** 同一 `(studentId, interest, weeks, templateVersion)` 命中既有草稿时为 true。 */
  deduplicated: boolean;
}

/** 确认意图 → 唯一创建正式项目。幂等键必填。 */
export interface ConfirmLearningPlanResponse {
  plan: LearningPlanView;
  project: ProjectSummary;
  replayed: boolean;
}

/** 某个目标的掌握度摘要。 */
export interface MasterySummary {
  objectiveId: string;
  knowledgeType: KnowledgeType;
  status: ObjectiveStatus;
  /** 0..1 的近期加权掌握度。 */
  mastery: number;
  threshold: number;
  qualitativeMastered: boolean;
}

/** 下发给学生端的题面投影：结构上不可能包含答案或解析。 */
export interface PublicQuestion {
  questionId: string;
  prompt: string;
  questionType: QuestionKind;
  options: Array<{ id: string; label: string; body: string }>;
  allowFreeText: true;
  attempt: number;
}

/** 服务端计算的下一步。 */
export interface NextStepView {
  action: NextAction;
  objectiveId: string | null;
  knowledgeType: KnowledgeType | null;
  status: ObjectiveStatus | null;
  gate: 'qualitative' | 'quantitative' | null;
  mastery: number;
  threshold: number;
  reason: string;
  theoryMastered: boolean;
  practiceUnlocked: boolean;
  question: PublicQuestion | null;
}

export interface StartSessionResponse {
  session: LessonSessionView;
  nextStep: NextStepView;
}

/** 作答请求：只有题 id 与答案字符串，**没有**任何掌握度 / 阶段字段。 */
export interface SubmitAnswerRequest {
  questionId: string;
  answer: string;
}

export interface SubmitAnswerResponse {
  questionId: string;
  result: GradeValue;
  isCorrect: boolean;
  score: number;
  /** 仅在判分完成后释放。 */
  explanation: string;
  errorType: LearningErrorType | null;
  remediation: string | null;
  mastery: MasterySummary | null;
  theoryMastered: boolean;
  practiceUnlocked: boolean;
  replayed: boolean;
}

/** 实践证据请求：引用 + 可选摘要，服务端校验目标类型与理论门槛。 */
export interface SubmitEvidenceRequest {
  objectiveId: string;
  evidenceRef: string;
  summary?: string | null;
}

export interface SubmitEvidenceResponse {
  objectiveId: string;
  accepted: boolean;
  theoryMastered: boolean;
  practiceUnlocked: boolean;
  replayed: boolean;
}
