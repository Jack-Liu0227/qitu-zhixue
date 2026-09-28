import { randomUUID } from 'node:crypto';
import type {
  GradeValue,
  KnowledgeType,
  LearningErrorType,
  LearningPlanStatus,
  ObjectiveStatus,
  ProjectStage,
  SessionBlock,
  SessionMode,
} from '@qitu/contracts';
import type { QuestionDifficulty, QuestionKind } from '@qitu/ai-client';

/**
 * 学习计划的持久化边界。
 *
 * 服务层只依赖这个抽象；`demo` / `test` 用内存实现，`live` 用 PostgreSQL 实现
 * （见 `learning-plan.store.postgres.ts`）。掌握度公式、`TheoryMastered` 判定、
 * 阶段门禁全部留在服务层与 `@qitu/ai-client` 的纯函数里，存储层只负责读写。
 *
 * 表映射（迁移 0008）：`learning_plans` / `learning_modules` / `learning_objectives`
 * / `learning_sessions` / `mastery_records` / `mastery_attempts`。
 */

export interface PlanRecord {
  id: string;
  studentUserId: string;
  projectId: string | null;
  interest: string;
  goal: string;
  weeks: 4 | 8;
  minutesPerSession: number;
  templateVersion: string;
  status: LearningPlanStatus;
  version: number;
  idempotencyKey: string;
  confirmedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ModuleRecord {
  id: string;
  planId: string;
  name: string;
  weekIndex: number;
  objective: string;
  ordinal: number;
}

export interface ObjectiveRecord {
  id: string;
  planId: string;
  moduleId: string;
  name: string;
  type: KnowledgeType;
  objective: string;
  prerequisiteIds: string[];
  ordinal: number;
}

export interface SessionRecord {
  id: string;
  planId: string;
  moduleId: string;
  index: number;
  blocks: SessionBlock[];
  theoryObjectiveIds: string[];
  practiceObjectiveIds: string[];
  mode: SessionMode;
}

export interface MasteryRecord {
  id: string;
  studentUserId: string;
  planId: string | null;
  objectiveId: string;
  knowledgeType: KnowledgeType;
  status: ObjectiveStatus;
  masteryBasisPoints: number;
  thresholdBasisPoints: number;
  qualitativeMastered: boolean;
  consecutiveCorrect: number;
  consecutiveWrong: number;
  intervalIndex: number;
  nextReviewAt: Date | null;
  reviewCount: number;
  lapseCount: number;
  updatedAt: Date;
}

export interface AttemptRecord {
  id: string;
  studentUserId: string;
  planId: string | null;
  objectiveId: string;
  questionId: string | null;
  result: GradeValue;
  isCorrect: boolean;
  assessmentType: 'quiz' | 'qualitative' | 'review';
  errorType: LearningErrorType | null;
  hintsUsed: number;
  attemptCount: number;
  qualityBasisPoints: number | null;
  userAnswer: string | null;
  createdAt: Date;
}

/**
 * 跨轮持久的未答题（迁移 0009 `pending_questions`）。
 *
 * `expectedAnswer` / `explanation` 是**服务端私密**字段：只经 `toPublicQuestion`
 * 结构化投影下发，任何读接口都不会返回整条记录。
 */
export interface PendingQuestionRecord {
  id: string;
  schoolId: string | null;
  studentUserId: string;
  planId: string;
  sessionId: string;
  objectiveId: string;
  questionType: QuestionKind;
  prompt: string;
  options: Array<{ id: string; label: string; body: string }>;
  expectedAnswer: string;
  explanation: string;
  difficulty: QuestionDifficulty | null;
  assessmentType: 'quiz' | 'qualitative' | 'review';
  status: 'awaiting' | 'answered' | 'expired' | 'cancelled';
  attempt: number;
  hintsUsed: number;
  idempotencyKey: string;
  askedAt: Date;
  answeredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface LearningProjectRecord {
  id: string;
  studentId: string;
  templateVersionId: string | null;
  status: ProjectStage;
  currentStageIndex: number;
  stageTotal: number;
  progressPercent: number;
  title: string;
  subtitle: string | null;
  tags: string[];
  createdAt: Date;
  completedAt: Date | null;
}

export interface CompletePendingQuestionInput {
  questionId: string;
  answeredAt: Date;
  attempt: AttemptRecord;
  mastery: MasteryRecord;
}

export interface PlanBundle {
  plan: PlanRecord;
  modules: ModuleRecord[];
  objectives: ObjectiveRecord[];
  sessions: SessionRecord[];
}

export interface ConfirmPlanInput {
  planId: string;
  /** 待创建项目；`createdAt` / `completedAt` 由存储层补齐。 */
  project: Omit<LearningProjectRecord, 'createdAt' | 'completedAt' | 'studentId'> & { studentId: string };
  now: Date;
}

export interface ConfirmPlanResult {
  plan: PlanRecord;
  project: LearningProjectRecord;
  /** false 表示计划此前已有项目，属于幂等重放。 */
  created: boolean;
}

/** 同一 `(student, interest, weeks, templateVersion)` 已存在计划时抛出。 */
export class LearningPlanStoreConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LearningPlanStoreConflictError';
  }
}

/** 同一路径已存在未答题（迁移 0009 的部分唯一索引）时抛出。 */
export class PendingQuestionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PendingQuestionConflictError';
  }
}

export abstract class LearningPlanStore {
  abstract findPlanBySignature(
    studentUserId: string,
    interest: string,
    weeks: 4 | 8,
    templateVersion: string,
  ): Promise<PlanBundle | null>;

  abstract createPlan(bundle: PlanBundle): Promise<void>;

  abstract findPlan(planId: string): Promise<PlanRecord | null>;

  abstract findBundle(planId: string): Promise<PlanBundle | null>;

  abstract listPlansByStudent(studentUserId: string): Promise<PlanRecord[]>;

  /** 条件认领 + 建项目，保证一个计划只创建一个项目（并发安全）。 */
  abstract confirmPlan(input: ConfirmPlanInput): Promise<ConfirmPlanResult>;

  abstract findProject(projectId: string): Promise<LearningProjectRecord | null>;

  abstract findSession(planId: string, sessionId: string): Promise<SessionRecord | null>;

  abstract listSessions(planId: string): Promise<SessionRecord[]>;

  abstract findMastery(studentUserId: string, objectiveId: string): Promise<MasteryRecord | null>;

  abstract listMasteryForPlan(studentUserId: string, planId: string): Promise<MasteryRecord[]>;

  abstract upsertMastery(record: MasteryRecord): Promise<void>;

  abstract listAttempts(studentUserId: string, objectiveId: string): Promise<AttemptRecord[]>;

  abstract appendAttempt(attempt: AttemptRecord): Promise<void>;

  /* -------- 迁移 0009：pending_questions -------- */

  /** 同一 `(student, plan)` 至多一道 `awaiting`（DB 部分唯一索引兜底）。 */
  abstract findAwaitingQuestion(
    studentUserId: string,
    planId: string,
  ): Promise<PendingQuestionRecord | null>;

  abstract findPendingQuestion(questionId: string): Promise<PendingQuestionRecord | null>;

  abstract createPendingQuestion(record: PendingQuestionRecord): Promise<void>;

  /** Atomically claim the awaiting question and persist its attempt + mastery result. */
  abstract completePendingQuestion(input: CompletePendingQuestionInput): Promise<boolean>;

  /** `awaiting → answered` 的条件迁移；保留给兼容调用方。 */
  abstract markPendingQuestionAnswered(questionId: string, answeredAt: Date): Promise<boolean>;
}

/* ------------------------------------------------------------------ *
 * 内存实现（demo / test）。语义与 Postgres 实现保持一致。
 * ------------------------------------------------------------------ */

function masteryKey(studentUserId: string, objectiveId: string): string {
  return `${studentUserId}::${objectiveId}`;
}

function attemptKey(studentUserId: string, objectiveId: string): string {
  return `${studentUserId}::${objectiveId}`;
}

export class InMemoryLearningPlanStore extends LearningPlanStore {
  private readonly plans = new Map<string, PlanBundle>();
  private readonly projects = new Map<string, LearningProjectRecord>();
  private readonly mastery = new Map<string, MasteryRecord>();
  private readonly attempts = new Map<string, AttemptRecord[]>();
  private readonly pending = new Map<string, PendingQuestionRecord>();

  async findPlanBySignature(
    studentUserId: string,
    interest: string,
    weeks: 4 | 8,
    templateVersion: string,
  ): Promise<PlanBundle | null> {
    for (const bundle of this.plans.values()) {
      const plan = bundle.plan;
      if (
        plan.studentUserId === studentUserId &&
        plan.interest === interest &&
        plan.weeks === weeks &&
        plan.templateVersion === templateVersion
      ) {
        return cloneBundle(bundle);
      }
    }
    return null;
  }

  async createPlan(bundle: PlanBundle): Promise<void> {
    const existing = await this.findPlanBySignature(
      bundle.plan.studentUserId,
      bundle.plan.interest,
      bundle.plan.weeks,
      bundle.plan.templateVersion,
    );
    if (existing !== null) {
      throw new LearningPlanStoreConflictError(`已存在同一签名的学习计划：${existing.plan.id}`);
    }
    if (this.plans.has(bundle.plan.id)) {
      throw new LearningPlanStoreConflictError(`学习计划 id 冲突：${bundle.plan.id}`);
    }
    this.plans.set(bundle.plan.id, cloneBundle(bundle));
  }

  async findPlan(planId: string): Promise<PlanRecord | null> {
    const bundle = this.plans.get(planId);
    return bundle === undefined ? null : { ...bundle.plan };
  }

  async findBundle(planId: string): Promise<PlanBundle | null> {
    const bundle = this.plans.get(planId);
    return bundle === undefined ? null : cloneBundle(bundle);
  }

  async listPlansByStudent(studentUserId: string): Promise<PlanRecord[]> {
    return [...this.plans.values()]
      .filter((bundle) => bundle.plan.studentUserId === studentUserId)
      .map((bundle) => ({ ...bundle.plan }))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async confirmPlan(input: ConfirmPlanInput): Promise<ConfirmPlanResult> {
    const bundle = this.plans.get(input.planId);
    if (bundle === undefined) throw new Error(`learning plan not found: ${input.planId}`);
    if (bundle.plan.projectId !== null) {
      const existing = this.projects.get(bundle.plan.projectId);
      if (existing === undefined) throw new Error('计划引用的项目不存在（数据不一致）');
      return { plan: { ...bundle.plan }, project: { ...existing }, created: false };
    }
    const project: LearningProjectRecord = {
      ...input.project,
      createdAt: input.now,
      completedAt: null,
    };
    this.projects.set(project.id, project);
    bundle.plan = {
      ...bundle.plan,
      projectId: project.id,
      status: 'active',
      confirmedAt: input.now,
      updatedAt: input.now,
    };
    return { plan: { ...bundle.plan }, project: { ...project }, created: true };
  }

  async findProject(projectId: string): Promise<LearningProjectRecord | null> {
    const project = this.projects.get(projectId);
    return project === undefined ? null : { ...project };
  }

  async findSession(planId: string, sessionId: string): Promise<SessionRecord | null> {
    const bundle = this.plans.get(planId);
    if (bundle === undefined) return null;
    const session = bundle.sessions.find((item) => item.id === sessionId);
    return session === undefined ? null : cloneSession(session);
  }

  async listSessions(planId: string): Promise<SessionRecord[]> {
    const bundle = this.plans.get(planId);
    if (bundle === undefined) return [];
    return [...bundle.sessions]
      .sort((a, b) => a.index - b.index)
      .map((session) => cloneSession(session));
  }

  async findMastery(studentUserId: string, objectiveId: string): Promise<MasteryRecord | null> {
    const record = this.mastery.get(masteryKey(studentUserId, objectiveId));
    return record === undefined ? null : { ...record };
  }

  async listMasteryForPlan(studentUserId: string, planId: string): Promise<MasteryRecord[]> {
    return [...this.mastery.values()]
      .filter((record) => record.studentUserId === studentUserId && record.planId === planId)
      .map((record) => ({ ...record }));
  }

  async upsertMastery(record: MasteryRecord): Promise<void> {
    this.mastery.set(masteryKey(record.studentUserId, record.objectiveId), { ...record });
  }

  async listAttempts(studentUserId: string, objectiveId: string): Promise<AttemptRecord[]> {
    const list = this.attempts.get(attemptKey(studentUserId, objectiveId)) ?? [];
    return list.map((attempt) => ({ ...attempt }));
  }

  async appendAttempt(attempt: AttemptRecord): Promise<void> {
    const key = attemptKey(attempt.studentUserId, attempt.objectiveId);
    const list = this.attempts.get(key) ?? [];
    list.push({ ...attempt });
    this.attempts.set(key, list);
  }

  async findAwaitingQuestion(
    studentUserId: string,
    planId: string,
  ): Promise<PendingQuestionRecord | null> {
    for (const record of this.pending.values()) {
      if (
        record.studentUserId === studentUserId &&
        record.planId === planId &&
        record.status === 'awaiting'
      ) {
        return clonePendingQuestion(record);
      }
    }
    return null;
  }

  async findPendingQuestion(questionId: string): Promise<PendingQuestionRecord | null> {
    const record = this.pending.get(questionId);
    return record === undefined ? null : clonePendingQuestion(record);
  }

  async createPendingQuestion(record: PendingQuestionRecord): Promise<void> {
    if (this.pending.has(record.id)) {
      throw new PendingQuestionConflictError(`待答题 id 冲突：${record.id}`);
    }
    for (const existing of this.pending.values()) {
      if (
        existing.status === 'awaiting' &&
        existing.studentUserId === record.studentUserId &&
        existing.planId === record.planId
      ) {
        throw new PendingQuestionConflictError(
          `同一 (student, plan) 只能有一道未答题：${existing.id}`,
        );
      }
    }
    this.pending.set(record.id, clonePendingQuestion(record));
  }

  async completePendingQuestion(input: CompletePendingQuestionInput): Promise<boolean> {
    const record = this.pending.get(input.questionId);
    if (record === undefined || record.status !== 'awaiting') return false;
    this.pending.set(input.questionId, {
      ...record,
      status: 'answered',
      answeredAt: input.answeredAt,
      updatedAt: input.answeredAt,
    });
    await this.appendAttempt(input.attempt);
    await this.upsertMastery(input.mastery);
    return true;
  }

  async markPendingQuestionAnswered(questionId: string, answeredAt: Date): Promise<boolean> {
    const record = this.pending.get(questionId);
    if (record === undefined || record.status !== 'awaiting') return false;
    this.pending.set(questionId, {
      ...record,
      status: 'answered',
      answeredAt,
      updatedAt: answeredAt,
    });
    return true;
  }
}

function cloneBundle(bundle: PlanBundle): PlanBundle {
  return {
    plan: { ...bundle.plan },
    modules: bundle.modules.map((module) => ({ ...module })),
    objectives: bundle.objectives.map((objective) => ({
      ...objective,
      prerequisiteIds: [...objective.prerequisiteIds],
    })),
    sessions: bundle.sessions.map((session) => cloneSession(session)),
  };
}

function clonePendingQuestion(record: PendingQuestionRecord): PendingQuestionRecord {
  return {
    ...record,
    options: record.options.map((option) => ({ ...option })),
  };
}

function cloneSession(session: SessionRecord): SessionRecord {
  return {
    ...session,
    blocks: session.blocks.map((block) => ({ ...block })),
    theoryObjectiveIds: [...session.theoryObjectiveIds],
    practiceObjectiveIds: [...session.practiceObjectiveIds],
  };
}

/** 供服务层构造稳定 id；测试可注入固定值。 */
export function newId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}
