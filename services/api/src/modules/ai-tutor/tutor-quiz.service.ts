import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type {
  AnswerInteractiveQuizResponse,
  CurrentUser,
  LearningErrorType,
  Role,
  StudentStuckSignal,
  TutorHintLevel,
} from '@qitu/contracts';
import {
  computeMasteryScore,
  deriveObjectiveStatus,
  isObjectiveMastered,
  masteryBasisPoints,
  qualityBasisPoints,
} from '@qitu/ai-client';
import {
  canonicalizeSelectedKeys,
  findQuizBankEntry,
  gradeQuizKeys,
  type QuizBankEntry,
  type QuizKeyGrade,
} from '@qitu/ai-client/quiz-bank';
import { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { hashIdempotentInput } from '../../common/idempotency/idempotency.hash';
import { throwHttpForIdempotencyError } from '../../common/idempotency/idempotency.errors';
import { AuditWriter, type AuditTransaction } from '../../common/audit/audit.service';
import { MasteryDomainService } from '../mastery/mastery-domain.service';
import { LearningPlanService } from '../learning-plan/learning-plan.service';
import {
  LearningPlanStore,
  newId,
  type AttemptRecord,
  type MasteryRecord,
  type ObjectiveRecord,
  type PlanBundle,
  type SessionRecord,
} from '../learning-plan/learning-plan.store';
import { StuckSignalService } from '../plan-adjustment/stuck-signal.service';
import { TutorQuizStore, type AnswerAttemptRecord } from './tutor-quiz.store';
import { TutorService, type TutorSessionRecord } from './tutor.service';

const THRESHOLD_BASIS_POINTS = 9000;
const MAX_HINT_LEVEL = 5;
const MAX_DIRECT_HINT_LEVEL = 3;

/**
 * F1 判分路由服务：交互题判分只发生在服务端，掌握度写回沿用学习计划的
 * 评估事务（`completeAssessment`），作答证据写 `answer_attempts`（迁移 0031）。
 *
 * 对象级授权分层：
 * - 会话归属由控制器 `TutorService.loadSession` 先行校验（403）；
 * - 本服务按会话 `projectId` 反查学习计划，计划必须属于 `actor`，否则
 *   项目存在但他人所有 → 403，项目/计划不存在 → 409 `PBL_INTENT_NOT_CONFIRMED`；
 * - 概念 → 计划目标经 `mastery_objective_mappings` 在判分时解析（决策 D1），
 *   题库不携带 plan 作用域的 `objectiveId`。
 */
@Injectable()
export class TutorQuizService {
  constructor(
    private readonly store: LearningPlanStore,
    private readonly quizStore: TutorQuizStore,
    private readonly idempotency: IdempotencyStore,
    private readonly audit: AuditWriter,
    private readonly learningPlan: LearningPlanService,
    @Optional() private readonly mastery?: MasteryDomainService,
    @Optional() private readonly tutor?: TutorService,
    @Optional() private readonly stuckSignals?: StuckSignalService,
  ) {}

  async answer(
    actor: CurrentUser,
    session: TutorSessionRecord,
    quizId: string,
    body: { selectedKeys: unknown; idempotencyKey: string },
    idempotencyKey: string,
  ): Promise<AnswerInteractiveQuizResponse> {
    assertSessionOwned(session, actor.id);
    if (session.projectId === null) {
      throw new ConflictException({
        code: 'PBL_INTENT_NOT_CONFIRMED',
        message: '探索会话不能判分，请先确认项目意图',
      });
    }
    const projectId = session.projectId;
    const entry = findQuizBankEntry(quizId);
    if (entry === null) {
      throw new NotFoundException({
        code: 'TUTOR_QUIZ_NOT_EMITTED',
        message: '该题不属于可判分的题库',
      });
    }
    const emitted = session.turns.some((turn) =>
      turn.blocks.some((block) => block.kind === 'quiz' && block.questionId === quizId),
    );
    if (!emitted) {
      throw new NotFoundException({
        code: 'TUTOR_QUIZ_NOT_EMITTED',
        message: '该题不属于本会话已下发的题目',
      });
    }

    // 键集合判分：trim → 去重 → 排序，语义相同（[A,B] / [B,A]）判为同一次作答。
    const canonicalKeys = canonicalizeSelectedKeys(Array.isArray(body.selectedKeys) ? body.selectedKeys : []);
    const grade = gradeQuizKeys(entry, canonicalKeys);

    const scope = `student.tutor.quiz.answer:${actor.id}:${session.sessionId}:${quizId}`;
    const requestHash = hashIdempotentInput(
      scope,
      { sessionId: session.sessionId, quizId },
      { selectedKeys: canonicalKeys },
    );

    try {
      const result = await this.idempotency.execute(scope, idempotencyKey, requestHash, async () => {
        const outcome = await this.store.withAssessmentTransaction(actor.id, async (scopedStore, tx) => {
          // 事务内重读计划：plan 归属 / objective 解析都以最新事实为准。
          const plans = await scopedStore.listPlansByStudent(actor.id);
          const plan = plans.find((candidate) => candidate.projectId === projectId);
          if (plan === undefined || plan.studentUserId !== actor.id) {
            const project = await scopedStore.findProject(projectId);
            if (project !== null && project.studentId !== actor.id) {
              throw new ForbiddenException('无权访问该项目');
            }
            throw new ConflictException({
              code: 'PBL_INTENT_NOT_CONFIRMED',
              message: '项目尚未生成学习计划，不能判分',
            });
          }
          const bundle = await scopedStore.findBundle(plan.id);
          if (bundle === null) {
            throw new ConflictException({
              code: 'PBL_INTENT_NOT_CONFIRMED',
              message: '项目学习计划不存在，不能判分',
            });
          }
          const objective = await this.resolveObjective(scopedStore, bundle, entry);

          // A5：事务内重读掌握度，已掌握 / 非当前待答目标 → 400 QUESTION_NOT_AWAITING。
          if (objective !== null) {
            const existingMastery = await scopedStore.findMastery(actor.id, objective.id);
            if (existingMastery !== null && isObjectiveMastered(objective.type, {
              score: existingMastery.masteryBasisPoints / 10_000,
              qualitativeMastered: existingMastery.qualitativeMastered,
            })) {
              throw new BadRequestException({
                code: 'QUESTION_NOT_AWAITING',
                message: '该目标已掌握，不能重复判分',
              });
            }
            const pending = await this.firstPendingQuantitativeObjective(scopedStore, actor.id, bundle);
            if (pending === null || pending.id !== objective.id) {
              throw new BadRequestException({
                code: 'QUESTION_NOT_AWAITING',
                message: '该题不属于当前待掌握的目标',
              });
            }
          }

          const attemptCount = (await this.quizStore.countAttempts(actor.id, quizId)) + 1;
          // A4：作答证据的 hint 等级直接取会话等级，不维护第二份计数。
          const hintsUsed = session.lastHintLevel ?? 0;
          const now = new Date();

          const attemptRecord: AnswerAttemptRecord = {
            id: newId('quiz-attempt'),
            schoolId: await scopedStore.studentSchoolId(actor.id),
            studentUserId: actor.id,
            tutorSessionId: session.sessionId,
            quizId,
            objectiveId: objective?.id ?? null,
            planId: objective === null ? null : plan.id,
            conceptId: entry.conceptId,
            result: grade.result,
            isCorrect: grade.isCorrect,
            assessmentType: 'quiz',
            errorType: grade.errorType,
            hintsUsed,
            attemptCount,
            qualityBasisPoints: qualityBasisPoints(grade.score),
            userAnswer: JSON.stringify(canonicalKeys),
            idempotencyKey: `${scope}:${idempotencyKey}`,
            createdAt: now,
          };

          // 概念未映射：不写掌握度，只记录证据 + 审计告警（决策 D1 边界）。
          if (objective === null) {
            // A3：证据与审计都落在当前评估事务内，不存在判分提交后的补写。
            await this.quizStore.appendAttempt(attemptRecord, tx);
            await this.audit.write({
              actorId: actor.id,
              actorRole: actor.role,
              action: 'tutor.quiz.unmapped-concept',
              targetType: 'tutor_session',
              targetId: session.sessionId,
              idempotencyKey: `${scope}:${idempotencyKey}`,
              detail: { quizId, conceptId: entry.conceptId, correct: grade.isCorrect, hintLevel: hintsUsed },
            }, tx);
            return {
              kind: 'unmapped' as const,
              attemptCount,
            };
          }

          const theorySession = this.findTheorySession(bundle);
          const existing = await scopedStore.listAttempts(actor.id, objective.id);
          const attempt = this.buildAttempt({
            studentId: actor.id,
            planId: plan.id,
            objective,
            quizId,
            grade,
            attemptCount: existing.length + 1,
            hintsUsed,
            now,
          });
          const before = (await scopedStore.findMastery(actor.id, objective.id))?.masteryBasisPoints ?? 0;
          const nextMastery = await this.recomputeMastery(
            scopedStore,
            actor.id,
            bundle,
            objective,
            { correctAnswer: grade.isCorrect },
            false,
            attempt,
          );
          const masteryEvent = this.mastery === undefined
            ? null
            : await this.mastery.prepareAssessment(scopedStore, {
                bundle,
                objective,
                attempt,
                mastery: nextMastery,
                answeredAt: now,
                idempotencyKey,
                sourceType: 'quiz',
              });
          const masteryToPersist: MasteryRecord = masteryEvent === null
            ? nextMastery
            : {
                ...nextMastery,
                knowledgePointId: masteryEvent.knowledgePointId,
                courseVersion: masteryEvent.courseVersion,
                sourceEventId: masteryEvent.id,
                sourceSequence: masteryEvent.sequence,
                assessmentVersion: masteryEvent.assessmentVersion,
                validFrom: masteryEvent.validFrom,
              };

          const after = masteryToPersist.masteryBasisPoints / 10_000;
          const masteredAfter = isObjectiveMastered(objective.type, {
            score: after,
            qualitativeMastered: masteryToPersist.qualitativeMastered,
          });

          // A2：权威 TheoryMastered 门禁，复用 learning-plan 的单一实现。
          const gate = await this.learningPlan.evaluateGradingGate({
            store: scopedStore,
            bundle,
            session: theorySession,
            candidateMastery: masteryToPersist,
          });

          await scopedStore.completeAssessment({
            attempt,
            mastery: masteryToPersist,
            masteryEvent,
            commit: async (commitTx) => {
              await this.quizStore.appendAttempt(attemptRecord, commitTx);
              await this.learningPlan.emitGradingAssessmentEvents({
                actor,
                bundle,
                session: theorySession,
                masteryEvent,
                theoryMasteredFlip: gate.theoryMasteredFlip,
              }, commitTx);
              // A3：tutor.quiz.graded 审计与掌握度写入同事务，不再提交后补写。
              await this.audit.write({
                actorId: actor.id,
                actorRole: actor.role,
                action: 'tutor.quiz.graded',
                targetType: 'tutor_session',
                targetId: session.sessionId,
                idempotencyKey: `${scope}:${idempotencyKey}`,
                detail: {
                  quizId,
                  objectiveId: objective.id,
                  conceptId: entry.conceptId,
                  correct: grade.isCorrect,
                  attempts: attemptCount,
                  hintLevel: hintsUsed,
                  replayed: false,
                },
              }, commitTx);
            },
          });

          return {
            kind: 'mapped' as const,
            entry,
            grade,
            objective,
            attemptCount,
            before,
            after,
            masteredAfter,
            theorySessionId: theorySession.id,
            gate,
            planId: plan.id,
            stemNodeId: objective.id,
            attemptId: attemptRecord.id,
            errorType: grade.errorType,
          };
        });

        const prevHintLevel: TutorHintLevel = session.lastHintLevel ?? 1;
        const hintLevel = await this.advanceHintLadder(session, actor.id, grade.isCorrect);
        // 提交后门禁桥：与 `learning-plan.submitAnswer` 同构，best-effort 且幂等；
        // 事务内只写达标审计/outbox，团队链路故障不回滚已成立的理论达标。
        if (outcome.kind === 'mapped' && outcome.gate.theoryMasteredFlip) {
          await this.learningPlan.applyGradingGateBridge(actor.id, outcome.theorySessionId);
        }
        if (!grade.isCorrect) {
          if (hintLevel >= MAX_DIRECT_HINT_LEVEL) {
            const isSubsequent = prevHintLevel >= MAX_DIRECT_HINT_LEVEL;
            const severity: 'warning' | 'critical' = isSubsequent ? 'critical' : 'warning';
            if (isSubsequent && !session.escalated) {
              session.escalated = true;
            }
            if (outcome.kind === 'mapped') {
              await this.emitStuckSignal({
                actor,
                session,
                entry,
                scope,
                idempotencyKey,
                planId: outcome.planId,
                stemNodeId: outcome.stemNodeId,
                attemptId: outcome.attemptId,
                errorType: outcome.errorType ?? null,
                severity,
              });
            } else {
              await this.auditStuckSignal(actor, session, entry, scope, idempotencyKey, severity);
            }
          }
        }
        if (outcome.kind === 'mapped' && !grade.isCorrect && outcome.errorType !== null) {
          await this.emitMisconceptionSignal({
            actor,
            session,
            entry,
            planId: outcome.planId,
            stemNodeId: outcome.stemNodeId,
            attemptId: outcome.attemptId,
            errorType: outcome.errorType,
          });
        }

        if (outcome.kind === 'unmapped') {
          return { status: 200, body: this.responseForUnmapped(quizId, grade, outcome.attemptCount, hintLevel) };
        }
        return {
          status: 200,
          body: this.buildResponse({
            entry: outcome.entry,
            grade: outcome.grade,
            objective: outcome.objective,
            attemptCount: outcome.attemptCount,
            hintLevel,
            before: outcome.before,
            after: outcome.after,
            masteredAfter: outcome.masteredAfter,
          }),
        };
      });
      const resp = result.body;
      return result.replayed ? { ...resp, replayed: true } : resp;
    } catch (error) {
      throwHttpForIdempotencyError(error);
    }
  }

  /* ==================== 内部：阶梯 / 信号 ==================== */

  private async advanceHintLadder(
    session: TutorSessionRecord,
    actorId: string,
    correct: boolean,
  ): Promise<TutorHintLevel> {
    if (correct) return session.lastHintLevel ?? 1;
    if (this.tutor === undefined) return session.lastHintLevel ?? 1;
    const { hintLevel } = await this.tutor.advanceQuizHint(session, actorId);
    return hintLevel;
  }

  private async auditStuckSignal(
    actor: CurrentUser,
    session: TutorSessionRecord,
    entry: QuizBankEntry,
    scope: string,
    idempotencyKey: string,
    severity: 'warning' | 'critical' = 'critical',
  ): Promise<void> {
    await this.audit.write({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'tutor.stuck_signal',
      targetType: 'tutor_session',
      targetId: session.sessionId,
      idempotencyKey: `${scope}:${idempotencyKey}:${severity}`,
      detail: {
        trigger: severity === 'warning' ? 'l3_cap' : 'l5_cap',
        quizId: entry.questionId,
        conceptId: entry.conceptId,
        sessionId: session.sessionId,
        severity,
      },
    });
  }

  /**
   * L3 / L5 封顶 + 答错 = 卡点信号（ pedagogy-spec §7 升级 ）。
   *
   * 先写原有的 `tutor.stuck_signal` 审计（证据保底），再投递给 F4 的
   * `StuckSignalService.ingest`（节点级去重 / 深度熔断 / 追加补救节点）。
   * 计划调整是**旁路**：任何失败都不能影响判分结果，因此这里 catch 后
   * 只记 warning——F4 服务内部已做 audit-only 兜底。
   */
  private async emitStuckSignal(input: {
    actor: CurrentUser;
    session: TutorSessionRecord;
    entry: QuizBankEntry;
    scope: string;
    idempotencyKey: string;
    planId: string;
    stemNodeId: string;
    attemptId: string;
    errorType: LearningErrorType | null;
    severity?: 'warning' | 'critical';
  }): Promise<void> {
    const severity = input.severity ?? 'critical';
    await this.auditStuckSignal(
      input.actor,
      input.session,
      input.entry,
      input.scope,
      input.idempotencyKey,
      severity,
    );
    if (this.stuckSignals === undefined) return;
    const projectId = input.session.projectId;
    if (projectId === null) return;
    const triggerKey = (severity === 'critical'
      ? `l5_critical:${input.session.sessionId}:${input.entry.questionId}`
      : `l3_cap:${input.session.sessionId}:${input.entry.questionId}`) as `l3_cap:${string}:${string}` | `l5_critical:${string}:${string}`;
    const signal: StudentStuckSignal = {
      studentId: input.actor.id,
      projectId,
      planId: input.planId,
      sessionId: input.session.sessionId,
      stemNodeId: input.stemNodeId,
      conceptId: input.entry.conceptId,
      trigger: 'repeated_assessment_error',
      // A9：L3 触发键为 `l3_cap:${sessionId}:${quizId}`；L5 触发键为 `l5_critical:${sessionId}:${quizId}`。
      triggerKey,
      errorTypeCode: input.errorType ?? 'repeated_wrong',
      nodeRefs: [input.stemNodeId],
      evidenceRefs: [input.attemptId],
      emittedAt: new Date().toISOString(),
      severity,
    };
    await this.ingestSignal(signal, {
      actorId: input.actor.id,
      actorRole: input.actor.role,
      targetId: input.session.sessionId,
      idempotencyKey: `${input.scope}:${input.idempotencyKey}:ingest:${severity}`,
      detail: {
        quizId: input.entry.questionId,
        conceptId: input.entry.conceptId,
        stemNodeId: input.stemNodeId,
        triggerKey: signal.triggerKey,
        severity,
      },
    });
  }

  /**
   * S1 迷思检测（pedagogy-spec §7）：同一 concept 最近 3 次作答均为同类型
   * 错误（非 null errorType 且答错）时，发 `misconception:...:3` 信号。
   * 与 L3 相互独立；只有映射到计划目标的概念才有 stemNodeId 可发信号。
   */
  private async emitMisconceptionSignal(input: {
    actor: CurrentUser;
    session: TutorSessionRecord;
    entry: QuizBankEntry;
    planId: string;
    stemNodeId: string;
    attemptId: string;
    errorType: LearningErrorType;
  }): Promise<void> {
    if (this.stuckSignals === undefined) return;
    const projectId = input.session.projectId;
    if (projectId === null) return;
    const recent = await this.quizStore.listRecentAttemptsByConcept(
      input.actor.id,
      input.entry.conceptId,
      3,
    );
    const sameMisconception = recent.filter(
      (row) => !row.isCorrect && row.errorType === input.errorType,
    ).length;
    if (sameMisconception < 3) return;

    const signal: StudentStuckSignal = {
      studentId: input.actor.id,
      projectId,
      planId: input.planId,
      sessionId: input.session.sessionId,
      stemNodeId: input.stemNodeId,
      conceptId: input.entry.conceptId,
      trigger: 'repeated_assessment_error',
      triggerKey: `misconception:${input.actor.id}:${input.entry.conceptId}:${input.errorType}:3`,
      errorTypeCode: input.errorType,
      nodeRefs: [input.stemNodeId],
      evidenceRefs: [input.attemptId],
      emittedAt: new Date().toISOString(),
    };
    await this.ingestSignal(signal, {
      actorId: input.actor.id,
      actorRole: input.actor.role,
      targetId: input.session.sessionId,
      idempotencyKey: `${input.planId}:${input.entry.conceptId}:misconception:ingest`,
      detail: {
        quizId: input.entry.questionId,
        conceptId: input.entry.conceptId,
        stemNodeId: input.stemNodeId,
        triggerKey: signal.triggerKey,
      },
    });
  }

  /** 卡点 / 迷思信号统一投递：失败只写 audit-only 兜底，不影响判分结果。 */
  private async ingestSignal(
    signal: StudentStuckSignal,
    context: {
      actorId: string;
      actorRole: Role;
      targetId: string;
      idempotencyKey: string;
      detail: Record<string, unknown>;
    },
  ): Promise<void> {
    if (this.stuckSignals === undefined) return;
    try {
      await this.stuckSignals.ingest(signal);
    } catch {
      await this.audit.write({
        actorId: context.actorId,
        actorRole: context.actorRole,
        action: 'tutor.stuck_signal.ingest_failed',
        targetType: 'tutor_session',
        targetId: context.targetId,
        idempotencyKey: context.idempotencyKey,
        detail: context.detail,
      });
    }
  }

  /* ==================== 内部：解析 / 掌握度 ==================== */

  /** 计划的理论会话（`theoryObjectiveIds` 非空），门禁评估的唯一锚点。 */
  private findTheorySession(bundle: PlanBundle): SessionRecord {
    const ordered = bundle.sessions.slice().sort((left, right) => left.index - right.index);
    const theory = ordered.find((session) => session.theoryObjectiveIds.length > 0);
    if (theory !== undefined) return theory;
    throw new ConflictException({
      code: 'PBL_INTENT_NOT_CONFIRMED',
      message: '学习计划缺少理论会话，不能判分',
    });
  }

  /**
   * 当前第一个尚未掌握的可量化（memory / procedure）理论目标，与下发侧
   * `buildQuizBlocks` 的同一排序逻辑对齐；无待掌握目标时返回 null。
   */
  private async firstPendingQuantitativeObjective(
    scopedStore: LearningPlanStore,
    studentId: string,
    bundle: PlanBundle,
  ): Promise<ObjectiveRecord | null> {
    const objectiveById = new Map(bundle.objectives.map((objective) => [objective.id, objective]));
    const ordered: ObjectiveRecord[] = [];
    for (const session of bundle.sessions.slice().sort((left, right) => left.index - right.index)) {
      for (const objectiveId of session.theoryObjectiveIds) {
        const objective = objectiveById.get(objectiveId);
        if (objective !== undefined && !ordered.some((item) => item.id === objectiveId)) ordered.push(objective);
      }
    }
    for (const objective of ordered) {
      if (objective.type !== 'memory' && objective.type !== 'procedure') continue;
      const mastery = await scopedStore.findMastery(studentId, objective.id);
      if (mastery !== null && isObjectiveMastered(objective.type, {
        score: mastery.masteryBasisPoints / 10_000,
        qualitativeMastered: mastery.qualitativeMastered,
      })) continue;
      return objective;
    }
    return null;
  }

  private async resolveObjective(
    scopedStore: LearningPlanStore,
    bundle: PlanBundle,
    entry: QuizBankEntry,
  ): Promise<ObjectiveRecord | null> {
    for (const objective of bundle.objectives) {
      const mapping = await scopedStore.findObjectiveMapping({
        planId: bundle.plan.id,
        objectiveId: objective.id,
        templateVersion: bundle.plan.templateVersion,
        contentVersion: bundle.plan.templateVersion,
      });
      if (mapping !== null && mapping.knowledgePointId === entry.conceptId) return objective;
    }
    return null;
  }

  private buildAttempt(input: {
    studentId: string;
    planId: string;
    objective: ObjectiveRecord;
    quizId: string;
    grade: QuizKeyGrade;
    attemptCount: number;
    hintsUsed: number;
    now: Date;
  }): AttemptRecord {
    return {
      id: newId('attempt'),
      studentUserId: input.studentId,
      planId: input.planId,
      objectiveId: input.objective.id,
      questionId: input.quizId,
      result: input.grade.result,
      isCorrect: input.grade.isCorrect,
      assessmentType: 'quiz',
      errorType: input.grade.errorType as LearningErrorType | null,
      hintsUsed: input.hintsUsed,
      attemptCount: input.attemptCount,
      qualityBasisPoints: qualityBasisPoints(input.grade.score),
      userAnswer: null,
      createdAt: input.now,
    };
  }

  private async recomputeMastery(
    scopedStore: LearningPlanStore,
    studentId: string,
    bundle: PlanBundle,
    objective: ObjectiveRecord,
    options: { correctAnswer: boolean },
    persist: boolean,
    additionalAttempt?: AttemptRecord,
  ): Promise<MasteryRecord> {
    const existing = await scopedStore.findMastery(studentId, objective.id);
    const attempts = await scopedStore.listAttempts(studentId, objective.id);
    const allAttempts = additionalAttempt === undefined ? attempts : [...attempts, additionalAttempt];
    const signals = allAttempts.map((attempt) => ({
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
    const status = deriveObjectiveStatus(objective.type, { score, qualitativeMastered: qualitative });
    const correct = allAttempts.filter((attempt) => attempt.isCorrect).length;
    const wrong = allAttempts.length - correct;
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
    if (persist) await scopedStore.upsertMastery(record);
    return record;
  }

  private buildResponse(input: {
    entry: QuizBankEntry;
    grade: QuizKeyGrade;
    objective: ObjectiveRecord;
    attemptCount: number;
    hintLevel: TutorHintLevel;
    before: number;
    after: number;
    masteredAfter: boolean;
  }): AnswerInteractiveQuizResponse {
    const { entry, grade, objective } = input;
    const quantitative = objective.type === 'memory' || objective.type === 'procedure';
    // 答案 / 解析释放：仅当量化概念已达标（>= 0.9）。concept/design 定性概念
    // 判分永不释放标准答案（见 pedagogy-spec §9）；显式 explain 走回合流程。
    const release = quantitative && input.after >= 0.9;
    const beforeNormalized = input.before / 10_000;
    // A6：before === after 时概念没有净变化，conceptDeltas 必须为空数组。
    const conceptDeltas = beforeNormalized === input.after
      ? []
      : [{
          conceptId: entry.conceptId,
          before: beforeNormalized,
          after: input.after,
          mastered: input.masteredAfter,
        }];
    return {
      quizId: entry.questionId,
      correct: grade.isCorrect,
      attempts: input.attemptCount,
      hintLevel: input.hintLevel,
      explanation: release ? entry.explanation : null,
      correctKeys: release ? [...entry.expectedKeys] : null,
      conceptDeltas,
      nextGuidance: grade.isCorrect ? null : entry.rationaleHint,
      replayed: false,
    };
  }

  private responseForUnmapped(
    quizId: string,
    grade: QuizKeyGrade,
    attemptCount: number,
    hintLevel: TutorHintLevel,
  ): AnswerInteractiveQuizResponse {
    return {
      quizId,
      correct: grade.isCorrect,
      attempts: attemptCount,
      hintLevel,
      explanation: null,
      correctKeys: null,
      conceptDeltas: [],
      nextGuidance: grade.isCorrect ? null : '这道题关联的知识点尚未接入掌握度评估，先继续探索吧。',
      replayed: false,
    };
  }
}

/** 会话归属防御：与 `TutorService` 统一 403 文案，不泄露任何会话字段。 */
function assertSessionOwned(session: TutorSessionRecord, actorId: string): void {
  if (session.ownerId !== actorId) throw new ForbiddenException('无权访问该会话');
}
