import { ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type {
  AnswerInteractiveQuizResponse,
  CurrentUser,
  LearningErrorType,
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
import { AuditWriter } from '../../common/audit/audit.service';
import { MasteryDomainService } from '../mastery/mastery-domain.service';
import {
  LearningPlanStore,
  newId,
  type AttemptRecord,
  type MasteryRecord,
  type ObjectiveRecord,
  type PlanBundle,
} from '../learning-plan/learning-plan.store';
import { StuckSignalService } from '../plan-adjustment/stuck-signal.service';
import { TutorQuizStore, type AnswerAttemptRecord } from './tutor-quiz.store';
import { TutorService, type TutorSessionRecord } from './tutor.service';

const THRESHOLD_BASIS_POINTS = 9000;
const MAX_HINT_LEVEL = 3;

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
        const response = await this.store.withAssessmentTransaction(actor.id, async (scopedStore) => {
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
          const attemptCount = (await this.quizStore.countAttempts(actor.id, quizId)) + 1;
          // 答错推进阶梯前的会话等级，作为本次作答的证据（决策 D5）。
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
            await this.quizStore.appendAttempt(attemptRecord);
            const hintLevel = await this.advanceHintLadder(session, actor.id, grade.isCorrect);
            if (!grade.isCorrect && hintLevel === MAX_HINT_LEVEL) {
              await this.auditStuckSignal(actor, session, entry, scope, idempotencyKey);
            }
            await this.audit.write({
              actorId: actor.id,
              actorRole: actor.role,
              action: 'tutor.quiz.unmapped-concept',
              targetType: 'tutor_session',
              targetId: session.sessionId,
              idempotencyKey: `${scope}:${idempotencyKey}`,
              detail: { quizId, conceptId: entry.conceptId, correct: grade.isCorrect, hintLevel },
            });
            return {
              status: 200,
              body: this.responseForUnmapped(quizId, grade, attemptCount, hintLevel),
            };
          }

          const existing = await scopedStore.listAttempts(actor.id, objective.id);
          const attempt = this.buildAttempt({
            studentId: actor.id,
            planId: plan.id,
            objective,
            quizId,
            grade,
            attemptCount: existing.length + 1,
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

          await scopedStore.completeAssessment({
            attempt,
            mastery: masteryToPersist,
            masteryEvent,
            commit: async (tx) => {
              await this.quizStore.appendAttempt(attemptRecord, tx);
            },
          });

          // 阶梯推进与会话回合追加在掌握度事务提交后完成（F1.7 path (a)）。
          const hintLevel = await this.advanceHintLadder(session, actor.id, grade.isCorrect);
          if (!grade.isCorrect && hintLevel === MAX_HINT_LEVEL) {
            await this.emitStuckSignal({
              actor,
              session,
              entry,
              scope,
              idempotencyKey,
              planId: plan.id,
              stemNodeId: objective.id,
              attemptId: attemptRecord.id,
              errorType: grade.errorType ?? null,
            });
          }
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
              hintLevel,
              replayed: false,
            },
          });

          return {
            status: 200,
            body: this.buildResponse({
              entry,
              grade,
              objective,
              attemptCount,
              hintLevel,
              before,
              after,
              masteredAfter,
            }),
          };
        });
        return response;
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
  ): Promise<void> {
    await this.audit.write({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'tutor.stuck_signal',
      targetType: 'tutor_session',
      targetId: session.sessionId,
      idempotencyKey: `${scope}:${idempotencyKey}`,
      detail: {
        trigger: 'l3_cap',
        quizId: entry.questionId,
        conceptId: entry.conceptId,
        sessionId: session.sessionId,
      },
    });
  }

  /**
   * L3 封顶 + 答错 = 卡点信号（ pedagogy-spec §7 ）。
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
  }): Promise<void> {
    await this.auditStuckSignal(
      input.actor,
      input.session,
      input.entry,
      input.scope,
      input.idempotencyKey,
    );
    if (this.stuckSignals === undefined) return;
    const projectId = input.session.projectId;
    if (projectId === null) return;
    const signal: StudentStuckSignal = {
      studentId: input.actor.id,
      projectId,
      planId: input.planId,
      sessionId: input.session.sessionId,
      stemNodeId: input.stemNodeId,
      conceptId: input.entry.conceptId,
      trigger: 'repeated_assessment_error',
      triggerKey: `l3_cap:${input.actor.id}:${input.entry.conceptId}`,
      errorTypeCode: input.errorType ?? 'repeated_wrong',
      nodeRefs: [input.stemNodeId],
      evidenceRefs: [input.attemptId],
      emittedAt: new Date().toISOString(),
    };
    try {
      await this.stuckSignals.ingest(signal);
    } catch {
      await this.audit.write({
        actorId: input.actor.id,
        actorRole: input.actor.role,
        action: 'tutor.stuck_signal.ingest_failed',
        targetType: 'tutor_session',
        targetId: input.session.sessionId,
        idempotencyKey: `${input.scope}:${input.idempotencyKey}:ingest`,
        detail: {
          quizId: input.entry.questionId,
          conceptId: input.entry.conceptId,
          stemNodeId: input.stemNodeId,
          triggerKey: signal.triggerKey,
        },
      });
    }
  }

  /* ==================== 内部：解析 / 掌握度 ==================== */

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
      hintsUsed: 0,
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
    return {
      quizId: entry.questionId,
      correct: grade.isCorrect,
      attempts: input.attemptCount,
      hintLevel: input.hintLevel,
      explanation: release ? entry.explanation : null,
      correctKeys: release ? [...entry.expectedKeys] : null,
      conceptDeltas: [{
        conceptId: entry.conceptId,
        before: input.before / 10_000,
        after: input.after,
        mastered: input.masteredAfter,
      }],
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
