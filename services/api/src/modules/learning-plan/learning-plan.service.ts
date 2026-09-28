import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  ConfirmLearningPlanResponse,
  CurrentUser,
  GenerateLearningPlanResponse,
  KnowledgeType,
  LearningErrorType,
  LearningPlanView,
  LessonModuleView,
  LessonSessionView,
  MasterySummary,
  NextStepView,
  ProjectSummary,
  PublicQuestion,
  SessionBlock,
  StartSessionResponse,
  SubmitAnswerResponse,
  SubmitEvidenceResponse,
} from '@qitu/contracts';
import {
  buildQuestion,
  computeMasteryScore,
  computeTheoryMastered,
  deriveObjectiveStatus,
  gradeAnswer,
  isReviewDue,
  masteryBasisPoints,
  nextAction,
  qualityBasisPoints,
  toPublicQuestion,
  type ObjectiveMasteryState,
  type QuestionCard,
} from '@qitu/ai-client';
import { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { hashIdempotentInput } from '../../common/idempotency/idempotency.hash';
import { throwHttpForIdempotencyError } from '../../common/idempotency/idempotency.errors';
import { AuditWriter } from '../../common/audit/audit.service';
import { OutboxWriter } from '../../common/outbox/outbox.service';
import { AccessPolicy } from '../../common/access/access-policy';
import {
  FORMAL_PROJECT_START_STAGE,
  computeStageProgress,
} from '../projects/intent-confirmation.state-machine';
import {
  LearningPlanStore,
  LearningPlanStoreConflictError,
  PendingQuestionConflictError,
  newId,
  type AttemptRecord,
  type MasteryRecord,
  type ObjectiveRecord,
  type PendingQuestionRecord,
  type PlanBundle,
  type PlanRecord,
  type SessionRecord,
} from './learning-plan.store';
import {
  assertGenerateInput,
  PlanGenerationError,
  PlanGenerator,
  validateGeneratedPlan,
  type GeneratedPlan,
} from './plan-generator';

const PLAN_FORBIDDEN_MESSAGE = '无权访问该学习计划';
const THRESHOLD_BASIS_POINTS = 9000;
const MAX_EVIDENCE_REF_LENGTH = 200;
const MAX_EVIDENCE_SUMMARY_LENGTH = 500;

/** 服务端推进 / 门禁的稳定错误码（契约 `LearningPlanErrorCode` 子集）。 */
type ServiceErrorCode =
  | 'LEARNING_PLAN_NOT_FOUND'
  | 'LEARNING_PLAN_FORBIDDEN'
  | 'LEARNING_PLAN_TRANSITION_INVALID'
  | 'LEARNING_PLAN_INVALID'
  | 'LEARNING_SESSION_NOT_FOUND'
  | 'THEORY_MASTERED_REQUIRED'
  | 'QUESTION_NOT_AWAITING'
  | 'EVIDENCE_INVALID';

/**
 * 学习计划服务（T？）——「兴趣 → 4/8 周计划 → 逐节掌握」的服务端真源。
 *
 * 硬约束（全部在此强制，客户端无法绕过）：
 *
 * 1. **未确认不建项目**：生成只写 `learning_plans` 草稿（`projectId=null`）；
 *    只有 `confirmPlan` 才在事务里创建唯一项目并冻结 `templateVersion`。
 * 2. **TheoryMastered 服务端计算**：`computeTheoryMastered` 只读服务端掌握记录；
 *    实践课 / 实践分块在理论达标前一律 403，客户端传入的 stage / mastery 被
 *    控制器白名单直接丢弃并在服务层拒绝。
 * 3. **判分与題库留在服务端**：题面用 `QuestionCard`（含答案与解析），下发前只经
 *    `toPublicQuestion` 结构化投影；作答请求只有 `questionId` + `answer`。
 * 4. **对象级授权**：学生只能碰自己的计划；班主任只能读当前在带的学生；越权 403。
 * 5. **幂等**：生成按 `(studentId, interest, weeks, templateVersion)` 去重；
 *    confirm / answers / evidence 走 `IdempotencyStore`，重试不追加第二次尝试。
 * 6. **审计**：生成、确认、`TheoryMastered`、证据提交各写一次（`TheoryMastered`
 *    用「非达标 → 达标」的状态翻转保证 exactly-once）。
 */
@Injectable()
export class LearningPlanService {
  private readonly logger = new Logger(LearningPlanService.name);

  constructor(
    private readonly store: LearningPlanStore,
    private readonly generator: PlanGenerator,
    private readonly idempotency: IdempotencyStore,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
    private readonly access: AccessPolicy,
  ) {}

  /* ==================== 生成（draft，无项目） ==================== */

  async generatePlan(
    actor: CurrentUser,
    rawInput: { interest: unknown; weeks: unknown; goal?: unknown },
  ): Promise<GenerateLearningPlanResponse> {
    const input = assertGenerateInput(rawInput);
    const generated = this.generator.generate(input);
    validateGeneratedPlan(generated);

    const existing = await this.store.findPlanBySignature(
      actor.id,
      generated.interest,
      generated.weeks,
      generated.templateVersion,
    );
    if (existing !== null) {
      return { plan: await this.toPlanView(existing), deduplicated: true };
    }

    const now = new Date();
    const bundle = this.buildBundle(actor.id, generated, now);
    try {
      await this.store.createPlan(bundle);
    } catch (error) {
      if (error instanceof LearningPlanStoreConflictError) {
        const raced = await this.store.findPlanBySignature(
          actor.id,
          generated.interest,
          generated.weeks,
          generated.templateVersion,
        );
        if (raced !== null) return { plan: await this.toPlanView(raced), deduplicated: true };
      }
      throw error;
    }

    await this.audit.write({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'learning_plan.generate',
      targetType: 'learning_plan',
      targetId: bundle.plan.id,
      idempotencyKey: bundle.plan.idempotencyKey,
      detail: {
        interest: generated.interest,
        weeks: generated.weeks,
        templateVersion: generated.templateVersion,
        modules: generated.modules.length,
        sessions: generated.sessions.length,
        objectives: generated.objectives.length,
      },
    });
    this.logger.log(
      `生成计划 draft=${bundle.plan.id} student=${actor.id} weeks=${generated.weeks}`,
    );
    return { plan: await this.toPlanView(bundle), deduplicated: false };
  }

  /* ==================== 确认（唯一创建项目） ==================== */

  async confirmPlan(
    actor: CurrentUser,
    planId: string,
    idempotencyKey: string,
    _body: unknown = {},
  ): Promise<ConfirmLearningPlanResponse> {
    const bundle = await this.requireBundle(planId);
    this.assertOwnedStudent(actor, bundle.plan);
    if (bundle.plan.status === 'archived' || bundle.plan.status === 'completed') {
      throw new ConflictException({
        code: 'LEARNING_PLAN_TRANSITION_INVALID',
        message: `计划状态为 ${bundle.plan.status}，不能确认`,
      });
    }

    const scope = `student.learning-plan.confirm:${actor.id}:${planId}`;
    const requestHash = hashIdempotentInput(scope, { planId }, {});
    try {
      const result = await this.idempotency.execute(
        scope,
        idempotencyKey,
        requestHash,
        async () => {
          const existingProjectId = bundle.plan.projectId;
          if (existingProjectId !== null) {
            const project = await this.store.findProject(existingProjectId);
            if (project === null) throw new Error('计划引用的项目不存在（数据不一致）');
            return {
              status: 200,
              body: await this.confirmResponse(bundle, project, true),
            };
          }

          const progress = computeStageProgress(FORMAL_PROJECT_START_STAGE);
          const now = new Date();
          const confirmed = await this.store.confirmPlan({
            planId,
            now,
            project: {
              id: newId('proj'),
              studentId: actor.id,
              templateVersionId: bundle.plan.templateVersion,
              status: FORMAL_PROJECT_START_STAGE,
              currentStageIndex: progress.currentStageIndex,
              stageTotal: progress.stageTotal,
              progressPercent: progress.progressPercent,
              title: bundle.plan.goal.length > 0 ? bundle.plan.goal : bundle.plan.interest,
              subtitle: `${bundle.plan.interest} · ${bundle.plan.weeks} 周`,
              tags: [bundle.plan.interest],
            },
          });

          if (confirmed.created) {
            await this.audit.write({
              actorId: actor.id,
              actorRole: actor.role,
              action: 'learning_plan.confirm',
              targetType: 'project',
              targetId: confirmed.project.id,
              idempotencyKey: `${scope}:${idempotencyKey}`,
              detail: {
                planId,
                templateVersion: bundle.plan.templateVersion,
                weeks: bundle.plan.weeks,
                stage: FORMAL_PROJECT_START_STAGE,
              },
            });
            this.logger.log(`确认计划 plan=${planId} project=${confirmed.project.id}`);
          }

          const current = (await this.store.findBundle(planId)) ?? bundle;
          return {
            status: confirmed.created ? 201 : 200,
            body: await this.confirmResponse(current, confirmed.project, !confirmed.created),
          };
        },
      );
      const body = result.body;
      return result.replayed ? { ...body, replayed: true } : body;
    } catch (error) {
      throwHttpForIdempotencyError(error);
    }
  }

  /* ==================== 读 ==================== */

  async getPlan(actor: CurrentUser, planId: string): Promise<LearningPlanView> {
    const bundle = await this.requireBundle(planId);
    await this.assertCanRead(actor, bundle.plan);
    return this.toPlanView(bundle);
  }

  async listSessions(actor: CurrentUser, planId: string): Promise<LessonSessionView[]> {
    const bundle = await this.requireBundle(planId);
    await this.assertCanRead(actor, bundle.plan);
    const states = await this.loadStates(actor, bundle);
    return bundle.sessions
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((session) => this.toSessionView(bundle, session, states));
  }

  /* ==================== 会话推进 ==================== */

  async startSession(
    actor: CurrentUser,
    planId: string,
    sessionId: string,
  ): Promise<StartSessionResponse> {
    const bundle = await this.requireBundle(planId);
    this.assertOwnedStudent(actor, bundle.plan);
    this.assertActive(bundle.plan);
    const session = await this.requireSession(bundle, sessionId);
    const states = await this.loadStates(actor, bundle);
    this.assertPracticeGate(session, states);
    return {
      session: this.toSessionView(bundle, session, states),
      nextStep: await this.nextStepView(bundle, session, states),
    };
  }

  async getNextStep(
    actor: CurrentUser,
    planId: string,
    sessionId: string,
  ): Promise<NextStepView> {
    const bundle = await this.requireBundle(planId);
    await this.assertCanRead(actor, bundle.plan);
    this.assertActive(bundle.plan);
    const session = await this.requireSession(bundle, sessionId);
    const states = await this.loadStates(actor, bundle);
    this.assertPracticeGate(session, states);
    return this.nextStepView(bundle, session, states);
  }

  /* ==================== 作答（判分 + 掌握） ==================== */

  async submitAnswer(
    actor: CurrentUser,
    planId: string,
    sessionId: string,
    body: { questionId: unknown; answer: unknown },
    idempotencyKey: string,
  ): Promise<SubmitAnswerResponse> {
    const bundle = await this.requireBundle(planId);
    this.assertOwnedStudent(actor, bundle.plan);
    this.assertActive(bundle.plan);
    const session = await this.requireSession(bundle, sessionId);
    const states = await this.loadStates(actor, bundle);
    this.assertPracticeGate(session, states);

    const questionId = typeof body.questionId === 'string' ? body.questionId.trim() : '';
    if (questionId.length === 0) {
      throw this.badRequest('QUESTION_NOT_AWAITING', '缺少 questionId');
    }
    if (typeof body.answer !== 'string') {
      throw this.badRequest('LEARNING_PLAN_INVALID', 'answer 必须是字符串');
    }

    const scope = `student.learning-plan.answer:${actor.id}:${planId}:${sessionId}:${questionId}`;
    const requestHash = hashIdempotentInput(
      scope,
      { planId, sessionId, questionId },
      { answer: body.answer },
    );
    try {
      const result = await this.idempotency.execute(
        scope,
        idempotencyKey,
        requestHash,
        async () => {
          const fresh = await this.requireBundle(planId);
          const freshSession = await this.requireSession(fresh, sessionId);
          const freshStates = await this.loadStates(actor, fresh);
          this.assertPracticeGate(freshSession, freshStates);
          // 题面从 `pending_questions`（迁移 0009）按 id 解析：只有本人、本计划、
          // 本会话的 `awaiting` 题可判分；服务端持有 expectedAnswer / explanation。
          const pending = await this.store.findPendingQuestion(questionId);
          if (
            pending === null ||
            pending.studentUserId !== fresh.plan.studentUserId ||
            pending.planId !== planId ||
            pending.sessionId !== sessionId ||
            pending.status !== 'awaiting'
          ) {
            throw new ConflictException({
              code: 'QUESTION_NOT_AWAITING',
              message: '该题不属于当前会话的待答题，或已作答',
            });
          }
          const objective = this.objectiveIndex(fresh).get(pending.objectiveId);
          if (objective === undefined) {
            throw new ConflictException({
              code: 'QUESTION_NOT_AWAITING',
              message: '该题引用的目标不存在（数据不一致）',
            });
          }
          // 条件状态迁移 `awaiting → answered` 只成功一次，保证一题一 attempt。
          const claimed = await this.store.markPendingQuestionAnswered(questionId, new Date());
          if (!claimed) {
            throw new ConflictException({
              code: 'QUESTION_NOT_AWAITING',
              message: '该题已作答',
            });
          }
          const card = this.pendingToCard(pending);
          const grade = gradeAnswer(card, body.answer as string, 'awaiting');
          const existing = await this.store.listAttempts(fresh.plan.studentUserId, objective.id);
          const attempt = this.buildAttempt({
            studentId: fresh.plan.studentUserId,
            planId,
            objective,
            card,
            grade,
            attemptCount: existing.length + 1,
            now: new Date(),
          });
          await this.store.appendAttempt(attempt);

          const wasMastered = await this.theoryMastered(fresh.plan.studentUserId, freshSession);
          const nextMastery = await this.recomputeMastery(fresh.plan.studentUserId, fresh, objective, {
            correctAnswer: grade.isCorrect,
          });
          const isMastered = await this.theoryMastered(fresh.plan.studentUserId, freshSession);
          if (!wasMastered && isMastered) {
            await this.emitTheoryMastered(actor, fresh, freshSession);
          }

          const updatedStates = await this.loadStates(actor, fresh);
          return {
            status: 200,
            body: {
              questionId,
              result: grade.result,
              isCorrect: grade.isCorrect,
              score: grade.score,
              explanation: grade.explanation,
              errorType: grade.errorType,
              remediation: grade.remediation,
              mastery: this.toMasterySummary(nextMastery, objective),
              theoryMastered: isMastered,
              practiceUnlocked: this.isPracticeUnlocked(freshSession, updatedStates),
              replayed: false,
            } satisfies SubmitAnswerResponse,
          };
        },
      );
      const resp = result.body;
      return result.replayed ? { ...resp, replayed: true } : resp;
    } catch (error) {
      throwHttpForIdempotencyError(error);
    }
  }

  /* ==================== 实践证据 ==================== */

  async submitEvidence(
    actor: CurrentUser,
    planId: string,
    sessionId: string,
    body: { objectiveId: unknown; evidenceRef: unknown; summary?: unknown },
    idempotencyKey: string,
  ): Promise<SubmitEvidenceResponse> {
    const bundle = await this.requireBundle(planId);
    this.assertOwnedStudent(actor, bundle.plan);
    this.assertActive(bundle.plan);
    const session = await this.requireSession(bundle, sessionId);
    const states = await this.loadStates(actor, bundle);
    this.assertPracticeGate(session, states);

    const objectiveId = typeof body.objectiveId === 'string' ? body.objectiveId.trim() : '';
    if (!session.practiceObjectiveIds.includes(objectiveId)) {
      throw this.badRequest('EVIDENCE_INVALID', '证据只能提交给本会话的实践目标');
    }
    const objective = this.objectiveIndex(bundle).get(objectiveId);
    if (objective === undefined) {
      throw this.badRequest('EVIDENCE_INVALID', '目标不存在');
    }
    const evidenceRef = typeof body.evidenceRef === 'string' ? body.evidenceRef.trim() : '';
    if (evidenceRef.length === 0 || evidenceRef.length > MAX_EVIDENCE_REF_LENGTH) {
      throw this.badRequest('EVIDENCE_INVALID', 'evidenceRef 长度非法');
    }
    const summary =
      typeof body.summary === 'string' ? body.summary.trim().slice(0, MAX_EVIDENCE_SUMMARY_LENGTH) : null;

    const scope = `student.learning-plan.evidence:${actor.id}:${planId}:${sessionId}:${objectiveId}`;
    const requestHash = hashIdempotentInput(
      scope,
      { planId, sessionId, objectiveId },
      { evidenceRef, summary },
    );
    try {
      const result = await this.idempotency.execute(
        scope,
        idempotencyKey,
        requestHash,
        async () => {
          const fresh = await this.requireBundle(planId);
          const freshSession = await this.requireSession(fresh, sessionId);
          const existing = await this.store.listAttempts(fresh.plan.studentUserId, objectiveId);
          const wasMastered = await this.theoryMastered(fresh.plan.studentUserId, freshSession);
          await this.store.appendAttempt({
            id: newId('attempt'),
            studentUserId: fresh.plan.studentUserId,
            planId,
            objectiveId,
            questionId: null,
            result: 'correct',
            isCorrect: true,
            assessmentType: 'qualitative',
            errorType: null,
            hintsUsed: 0,
            attemptCount: existing.length + 1,
            qualityBasisPoints: qualityBasisPoints(1),
            userAnswer: evidenceRef,
            createdAt: new Date(),
          });
          const nextMastery = await this.recomputeMastery(fresh.plan.studentUserId, fresh, objective, {
            correctAnswer: true,
          });
          const isMastered = await this.theoryMastered(fresh.plan.studentUserId, freshSession);
          if (!wasMastered && isMastered) {
            await this.emitTheoryMastered(actor, fresh, freshSession);
          }
          await this.audit.write({
            actorId: actor.id,
            actorRole: actor.role,
            action: 'learning_plan.evidence',
            targetType: 'learning_objective',
            targetId: objectiveId,
            idempotencyKey: `${scope}:${idempotencyKey}`,
            detail: { planId, sessionId, knowledgeType: objective.type },
          });
          const updatedStates = await this.loadStates(actor, fresh);
          return {
            status: 201,
            body: {
              objectiveId,
              accepted: true,
              theoryMastered: isMastered,
              practiceUnlocked: this.isPracticeUnlocked(freshSession, updatedStates),
              replayed: false,
            } satisfies SubmitEvidenceResponse,
          };
        },
      );
      const resp = result.body;
      return result.replayed ? { ...resp, replayed: true } : resp;
    } catch (error) {
      throwHttpForIdempotencyError(error);
    }
  }

  /* ==================== 内部：构造 / 映射 ==================== */

  private buildBundle(studentId: string, generated: GeneratedPlan, now: Date): PlanBundle {
    const planId = newId('plan');
    const moduleIdMap = new Map<string, string>();
    const objectiveIdMap = new Map<string, string>();
    for (const module of generated.modules) moduleIdMap.set(module.id, module.id);
    for (const objective of generated.objectives) objectiveIdMap.set(objective.id, objective.id);
    const remap = (id: string): string => objectiveIdMap.get(id) ?? id;

    const plan: PlanRecord = {
      id: planId,
      studentUserId: studentId,
      projectId: null,
      interest: generated.interest,
      goal: generated.goal,
      weeks: generated.weeks,
      minutesPerSession: generated.minutesPerSession,
      templateVersion: generated.templateVersion,
      status: 'draft',
      version: 1,
      idempotencyKey: `learning-plan:${studentId}:${generated.templateVersion}:${generated.weeks}:${generated.interest}`,
      confirmedAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    return {
      plan,
      modules: generated.modules.map((module) => ({
        id: moduleIdMap.get(module.id) ?? module.id,
        planId,
        name: module.name,
        weekIndex: module.weekIndex,
        objective: module.objective,
        ordinal: module.ordinal,
      })),
      objectives: generated.objectives.map((objective) => ({
        id: remap(objective.id),
        planId,
        moduleId: moduleIdMap.get(objective.moduleId) ?? objective.moduleId,
        name: objective.name,
        type: objective.type,
        objective: objective.objective,
        prerequisiteIds: objective.prerequisiteIds.map(remap),
        ordinal: objective.ordinal,
      })),
      sessions: generated.sessions.map((session) => ({
        id: `${planId}:${session.id}`,
        planId,
        moduleId: moduleIdMap.get(session.moduleId) ?? session.moduleId,
        index: session.index,
        blocks: session.blocks.map((block) => ({
          kind: blockKindOf(block.activity),
          minutes: block.minutes,
        })),
        theoryObjectiveIds: session.theoryObjectiveIds.map(remap),
        practiceObjectiveIds: session.practiceObjectiveIds.map(remap),
        mode: session.mode,
      })),
    };
  }

  private async toPlanView(bundle: PlanBundle): Promise<LearningPlanView> {
    const states = await this.loadStatesByStudent(bundle.plan.studentUserId, bundle);
    const objectiveByModule = new Map<string, ObjectiveRecord[]>();
    for (const objective of bundle.objectives) {
      const list = objectiveByModule.get(objective.moduleId) ?? [];
      list.push(objective);
      objectiveByModule.set(objective.moduleId, list);
    }
    const modules: LessonModuleView[] = bundle.modules
      .slice()
      .sort((a, b) => a.ordinal - b.ordinal)
      .map((module) => ({
        id: module.id,
        name: module.name,
        weekIndex: module.weekIndex,
        objective: module.objective,
        ordinal: module.ordinal,
        objectives: (objectiveByModule.get(module.id) ?? [])
          .slice()
          .sort((a, b) => a.ordinal - b.ordinal)
          .map((objective) => ({
            id: objective.id,
            moduleId: objective.moduleId,
            name: objective.name,
            type: objective.type,
            objective: objective.objective,
            prerequisiteIds: [...objective.prerequisiteIds],
            ordinal: objective.ordinal,
          })),
      }));
    return {
      id: bundle.plan.id,
      studentUserId: bundle.plan.studentUserId,
      projectId: bundle.plan.projectId,
      interest: bundle.plan.interest,
      goal: bundle.plan.goal,
      weeks: bundle.plan.weeks,
      minutesPerSession: bundle.plan.minutesPerSession,
      templateVersion: bundle.plan.templateVersion,
      status: bundle.plan.status,
      version: bundle.plan.version,
      modules,
      sessions: bundle.sessions
        .slice()
        .sort((a, b) => a.index - b.index)
        .map((session) => this.toSessionView(bundle, session, states)),
      confirmedAt: bundle.plan.confirmedAt?.toISOString() ?? null,
      createdAt: bundle.plan.createdAt.toISOString(),
      updatedAt: bundle.plan.updatedAt.toISOString(),
    };
  }

  private toSessionView(
    bundle: PlanBundle,
    session: SessionRecord,
    states: Map<string, ObjectiveMasteryState>,
  ): LessonSessionView {
    const theoryMastered = computeTheoryMastered(session.theoryObjectiveIds, states);
    return {
      id: session.id,
      moduleId: session.moduleId,
      index: session.index,
      week: Math.floor(session.index / 5) + 1,
      day: (session.index % 5) + 1,
      title: `${bundle.plan.interest} · 第 ${session.index + 1} 节`,
      blocks: session.blocks.map((block) => ({ kind: block.kind, minutes: block.minutes })),
      theoryObjectiveIds: [...session.theoryObjectiveIds],
      practiceObjectiveIds: [...session.practiceObjectiveIds],
      mode: session.mode,
      theoryMastered,
      practiceUnlocked: this.isPracticeUnlocked(session, states),
    };
  }

  private async confirmResponse(
    bundle: PlanBundle,
    project: {
      id: string;
      status: ProjectSummary['stage'];
      progressPercent: number;
      title: string;
    },
    replayed: boolean,
  ): Promise<ConfirmLearningPlanResponse> {
    const summary: ProjectSummary = {
      id: project.id,
      title: project.title,
      stage: project.status,
      progress: project.progressPercent,
    };
    return { plan: await this.toPlanView(bundle), project: summary, replayed };
  }

  /* ==================== 内部：掌握度 ==================== */

  private objectiveIndex(bundle: PlanBundle): Map<string, ObjectiveRecord> {
    return new Map(bundle.objectives.map((objective) => [objective.id, objective]));
  }

  private async loadStates(
    _actor: CurrentUser,
    bundle: PlanBundle,
  ): Promise<Map<string, ObjectiveMasteryState>> {
    // 掌握度始终按**计划所有者**读取：班主任读学生计划时不能读成自己的掌握记录。
    return this.loadStatesByStudent(bundle.plan.studentUserId, bundle);
  }

  private async loadStatesByStudent(
    studentId: string,
    bundle: PlanBundle,
  ): Promise<Map<string, ObjectiveMasteryState>> {
    const states = new Map<string, ObjectiveMasteryState>();
    for (const objective of bundle.objectives) {
      const record = await this.store.findMastery(studentId, objective.id);
      if (record !== null) states.set(objective.id, this.toState(record, objective.type));
    }
    return states;
  }

  private toState(record: MasteryRecord, knowledgeType: KnowledgeType): ObjectiveMasteryState {
    return {
      objectiveId: record.objectiveId,
      knowledgeType,
      score: record.masteryBasisPoints / 10_000,
      status: record.status,
      qualitativeMastered: record.qualitativeMastered,
      intervalIndex: record.intervalIndex,
    };
  }

  private async theoryMastered(studentId: string, session: SessionRecord): Promise<boolean> {
    if (session.theoryObjectiveIds.length === 0) return false;
    const states = new Map<string, ObjectiveMasteryState>();
    for (const objectiveId of session.theoryObjectiveIds) {
      const record = await this.store.findMastery(studentId, objectiveId);
      if (record !== null) states.set(objectiveId, this.toState(record, record.knowledgeType));
    }
    return computeTheoryMastered(session.theoryObjectiveIds, states);
  }

  private isPracticeUnlocked(
    session: SessionRecord,
    states: Map<string, ObjectiveMasteryState>,
  ): boolean {
    if (session.practiceObjectiveIds.length === 0) return false;
    return computeTheoryMastered(session.theoryObjectiveIds, states);
  }

  private assertPracticeGate(
    session: SessionRecord,
    states: Map<string, ObjectiveMasteryState>,
  ): void {
    if (session.practiceObjectiveIds.length === 0) return;
    if (!computeTheoryMastered(session.theoryObjectiveIds, states)) {
      throw new ForbiddenException({
        code: 'THEORY_MASTERED_REQUIRED',
        message: '理论目标全部掌握前，实践分块保持锁定',
      });
    }
  }

  private async recomputeMastery(
    studentId: string,
    bundle: PlanBundle,
    objective: ObjectiveRecord,
    options: { correctAnswer: boolean },
  ): Promise<MasteryRecord> {
    const existing = await this.store.findMastery(studentId, objective.id);
    const attempts = await this.store.listAttempts(studentId, objective.id);
    const signals = attempts.map((attempt) => ({
      result: attempt.result,
      isCorrect: attempt.isCorrect,
      hintsUsed: attempt.hintsUsed,
      attemptCount: attempt.attemptCount,
    }));
    const score = computeMasteryScore(signals);
    const qualitative =
      objective.type === 'concept' || objective.type === 'design'
        ? options.correctAnswer || (existing?.qualitativeMastered ?? false)
        : false;
    const status = deriveObjectiveStatus(objective.type, {
      score,
      qualitativeMastered: qualitative,
    });
    const correct = attempts.filter((attempt) => attempt.isCorrect).length;
    const wrong = attempts.length - correct;
    const record: MasteryRecord = {
      id: existing?.id ?? newId('mastery'),
      studentUserId: studentId,
      planId: bundle.plan.id,
      objectiveId: objective.id,
      knowledgeType: objective.type,
      status,
      masteryBasisPoints: masteryBasisPoints(score),
      thresholdBasisPoints: THRESHOLD_BASIS_POINTS,
      qualitativeMastered: qualitative,
      consecutiveCorrect: correct,
      consecutiveWrong: wrong,
      intervalIndex: existing?.intervalIndex ?? 0,
      nextReviewAt: existing?.nextReviewAt ?? null,
      reviewCount: existing?.reviewCount ?? 0,
      lapseCount: existing?.lapseCount ?? 0,
      updatedAt: new Date(),
    };
    await this.store.upsertMastery(record);
    return record;
  }

  private toMasterySummary(
    record: MasteryRecord | null,
    objective: ObjectiveRecord,
  ): MasterySummary {
    return {
      objectiveId: objective.id,
      knowledgeType: objective.type,
      status: record?.status ?? 'new',
      mastery: (record?.masteryBasisPoints ?? 0) / 10_000,
      threshold: (record?.thresholdBasisPoints ?? THRESHOLD_BASIS_POINTS) / 10_000,
      qualitativeMastered: record?.qualitativeMastered ?? false,
    };
  }

  private buildAttempt(input: {
    studentId: string;
    planId: string;
    objective: ObjectiveRecord;
    card: QuestionCard;
    grade: ReturnType<typeof gradeAnswer>;
    attemptCount: number;
    now: Date;
  }): AttemptRecord {
    return {
      id: newId('attempt'),
      studentUserId: input.studentId,
      planId: input.planId,
      objectiveId: input.objective.id,
      questionId: input.card.questionId,
      result: input.grade.result,
      isCorrect: input.grade.isCorrect,
      assessmentType: 'quiz',
      errorType: input.grade.errorType as LearningErrorType | null,
      hintsUsed: 0,
      attemptCount: input.attemptCount,
      qualityBasisPoints: qualityBasisPoints(input.grade.score),
      userAnswer: null,
      createdAt: input.now,
    };
  }

  private async emitTheoryMastered(
    actor: CurrentUser,
    bundle: PlanBundle,
    session: SessionRecord,
  ): Promise<void> {
    await this.audit.write({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'learning_plan.theory_mastered',
      targetType: 'learning_session',
      targetId: session.id,
      idempotencyKey: `theory-mastered:${session.id}`,
      detail: {
        planId: bundle.plan.id,
        theoryObjectiveIds: [...session.theoryObjectiveIds],
        practiceObjectiveIds: [...session.practiceObjectiveIds],
      },
    });
    await this.outbox.write({
      id: newId('evt'),
      topic: 'learning.theory_mastered',
      payload: {
        planId: bundle.plan.id,
        sessionId: session.id,
        studentUserId: bundle.plan.studentUserId,
        theoryObjectiveIds: [...session.theoryObjectiveIds],
      },
    });
  }

  /* ==================== 内部：下一步 / 題面 ==================== */

  private async nextStepView(
    bundle: PlanBundle,
    session: SessionRecord,
    states: Map<string, ObjectiveMasteryState>,
  ): Promise<NextStepView> {
    const studentId = bundle.plan.studentUserId;
    const theoryMastered = computeTheoryMastered(session.theoryObjectiveIds, states);
    const practiceUnlocked = this.isPracticeUnlocked(session, states);

    // `answer_pending` 是最高优先级：只要本计划还有一道未答题，就先把它发回去，
    // 不推进到复习 / 探测 / 练习。未答题由 `pending_questions`（迁移 0009）持久化。
    const awaiting = await this.store.findAwaitingQuestion(studentId, bundle.plan.id);
    if (awaiting !== null) {
      return this.pendingNextStepView(bundle, awaiting, theoryMastered, practiceUnlocked);
    }

    const candidates =
      session.practiceObjectiveIds.length > 0
        ? session.practiceObjectiveIds
        : session.theoryObjectiveIds;
    const objectiveIndex = this.objectiveIndex(bundle);

    let dueReviewObjectiveId: string | null = null;
    for (const objectiveId of new Set([...session.theoryObjectiveIds, ...session.practiceObjectiveIds])) {
      const record = await this.store.findMastery(studentId, objectiveId);
      if (record === null) continue;
      if (record.status !== 'mastered') continue;
      const state: ObjectiveMasteryState = {
        ...this.toState(record, record.knowledgeType),
        lastSessionIndex: session.index,
      };
      if (isReviewDue(state, session.index + 1)) {
        dueReviewObjectiveId = objectiveId;
        break;
      }
    }

    let candidate: NextStepView['objectiveId'] = null;
    let candidateObjective: ObjectiveRecord | undefined;
    for (const objectiveId of candidates) {
      const record = await this.store.findMastery(studentId, objectiveId);
      if (record === null || record.status !== 'mastered') {
        candidate = objectiveId;
        candidateObjective = objectiveIndex.get(objectiveId);
        break;
      }
    }

    const action = nextAction({
      hasPendingQuestion: false,
      dueReviewObjectiveId,
      candidate:
        candidate === null || candidateObjective === undefined
          ? null
          : {
              objectiveId: candidate,
              knowledgeType: candidateObjective.type,
              status: (await this.store.findMastery(studentId, candidate))?.status ?? 'new',
            },
    });

    const targetObjectiveId =
      action === 'review'
        ? dueReviewObjectiveId
        : action === 'complete'
          ? null
          : candidate;
    if (targetObjectiveId === null) {
      return {
        action,
        objectiveId: null,
        knowledgeType: null,
        status: null,
        gate: null,
        mastery: 0,
        threshold: THRESHOLD_BASIS_POINTS / 10_000,
        reason: action === 'complete' ? '本会话目标已全部掌握' : '当前没有待办目标',
        theoryMastered,
        practiceUnlocked,
        question: null,
      };
    }

    const objective = objectiveIndex.get(targetObjectiveId);
    if (objective === undefined) {
      throw this.badRequest('LEARNING_PLAN_INVALID', '目标不存在（数据不一致）');
    }
    const record = await this.store.findMastery(studentId, targetObjectiveId);
    const attempts = await this.store.listAttempts(studentId, targetObjectiveId);
    // 出题时持久化题面（含服务端答案 / 解析），只返回结构化投影。
    const pending = await this.ensurePendingQuestion(bundle, session, objective, attempts.length);
    const question: PublicQuestion = toPublicQuestion(this.pendingToCard(pending), pending.attempt);
    return {
      action,
      objectiveId: objective.id,
      knowledgeType: objective.type,
      status: record?.status ?? 'new',
      gate: objective.type === 'concept' || objective.type === 'design' ? 'qualitative' : 'quantitative',
      mastery: (record?.masteryBasisPoints ?? 0) / 10_000,
      threshold: (record?.thresholdBasisPoints ?? THRESHOLD_BASIS_POINTS) / 10_000,
      reason: this.actionReason(action),
      theoryMastered,
      practiceUnlocked,
      question,
    };
  }

  /**
   * 已存在未答题时的 `answer_pending` 视图：题面来自 `pending_questions`，
   * `expectedAnswer` / `explanation` 只用于服务端判分，绝不出现在响应里。
   */
  private async pendingNextStepView(
    bundle: PlanBundle,
    awaiting: PendingQuestionRecord,
    theoryMastered: boolean,
    practiceUnlocked: boolean,
  ): Promise<NextStepView> {
    const objective = this.objectiveIndex(bundle).get(awaiting.objectiveId);
    if (objective === undefined) {
      throw this.badRequest('LEARNING_PLAN_INVALID', '待答题引用的目标不存在（数据不一致）');
    }
    const record = await this.store.findMastery(bundle.plan.studentUserId, objective.id);
    return {
      action: 'answer_pending',
      objectiveId: objective.id,
      knowledgeType: objective.type,
      status: record?.status ?? 'new',
      gate: objective.type === 'concept' || objective.type === 'design' ? 'qualitative' : 'quantitative',
      mastery: (record?.masteryBasisPoints ?? 0) / 10_000,
      threshold: (record?.thresholdBasisPoints ?? THRESHOLD_BASIS_POINTS) / 10_000,
      reason: this.actionReason('answer_pending'),
      theoryMastered,
      practiceUnlocked,
      question: toPublicQuestion(this.pendingToCard(awaiting), awaiting.attempt),
    };
  }

  /**
   * 出题并落库。`(student, plan)` 至多一道未答题：若并发下已有未答题，
   * 读取并复用，保证重试不产生第二道题。
   */
  private async ensurePendingQuestion(
    bundle: PlanBundle,
    session: SessionRecord,
    objective: ObjectiveRecord,
    attemptIndex: number,
  ): Promise<PendingQuestionRecord> {
    const existing = await this.store.findAwaitingQuestion(
      bundle.plan.studentUserId,
      bundle.plan.id,
    );
    if (existing !== null) return existing;

    const card = this.buildCard(objective, attemptIndex);
    const now = new Date();
    const record: PendingQuestionRecord = {
      id: card.questionId,
      schoolId: null,
      studentUserId: bundle.plan.studentUserId,
      planId: bundle.plan.id,
      sessionId: session.id,
      objectiveId: objective.id,
      questionType: card.questionType,
      prompt: card.prompt,
      options: card.options.map((option) => ({ ...option })),
      expectedAnswer: card.expectedAnswer,
      explanation: card.explanation,
      difficulty: card.difficulty,
      assessmentType: 'quiz',
      status: 'awaiting',
      attempt: attemptIndex + 1,
      hintsUsed: 0,
      idempotencyKey: `pending-question:${bundle.plan.id}:${session.id}:${objective.id}:${attemptIndex}`,
      askedAt: now,
      answeredAt: null,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await this.store.createPendingQuestion(record);
    } catch (error) {
      if (error instanceof PendingQuestionConflictError) {
        const raced = await this.store.findAwaitingQuestion(
          bundle.plan.studentUserId,
          bundle.plan.id,
        );
        if (raced !== null) return raced;
      }
      throw error;
    }
    return record;
  }

  /** 持久化记录 → 服务端题面（含答案 / 解析），仅供判分与投影，绝不下发。 */
  private pendingToCard(record: PendingQuestionRecord): QuestionCard {
    return {
      questionId: record.id,
      objectiveId: record.objectiveId,
      prompt: record.prompt,
      questionType: record.questionType,
      expectedAnswer: record.expectedAnswer,
      options: record.options.map((option) => ({ ...option })),
      explanation: record.explanation,
      difficulty: record.difficulty ?? 'medium',
      // 判分函数直接从 `expectedAnswer` 重新提取开放题关键词，此处无需求值。
      keywords: [],
    };
  }

  private actionReason(action: NextStepView['action']): string {
    switch (action) {
      case 'answer_pending':
        return '有一道题已下发，等待作答';
      case 'review':
        return '到达间隔复习时间，先复习已掌握目标';
      case 'probe':
        return '先探测当前理解，再决定下一步';
      case 'assess':
        return '概念 / 设计目标需要用自己的话证明理解';
      case 'practice':
        return '通过练习把程序性目标练到达标';
      default:
        return '本会话目标已完成';
    }
  }

  private buildCard(objective: ObjectiveRecord, index: number): QuestionCard {
    return buildQuestion({
      objective: { id: objective.id, name: objective.name, type: objective.type },
      index,
      seed: objective.id,
    });
  }

  /* ==================== 内部：授权 / 校验 ==================== */

  private async requireBundle(planId: string): Promise<PlanBundle> {
    const bundle = await this.store.findBundle(planId);
    if (bundle === null) {
      throw new NotFoundException({
        code: 'LEARNING_PLAN_NOT_FOUND',
        message: '学习计划不存在',
      });
    }
    return bundle;
  }

  private async requireSession(bundle: PlanBundle, sessionId: string): Promise<SessionRecord> {
    const session = bundle.sessions.find((item) => item.id === sessionId);
    if (session === undefined) {
      throw new NotFoundException({
        code: 'LEARNING_SESSION_NOT_FOUND',
        message: '学习会话不存在',
      });
    }
    return session;
  }

  private assertOwnedStudent(actor: CurrentUser, plan: PlanRecord): void {
    if (actor.role !== 'student' || plan.studentUserId !== actor.id) {
      throw new ForbiddenException({
        code: 'LEARNING_PLAN_FORBIDDEN',
        message: PLAN_FORBIDDEN_MESSAGE,
      });
    }
  }

  private async assertCanRead(actor: CurrentUser, plan: PlanRecord): Promise<void> {
    if (actor.role === 'student') {
      if (plan.studentUserId === actor.id) return;
      throw new ForbiddenException({ code: 'LEARNING_PLAN_FORBIDDEN', message: PLAN_FORBIDDEN_MESSAGE });
    }
    const allowed = await this.access.canReadStudent(actor, plan.studentUserId);
    if (!allowed) {
      throw new ForbiddenException({ code: 'LEARNING_PLAN_FORBIDDEN', message: PLAN_FORBIDDEN_MESSAGE });
    }
  }

  private assertActive(plan: PlanRecord): void {
    if (plan.status !== 'active') {
      throw new ConflictException({
        code: 'LEARNING_PLAN_TRANSITION_INVALID',
        message: '计划确认后才能开始会话',
      });
    }
  }

  private badRequest(code: ServiceErrorCode, message: string): BadRequestException {
    return new BadRequestException({ code, message });
  }
}

function blockKindOf(activity: string): SessionBlock['kind'] {
  switch (activity) {
    case 'review':
      return 'review';
    case 'learn':
      return 'theory';
    case 'reflect':
      return 'check';
    case 'practice':
      return 'practice';
    default:
      return 'theory';
  }
}
