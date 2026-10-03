import { computeStageProgress } from '../projects/intent-confirmation.state-machine';
import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';
import type { AuditTransaction } from '../../common/audit/audit.service';
import {
  learningModules,
  learningObjectives,
  learningPlans,
  learningSessions,
  masteryAttempts,
  masteryEvents,
  masteryObjectiveMappings,
  masteryRecords,
  users,
  pendingQuestions,
  projectTemplateVersions,
  projectTemplates,
  projects as projectsTable,
  withTransaction,
  type Database,
} from '@qitu/database';
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
import {
  LearningPlanStore,
  planObjectiveMappings,
  LearningPlanStoreConflictError,
  PendingQuestionConflictError,
  type AttemptRecord,
  type CompleteAssessmentInput,
  type CompletePendingQuestionInput,
  type ConfirmPlanInput,
  type ConfirmPlanResult,
  type LearningProjectRecord,
  type MasteryEventRecord,
  type MasteryObjectiveMappingRecord,
  type MasteryRecord,
  type ModuleRecord,
  type ObjectiveRecord,
  type PendingQuestionRecord,
  type PlanBundle,
  type PlanRecord,
  type SessionRecord,
} from './learning-plan.store';
import { CURRICULUM_TEMPLATE_VERSION } from './plan-generator';

const PG_UNIQUE_VIOLATION = '23505';

/** 计划模板的宿主行 id（平台共享）。`template_version_id` 冻结引用它的某个版本。 */
const CURRICULUM_TEMPLATE_ID = 'tpl-curriculum-plan';

type PlanRow = typeof learningPlans.$inferSelect;
type ModuleRow = typeof learningModules.$inferSelect;
type ObjectiveRow = typeof learningObjectives.$inferSelect;
type SessionRow = typeof learningSessions.$inferSelect;
type MasteryRow = typeof masteryRecords.$inferSelect;
type MasteryEventRow = typeof masteryEvents.$inferSelect;
type MasteryMappingRow = typeof masteryObjectiveMappings.$inferSelect;
type AttemptRow = typeof masteryAttempts.$inferSelect;
type ProjectRow = typeof projectsTable.$inferSelect;
type PendingQuestionRow = typeof pendingQuestions.$inferSelect;

/**
 * live 持久化实现，映射迁移 0008 的六张表。
 *
 * 两个必须在该层保证的不变式：
 * 1. `confirmPlan` 在事务内 `SELECT ... FOR UPDATE` 锁住计划行，再条件创建项目，
 *    保证「一个计划只创建一个项目」即使并发不同幂等键也成立；
 * 2. 计划结构（模块 / 目标 / 会话）只在 `createPlan` 写入，确认后不再改写。
 *
 * `learning_plans.template_version_id` 有外键约束，而迁移里没有任何课程模板种子，
 * 因此本实现在事务内 `ensureCurriculumTemplate` 幂等 upsert 一行平台共享模板 +
 * 版本（version 即 `CURRICULUM_TEMPLATE_VERSION`）。这是本切片与模板治理模块的
 * 明确交接点。
 */
export class PostgresLearningPlanStore extends LearningPlanStore {
  constructor(private readonly db: Database, private readonly assessmentTransaction = false) {
    super();
  }

  async transitionProject(studentId: string, projectId: string, expected: ProjectStage, next: ProjectStage, commit: (tx?: AuditTransaction) => Promise<void>): Promise<boolean> {
    return this.commitAssessment(async (tx) => {
      const rows = await tx.update(projectsTable).set({ status: next, ...computeStageProgress(next) }).where(and(
        eq(projectsTable.id, projectId), eq(projectsTable.studentUserId, studentId), eq(projectsTable.status, expected),
      )).returning({ id: projectsTable.id });
      if (!rows.length) return false;
      await commit(tx);
      return true;
    });
  }

  async studentSchoolId(studentId: string): Promise<string | null> {
    const [user] = await this.db.select({ schoolId: users.schoolId }).from(users).where(eq(users.id, studentId));
    if (!user) throw new Error('MASTERY_NOT_FOUND');
    return user.schoolId;
  }

  async findMasteryEvent(id: string): Promise<MasteryEventRecord | null> {
    const [row] = await this.db.select().from(masteryEvents).where(eq(masteryEvents.id, id)).limit(1);
    return row ? mapMasteryEvent(row) : null;
  }

  async commitMasteryEvaluation(event: MasteryEventRecord, projection: MasteryRecord | null, commit: (tx?: AuditTransaction) => Promise<void>): Promise<void> {
    await this.commitAssessment(async (tx) => {
      const scoped = new PostgresLearningPlanStore(tx as unknown as Database, true);
      await scoped.appendMasteryEvent(event);
      if (projection) await scoped.upsertMastery(projection);
      await commit(tx);
    });
  }

  async withAssessmentTransaction<T>(studentId: string, work: (store: LearningPlanStore) => Promise<T>): Promise<T> {
    return withTransaction(this.db, async (tx) => {
      // A student-wide lock also serializes gates spanning several theory objectives.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify(['mastery', studentId])}, 0))`);
      return work(new PostgresLearningPlanStore(tx as unknown as Database, true));
    });
  }

  private commitAssessment<T>(work: (tx: AuditTransaction) => Promise<T>): Promise<T> {
    return this.assessmentTransaction
      ? work(this.db as unknown as AuditTransaction)
      : withTransaction(this.db, work);
  }

  async findPlanBySignature(
    studentUserId: string,
    interest: string,
    weeks: 4 | 8,
    templateVersion: string,
  ): Promise<PlanBundle | null> {
    const [plan] = await this.db
      .select()
      .from(learningPlans)
      .where(
        and(
          eq(learningPlans.studentUserId, studentUserId),
          eq(learningPlans.interest, interest),
          eq(learningPlans.weeks, weeks),
          eq(learningPlans.templateVersionId, templateVersion),
        ),
      )
      .limit(1);
    if (plan === undefined) return null;
    return this.assembleBundle(this.db, plan);
  }

  async createPlan(bundle: PlanBundle): Promise<void> {
    try {
      await withTransaction(this.db, async (tx) => {
        const schoolId = await this.studentSchoolId(bundle.plan.studentUserId);
        await ensureCurriculumTemplate(tx, bundle.plan.templateVersion);
        await tx.insert(learningPlans).values({
          id: bundle.plan.id,
          studentUserId: bundle.plan.studentUserId,
          schoolId,
          projectId: null,
          interest: bundle.plan.interest,
          goal: bundle.plan.goal,
          weeks: bundle.plan.weeks,
          minutesPerSession: bundle.plan.minutesPerSession,
          templateVersionId: bundle.plan.templateVersion,
          status: bundle.plan.status,
          version: bundle.plan.version,
          idempotencyKey: bundle.plan.idempotencyKey,
          confirmedAt: null,
          completedAt: null,
          createdAt: bundle.plan.createdAt,
          updatedAt: bundle.plan.updatedAt,
        });
        if (bundle.modules.length > 0) {
          await tx.insert(learningModules).values(
            bundle.modules.map((module) => ({
              id: module.id,
              planId: module.planId,
              name: module.name,
              weekIndex: module.weekIndex,
              objective: module.objective,
              ordinal: module.ordinal,
            })),
          );
        }
        if (bundle.objectives.length > 0) {
          await tx.insert(learningObjectives).values(
            bundle.objectives.map((objective) => ({
              id: objective.id,
              planId: objective.planId,
              moduleId: objective.moduleId,
              name: objective.name,
              type: objective.type,
              objective: objective.objective,
              prerequisiteIds: [...objective.prerequisiteIds],
              ordinal: objective.ordinal,
            })),
          );
        }
        if (bundle.sessions.length > 0) {
          await tx.insert(learningSessions).values(
            bundle.sessions.map((session) => ({
              id: session.id,
              planId: session.planId,
              moduleId: session.moduleId,
              index: session.index,
              blocks: session.blocks,
              theoryObjectiveIds: [...session.theoryObjectiveIds],
              practiceObjectiveIds: [...session.practiceObjectiveIds],
              mode: session.mode,
            })),
          );
        }
        const mappings = planObjectiveMappings(bundle, schoolId);
        if (mappings.length) await tx.insert(masteryObjectiveMappings).values(mappings);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new LearningPlanStoreConflictError(
          `计划签名冲突：${bundle.plan.studentUserId}/${bundle.plan.interest}/${bundle.plan.weeks}`,
        );
      }
      throw error;
    }
  }

  async findPlan(planId: string): Promise<PlanRecord | null> {
    const [plan] = await this.db
      .select()
      .from(learningPlans)
      .where(eq(learningPlans.id, planId))
      .limit(1);
    return plan === undefined ? null : mapPlan(plan);
  }

  async findBundle(planId: string): Promise<PlanBundle | null> {
    const [plan] = await this.db
      .select()
      .from(learningPlans)
      .where(eq(learningPlans.id, planId))
      .limit(1);
    if (plan === undefined) return null;
    return this.assembleBundle(this.db, plan);
  }

  async listPlansByStudent(studentUserId: string): Promise<PlanRecord[]> {
    const rows = await this.db
      .select()
      .from(learningPlans)
      .where(eq(learningPlans.studentUserId, studentUserId));
    return rows.map(mapPlan).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async confirmPlan(input: ConfirmPlanInput): Promise<ConfirmPlanResult> {
    return withTransaction(this.db, async (tx) => {
      const [plan] = await tx
        .select()
        .from(learningPlans)
        .where(eq(learningPlans.id, input.planId))
        .for('update')
        .limit(1);
      if (plan === undefined) throw new Error(`learning plan not found: ${input.planId}`);

      if (plan.projectId !== null) {
        const [project] = await tx
          .select()
          .from(projectsTable)
          .where(eq(projectsTable.id, plan.projectId))
          .limit(1);
        if (project === undefined) throw new Error('计划引用的项目不存在（数据不一致）');
        return { plan: mapPlan(plan), project: mapProject(project), created: false };
      }

      await ensureCurriculumTemplate(tx, input.project.templateVersionId ?? CURRICULUM_TEMPLATE_VERSION);
      const [inserted] = await tx
        .insert(projectsTable)
        .values({
          id: input.project.id,
          studentUserId: input.project.studentId,
          templateVersionId: input.project.templateVersionId,
          sourceExplorationId: null,
          status: input.project.status,
          currentStageIndex: input.project.currentStageIndex,
          stageTotal: input.project.stageTotal,
          progressPercent: input.project.progressPercent,
          title: input.project.title,
          subtitle: input.project.subtitle,
          tags: [...input.project.tags],
          createdAt: input.now,
        })
        .returning();
      if (inserted === undefined) throw new Error('插入项目实例未返回数据行');

      const [updatedPlan] = await tx
        .update(learningPlans)
        .set({
          projectId: inserted.id,
          status: 'active',
          confirmedAt: input.now,
          updatedAt: input.now,
        })
        .where(and(eq(learningPlans.id, input.planId), eq(learningPlans.version, plan.version)))
        .returning();
      if (updatedPlan === undefined) throw new Error('确认计划时更新计划行失败');

      return { plan: mapPlan(updatedPlan), project: mapProject(inserted), created: true };
    });
  }

  async findProject(projectId: string): Promise<LearningProjectRecord | null> {
    const [project] = await this.db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .limit(1);
    return project === undefined ? null : mapProject(project);
  }

  async findSession(planId: string, sessionId: string): Promise<SessionRecord | null> {
    const [session] = await this.db
      .select()
      .from(learningSessions)
      .where(and(eq(learningSessions.planId, planId), eq(learningSessions.id, sessionId)))
      .limit(1);
    return session === undefined ? null : mapSession(session);
  }

  async listSessions(planId: string): Promise<SessionRecord[]> {
    const rows = await this.db
      .select()
      .from(learningSessions)
      .where(eq(learningSessions.planId, planId))
      .orderBy(asc(learningSessions.index));
    return rows.map(mapSession);
  }

  async findMastery(studentUserId: string, objectiveId: string): Promise<MasteryRecord | null> {
    const [record] = await this.db
      .select()
      .from(masteryRecords)
      .where(
        and(
          eq(masteryRecords.studentUserId, studentUserId),
          eq(masteryRecords.objectiveId, objectiveId),
        ),
      )
      .limit(1);
    return record === undefined ? null : mapMastery(record);
  }

  async listMasteryForPlan(studentUserId: string, planId: string): Promise<MasteryRecord[]> {
    const rows = await this.db
      .select()
      .from(masteryRecords)
      .where(
        and(eq(masteryRecords.studentUserId, studentUserId), eq(masteryRecords.planId, planId)),
      );
    return rows.map(mapMastery);
  }

  async upsertMastery(record: MasteryRecord): Promise<void> {
    await this.db
      .insert(masteryRecords)
      .values({
        id: record.id,
        schoolId: record.schoolId,
        studentUserId: record.studentUserId,
        planId: record.planId,
        objectiveId: record.objectiveId,
        knowledgePointId: record.knowledgePointId,
        courseVersion: record.courseVersion,
        knowledgeType: record.knowledgeType,
        status: record.status,
        masteryBasisPoints: record.masteryBasisPoints,
        thresholdBasisPoints: record.thresholdBasisPoints,
        qualitativeMastered: record.qualitativeMastered,
        consecutiveCorrect: record.consecutiveCorrect,
        consecutiveWrong: record.consecutiveWrong,
        intervalIndex: record.intervalIndex,
        nextReviewAt: record.nextReviewAt,
        reviewCount: record.reviewCount,
        lapseCount: record.lapseCount,
        sourceEventId: record.sourceEventId,
        sourceSequence: record.sourceSequence,
        assessmentVersion: record.assessmentVersion,
        validFrom: record.validFrom,
        updatedAt: record.updatedAt,
      })
      .onConflictDoUpdate({
        target: [masteryRecords.studentUserId, masteryRecords.objectiveId],
        set: {
          planId: record.planId,
          knowledgePointId: record.knowledgePointId,
          courseVersion: record.courseVersion,
          knowledgeType: record.knowledgeType,
          status: record.status,
          masteryBasisPoints: record.masteryBasisPoints,
          thresholdBasisPoints: record.thresholdBasisPoints,
          qualitativeMastered: record.qualitativeMastered,
          consecutiveCorrect: record.consecutiveCorrect,
          consecutiveWrong: record.consecutiveWrong,
          intervalIndex: record.intervalIndex,
          nextReviewAt: record.nextReviewAt,
          reviewCount: record.reviewCount,
          lapseCount: record.lapseCount,
          sourceEventId: record.sourceEventId,
          sourceSequence: record.sourceSequence,
          assessmentVersion: record.assessmentVersion,
          validFrom: record.validFrom,
          updatedAt: record.updatedAt,
        },
      });
  }

  async listAttempts(studentUserId: string, objectiveId: string): Promise<AttemptRecord[]> {
    const rows = await this.db
      .select()
      .from(masteryAttempts)
      .where(
        and(
          eq(masteryAttempts.studentUserId, studentUserId),
          eq(masteryAttempts.objectiveId, objectiveId),
        ),
      )
      .orderBy(asc(masteryAttempts.createdAt));
    return rows.map(mapAttempt);
  }

  async appendAttempt(attempt: AttemptRecord): Promise<void> {
    await this.db.insert(masteryAttempts).values({
      id: attempt.id,
      studentUserId: attempt.studentUserId,
      planId: attempt.planId,
      objectiveId: attempt.objectiveId,
      questionId: attempt.questionId,
      result: attempt.result,
      isCorrect: attempt.isCorrect,
      assessmentType: attempt.assessmentType,
      errorType: attempt.errorType,
      hintsUsed: attempt.hintsUsed,
      attemptCount: attempt.attemptCount,
      qualityBasisPoints: attempt.qualityBasisPoints,
      userAnswer: attempt.userAnswer,
      createdAt: attempt.createdAt,
    });
  }

  async completeAssessment(input: CompleteAssessmentInput): Promise<void> {
    await this.commitAssessment(async (tx) => {
      await tx.insert(masteryAttempts).values({
        id: input.attempt.id,
        studentUserId: input.attempt.studentUserId,
        planId: input.attempt.planId,
        objectiveId: input.attempt.objectiveId,
        questionId: input.attempt.questionId,
        result: input.attempt.result,
        isCorrect: input.attempt.isCorrect,
        assessmentType: input.attempt.assessmentType,
        errorType: input.attempt.errorType,
        hintsUsed: input.attempt.hintsUsed,
        attemptCount: input.attempt.attemptCount,
        qualityBasisPoints: input.attempt.qualityBasisPoints,
        userAnswer: input.attempt.userAnswer,
        createdAt: input.attempt.createdAt,
      });
      await tx.insert(masteryRecords).values({
        id: input.mastery.id,
        studentUserId: input.mastery.studentUserId,
        planId: input.mastery.planId,
        objectiveId: input.mastery.objectiveId,
        knowledgePointId: input.mastery.knowledgePointId ?? null,
        courseVersion: input.mastery.courseVersion ?? null,
        knowledgeType: input.mastery.knowledgeType,
        status: input.mastery.status,
        masteryBasisPoints: input.mastery.masteryBasisPoints,
        thresholdBasisPoints: input.mastery.thresholdBasisPoints,
        qualitativeMastered: input.mastery.qualitativeMastered,
        consecutiveCorrect: input.mastery.consecutiveCorrect,
        consecutiveWrong: input.mastery.consecutiveWrong,
        intervalIndex: input.mastery.intervalIndex,
        nextReviewAt: input.mastery.nextReviewAt,
        reviewCount: input.mastery.reviewCount,
        lapseCount: input.mastery.lapseCount,
        sourceEventId: input.mastery.sourceEventId ?? null,
        sourceSequence: input.mastery.sourceSequence ?? null,
        assessmentVersion: input.mastery.assessmentVersion ?? null,
        validFrom: input.mastery.validFrom ?? null,
        updatedAt: input.mastery.updatedAt,
      }).onConflictDoUpdate({
        target: [masteryRecords.studentUserId, masteryRecords.objectiveId],
        set: {
          planId: input.mastery.planId,
          knowledgePointId: input.mastery.knowledgePointId ?? null,
          courseVersion: input.mastery.courseVersion ?? null,
          knowledgeType: input.mastery.knowledgeType,
          status: input.mastery.status,
          masteryBasisPoints: input.mastery.masteryBasisPoints,
          thresholdBasisPoints: input.mastery.thresholdBasisPoints,
          qualitativeMastered: input.mastery.qualitativeMastered,
          consecutiveCorrect: input.mastery.consecutiveCorrect,
          consecutiveWrong: input.mastery.consecutiveWrong,
          intervalIndex: input.mastery.intervalIndex,
          nextReviewAt: input.mastery.nextReviewAt,
          reviewCount: input.mastery.reviewCount,
          lapseCount: input.mastery.lapseCount,
          sourceEventId: input.mastery.sourceEventId ?? null,
          sourceSequence: input.mastery.sourceSequence ?? null,
          assessmentVersion: input.mastery.assessmentVersion ?? null,
          validFrom: input.mastery.validFrom ?? null,
          updatedAt: input.mastery.updatedAt,
        },
      });
      if (input.masteryEvent !== null) {
        await tx.insert(masteryEvents).values({
          id: input.masteryEvent.id,
          schoolId: input.masteryEvent.schoolId,
          studentUserId: input.masteryEvent.studentId,
          knowledgePointId: input.masteryEvent.knowledgePointId,
          courseVersion: input.masteryEvent.courseVersion,
          objectiveId: input.masteryEvent.objectiveId,
          planId: input.masteryEvent.planId,
          projectId: input.masteryEvent.projectId,
          eventType: input.masteryEvent.eventType,
          knowledgeType: input.masteryEvent.knowledgeType,
          scoreBasisPoints: input.masteryEvent.score === null ? null : Math.round(input.masteryEvent.score * 10_000),
          confidenceBasisPoints: input.masteryEvent.confidence === null ? null : Math.round(input.masteryEvent.confidence * 10_000),
          qualitativeMastered: input.masteryEvent.qualitativeMastered,
          validFrom: input.masteryEvent.validFrom,
          recordedAt: input.masteryEvent.recordedAt,
          sequence: input.masteryEvent.sequence,
          evidenceRefs: [...input.masteryEvent.evidenceRefs],
          sourceType: input.masteryEvent.sourceType,
          sourceEventId: input.masteryEvent.sourceEventId,
          causationId: input.masteryEvent.causationId,
          correlationId: input.masteryEvent.correlationId,
          supersedesEventId: input.masteryEvent.supersedesEventId,
          assessmentVersion: input.masteryEvent.assessmentVersion,
          idempotencyKey: input.masteryEvent.idempotencyKey,
          createdAt: input.masteryEvent.recordedAt,
        });
      }
      if (input.commit !== undefined) await input.commit(tx);
    });
  }

  async appendMasteryEvent(event: MasteryEventRecord): Promise<void> {
    await this.db.insert(masteryEvents).values({
      id: event.id,
      schoolId: event.schoolId,
      studentUserId: event.studentId,
      knowledgePointId: event.knowledgePointId,
      courseVersion: event.courseVersion,
      objectiveId: event.objectiveId,
      planId: event.planId,
      projectId: event.projectId,
      eventType: event.eventType,
      knowledgeType: event.knowledgeType,
      scoreBasisPoints: event.score === null ? null : Math.round(event.score * 10_000),
      confidenceBasisPoints: event.confidence === null ? null : Math.round(event.confidence * 10_000),
      qualitativeMastered: event.qualitativeMastered,
      validFrom: event.validFrom,
      recordedAt: event.recordedAt,
      sequence: event.sequence,
      evidenceRefs: [...event.evidenceRefs],
      sourceType: event.sourceType,
      sourceEventId: event.sourceEventId,
      causationId: event.causationId,
      correlationId: event.correlationId,
      supersedesEventId: event.supersedesEventId,
      assessmentVersion: event.assessmentVersion,
      idempotencyKey: event.idempotencyKey,
      createdAt: event.recordedAt,
    });
  }

  async findMasteryEventByIdempotency(idempotencyKey: string): Promise<MasteryEventRecord | null> {
    const [row] = await this.db.select().from(masteryEvents).where(eq(masteryEvents.idempotencyKey, idempotencyKey)).limit(1);
    return row === undefined ? null : mapMasteryEvent(row);
  }

  async listMasteryEvents(input: {
    studentUserId: string;
    knowledgePointId?: string | null;
    courseVersion?: string | null;
    validFrom?: Date | null;
    validTo?: Date | null;
    recordedAt?: Date | null;
  }): Promise<MasteryEventRecord[]> {
    const rows = await this.db.select().from(masteryEvents).where(and(
      eq(masteryEvents.studentUserId, input.studentUserId),
      ...(input.knowledgePointId ? [eq(masteryEvents.knowledgePointId, input.knowledgePointId)] : []),
      ...(input.courseVersion ? [eq(masteryEvents.courseVersion, input.courseVersion)] : []),
      ...(input.validFrom ? [gte(masteryEvents.validFrom, input.validFrom)] : []),
      ...(input.validTo ? [lte(masteryEvents.validFrom, input.validTo)] : []),
      ...(input.recordedAt ? [lte(masteryEvents.recordedAt, input.recordedAt)] : []),
    )).orderBy(asc(masteryEvents.validFrom), asc(masteryEvents.sequence));
    return rows.map(mapMasteryEvent);
  }

  async findObjectiveMapping(input: {
    planId: string;
    objectiveId: string;
    templateVersion: string;
    contentVersion: string;
  }): Promise<MasteryObjectiveMappingRecord | null> {
    const [row] = await this.db.select().from(masteryObjectiveMappings).where(and(
      eq(masteryObjectiveMappings.planId, input.planId),
      eq(masteryObjectiveMappings.objectiveId, input.objectiveId),
      eq(masteryObjectiveMappings.templateVersion, input.templateVersion),
      eq(masteryObjectiveMappings.contentVersion, input.contentVersion),
    )).limit(1);
    return row === undefined ? null : mapMasteryMapping(row);
  }

  async upsertObjectiveMapping(mapping: MasteryObjectiveMappingRecord): Promise<void> {
    await this.db.insert(masteryObjectiveMappings).values({
      id: mapping.id,
      schoolId: mapping.schoolId,
      planId: mapping.planId,
      objectiveId: mapping.objectiveId,
      templateVersion: mapping.templateVersion,
      contentVersion: mapping.contentVersion,
      knowledgePointId: mapping.knowledgePointId,
      courseVersion: mapping.courseVersion,
      source: mapping.source,
      mappedAt: mapping.mappedAt,
    }).onConflictDoUpdate({
      target: [
        masteryObjectiveMappings.planId,
        masteryObjectiveMappings.objectiveId,
        masteryObjectiveMappings.templateVersion,
        masteryObjectiveMappings.contentVersion,
      ],
      set: {
        knowledgePointId: mapping.knowledgePointId,
        courseVersion: mapping.courseVersion,
        source: mapping.source,
        mappedAt: mapping.mappedAt,
      },
    });
  }

  /* -------- 迁移 0009：pending_questions -------- */

  async findAwaitingQuestion(
    studentUserId: string,
    planId: string,
  ): Promise<PendingQuestionRecord | null> {
    const [row] = await this.db
      .select()
      .from(pendingQuestions)
      .where(
        and(
          eq(pendingQuestions.studentUserId, studentUserId),
          eq(pendingQuestions.planId, planId),
          eq(pendingQuestions.status, 'awaiting'),
        ),
      )
      .limit(1);
    return row === undefined ? null : mapPendingQuestion(row);
  }

  async findPendingQuestion(questionId: string): Promise<PendingQuestionRecord | null> {
    const [row] = await this.db
      .select()
      .from(pendingQuestions)
      .where(eq(pendingQuestions.id, questionId))
      .limit(1);
    return row === undefined ? null : mapPendingQuestion(row);
  }

  async createPendingQuestion(record: PendingQuestionRecord): Promise<void> {
    try {
      await this.db.insert(pendingQuestions).values({
        id: record.id,
        schoolId: record.schoolId,
        studentUserId: record.studentUserId,
        planId: record.planId,
        sessionId: record.sessionId,
        objectiveId: record.objectiveId,
        questionType: record.questionType,
        prompt: record.prompt,
        options: record.options.map((option) => ({ ...option })),
        expectedAnswer: record.expectedAnswer,
        explanation: record.explanation,
        difficulty: record.difficulty,
        assessmentType: record.assessmentType,
        status: record.status,
        attempt: record.attempt,
        hintsUsed: record.hintsUsed,
        idempotencyKey: record.idempotencyKey,
        askedAt: record.askedAt,
        answeredAt: record.answeredAt,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new PendingQuestionConflictError(
          `同一 (student, plan) 已存在未答题或 id 冲突：${record.id}`,
        );
      }
      throw error;
    }
  }

  async completePendingQuestion(input: CompletePendingQuestionInput): Promise<boolean> {
    return this.commitAssessment(async (tx) => {
      const claimed = await tx
        .update(pendingQuestions)
        .set({ status: 'answered', answeredAt: input.answeredAt, updatedAt: input.answeredAt })
        .where(
          and(
            eq(pendingQuestions.id, input.questionId),
            eq(pendingQuestions.status, 'awaiting'),
          ),
        )
        .returning({ id: pendingQuestions.id });
      if (claimed.length === 0) return false;

      await tx.insert(masteryAttempts).values({
        id: input.attempt.id,
        studentUserId: input.attempt.studentUserId,
        planId: input.attempt.planId,
        objectiveId: input.attempt.objectiveId,
        questionId: input.attempt.questionId,
        result: input.attempt.result,
        isCorrect: input.attempt.isCorrect,
        assessmentType: input.attempt.assessmentType,
        errorType: input.attempt.errorType,
        hintsUsed: input.attempt.hintsUsed,
        attemptCount: input.attempt.attemptCount,
        qualityBasisPoints: input.attempt.qualityBasisPoints,
        userAnswer: input.attempt.userAnswer,
        createdAt: input.attempt.createdAt,
      });
      await tx
        .insert(masteryRecords)
        .values({
          id: input.mastery.id,
          studentUserId: input.mastery.studentUserId,
          planId: input.mastery.planId,
          objectiveId: input.mastery.objectiveId,
          knowledgePointId: input.mastery.knowledgePointId ?? null,
          courseVersion: input.mastery.courseVersion ?? null,
          knowledgeType: input.mastery.knowledgeType,
          status: input.mastery.status,
          masteryBasisPoints: input.mastery.masteryBasisPoints,
          thresholdBasisPoints: input.mastery.thresholdBasisPoints,
          qualitativeMastered: input.mastery.qualitativeMastered,
          consecutiveCorrect: input.mastery.consecutiveCorrect,
          consecutiveWrong: input.mastery.consecutiveWrong,
          intervalIndex: input.mastery.intervalIndex,
          nextReviewAt: input.mastery.nextReviewAt,
          reviewCount: input.mastery.reviewCount,
          lapseCount: input.mastery.lapseCount,
          sourceEventId: input.mastery.sourceEventId ?? null,
          sourceSequence: input.mastery.sourceSequence ?? null,
          assessmentVersion: input.mastery.assessmentVersion ?? null,
          validFrom: input.mastery.validFrom ?? null,
          updatedAt: input.mastery.updatedAt,
        })
        .onConflictDoUpdate({
          target: [masteryRecords.studentUserId, masteryRecords.objectiveId],
          set: {
            planId: input.mastery.planId,
            knowledgePointId: input.mastery.knowledgePointId ?? null,
            courseVersion: input.mastery.courseVersion ?? null,
            knowledgeType: input.mastery.knowledgeType,
            status: input.mastery.status,
            masteryBasisPoints: input.mastery.masteryBasisPoints,
            thresholdBasisPoints: input.mastery.thresholdBasisPoints,
            qualitativeMastered: input.mastery.qualitativeMastered,
            consecutiveCorrect: input.mastery.consecutiveCorrect,
            consecutiveWrong: input.mastery.consecutiveWrong,
            intervalIndex: input.mastery.intervalIndex,
            nextReviewAt: input.mastery.nextReviewAt,
            reviewCount: input.mastery.reviewCount,
            lapseCount: input.mastery.lapseCount,
            sourceEventId: input.mastery.sourceEventId ?? null,
            sourceSequence: input.mastery.sourceSequence ?? null,
            assessmentVersion: input.mastery.assessmentVersion ?? null,
            validFrom: input.mastery.validFrom ?? null,
            updatedAt: input.mastery.updatedAt,
          },
        });
      if (input.masteryEvent !== null) {
        await tx.insert(masteryEvents).values({
          id: input.masteryEvent.id,
          schoolId: input.masteryEvent.schoolId,
          studentUserId: input.masteryEvent.studentId,
          knowledgePointId: input.masteryEvent.knowledgePointId,
          courseVersion: input.masteryEvent.courseVersion,
          objectiveId: input.masteryEvent.objectiveId,
          planId: input.masteryEvent.planId,
          projectId: input.masteryEvent.projectId,
          eventType: input.masteryEvent.eventType,
          knowledgeType: input.masteryEvent.knowledgeType,
          scoreBasisPoints:
            input.masteryEvent.score === null ? null : Math.round(input.masteryEvent.score * 10_000),
          confidenceBasisPoints:
            input.masteryEvent.confidence === null
              ? null
              : Math.round(input.masteryEvent.confidence * 10_000),
          qualitativeMastered: input.masteryEvent.qualitativeMastered,
          validFrom: input.masteryEvent.validFrom,
          recordedAt: input.masteryEvent.recordedAt,
          sequence: input.masteryEvent.sequence,
          evidenceRefs: [...input.masteryEvent.evidenceRefs],
          sourceType: input.masteryEvent.sourceType,
          sourceEventId: input.masteryEvent.sourceEventId,
          causationId: input.masteryEvent.causationId,
          correlationId: input.masteryEvent.correlationId,
          supersedesEventId: input.masteryEvent.supersedesEventId,
          assessmentVersion: input.masteryEvent.assessmentVersion,
          idempotencyKey: input.masteryEvent.idempotencyKey,
          createdAt: input.masteryEvent.recordedAt,
        });
      }
      if (input.commit !== undefined) await input.commit(tx);
      return true;
    });
  }


  async markPendingQuestionAnswered(questionId: string, answeredAt: Date): Promise<boolean> {
    const rows = await this.db
      .update(pendingQuestions)
      .set({ status: 'answered', answeredAt, updatedAt: answeredAt })
      .where(and(eq(pendingQuestions.id, questionId), eq(pendingQuestions.status, 'awaiting')))
      .returning({ id: pendingQuestions.id });
    return rows.length > 0;
  }

  private async assembleBundle(executor: Database, plan: PlanRow): Promise<PlanBundle> {
    const modules = await executor
      .select()
      .from(learningModules)
      .where(eq(learningModules.planId, plan.id))
      .orderBy(asc(learningModules.ordinal));
    const objectives = await executor
      .select()
      .from(learningObjectives)
      .where(eq(learningObjectives.planId, plan.id))
      .orderBy(asc(learningObjectives.ordinal));
    const sessions = await executor
      .select()
      .from(learningSessions)
      .where(eq(learningSessions.planId, plan.id))
      .orderBy(asc(learningSessions.index));
    return {
      plan: mapPlan(plan),
      modules: modules.map(mapModule),
      objectives: objectives.map(mapObjective),
      sessions: sessions.map(mapSession),
    };
  }
}

async function ensureCurriculumTemplate(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  templateVersion: string,
): Promise<void> {
  await tx
    .insert(projectTemplates)
    .values({
      id: CURRICULUM_TEMPLATE_ID,
      schoolId: null,
      slug: 'curriculum-plan',
      title: '4/8 周学习计划课程模板',
      summary: '兴趣 → 4/8 周计划的平台共享课程模板（理论学习 + 实践交替）。',
      status: 'published',
    })
    .onConflictDoNothing({ target: projectTemplates.id });
  await tx
    .insert(projectTemplateVersions)
    .values({
      id: templateVersion,
      templateId: CURRICULUM_TEMPLATE_ID,
      version: templateVersion,
      stages: [],
      content: {},
      rubric: [],
      status: 'published',
    })
    .onConflictDoNothing({ target: projectTemplateVersions.id });
}

function mapPlan(row: PlanRow): PlanRecord {
  return {
    id: row.id,
    studentUserId: row.studentUserId,
    projectId: row.projectId,
    interest: row.interest,
    goal: row.goal,
    weeks: row.weeks === 8 ? 8 : 4,
    minutesPerSession: row.minutesPerSession,
    templateVersion: row.templateVersionId ?? CURRICULUM_TEMPLATE_VERSION,
    status: row.status as LearningPlanStatus,
    version: row.version,
    idempotencyKey: row.idempotencyKey,
    confirmedAt: row.confirmedAt,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapModule(row: ModuleRow): ModuleRecord {
  return {
    id: row.id,
    planId: row.planId,
    name: row.name,
    weekIndex: row.weekIndex,
    objective: row.objective,
    ordinal: row.ordinal,
  };
}

function mapObjective(row: ObjectiveRow): ObjectiveRecord {
  return {
    id: row.id,
    planId: row.planId,
    moduleId: row.moduleId,
    name: row.name,
    type: row.type as KnowledgeType,
    objective: row.objective,
    prerequisiteIds: row.prerequisiteIds ?? [],
    ordinal: row.ordinal,
  };
}

function mapSession(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    planId: row.planId,
    moduleId: row.moduleId,
    index: row.index,
    blocks: (row.blocks as SessionBlock[]) ?? [],
    theoryObjectiveIds: row.theoryObjectiveIds ?? [],
    practiceObjectiveIds: row.practiceObjectiveIds ?? [],
    mode: row.mode as SessionMode,
  };
}

function mapPendingQuestion(row: PendingQuestionRow): PendingQuestionRecord {
  return {
    id: row.id,
    schoolId: row.schoolId,
    studentUserId: row.studentUserId,
    planId: row.planId,
    sessionId: row.sessionId,
    objectiveId: row.objectiveId,
    questionType: row.questionType as QuestionKind,
    prompt: row.prompt,
    options: (row.options ?? []).map((option) => ({ ...option })),
    expectedAnswer: row.expectedAnswer,
    explanation: row.explanation,
    difficulty: (row.difficulty as QuestionDifficulty | null) ?? null,
    assessmentType: row.assessmentType as PendingQuestionRecord['assessmentType'],
    status: row.status as PendingQuestionRecord['status'],
    attempt: row.attempt,
    hintsUsed: row.hintsUsed,
    idempotencyKey: row.idempotencyKey,
    askedAt: row.askedAt,
    answeredAt: row.answeredAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapMastery(row: MasteryRow): MasteryRecord {
  return {
    id: row.id,
    schoolId: row.schoolId,
    studentUserId: row.studentUserId,
    planId: row.planId,
    objectiveId: row.objectiveId,
    knowledgeType: row.knowledgeType as KnowledgeType,
    status: row.status as ObjectiveStatus,
    masteryBasisPoints: row.masteryBasisPoints,
    thresholdBasisPoints: row.thresholdBasisPoints,
    qualitativeMastered: row.qualitativeMastered,
    consecutiveCorrect: row.consecutiveCorrect,
    consecutiveWrong: row.consecutiveWrong,
    intervalIndex: row.intervalIndex,
    nextReviewAt: row.nextReviewAt,
    reviewCount: row.reviewCount,
    lapseCount: row.lapseCount,
    knowledgePointId: row.knowledgePointId,
    courseVersion: row.courseVersion,
    sourceEventId: row.sourceEventId,
    sourceSequence: row.sourceSequence,
    assessmentVersion: row.assessmentVersion,
    validFrom: row.validFrom,
    updatedAt: row.updatedAt,
  };
}

function mapMasteryEvent(row: MasteryEventRow): MasteryEventRecord {
  return {
    id: row.id,
    schoolId: row.schoolId,
    studentId: row.studentUserId,
    knowledgePointId: row.knowledgePointId,
    courseVersion: row.courseVersion,
    objectiveId: row.objectiveId,
    planId: row.planId,
    projectId: row.projectId,
    eventType: row.eventType as MasteryEventRecord['eventType'],
    knowledgeType: row.knowledgeType as KnowledgeType,
    score: row.scoreBasisPoints === null ? null : row.scoreBasisPoints / 10_000,
    confidence: row.confidenceBasisPoints === null ? null : row.confidenceBasisPoints / 10_000,
    qualitativeMastered: row.qualitativeMastered,
    validFrom: row.validFrom,
    recordedAt: row.recordedAt,
    sequence: row.sequence,
    evidenceRefs: row.evidenceRefs ?? [],
    sourceType: row.sourceType as MasteryEventRecord['sourceType'],
    sourceEventId: row.sourceEventId,
    causationId: row.causationId,
    correlationId: row.correlationId,
    supersedesEventId: row.supersedesEventId,
    assessmentVersion: row.assessmentVersion,
    idempotencyKey: row.idempotencyKey,
  };
}

function mapMasteryMapping(row: MasteryMappingRow): MasteryObjectiveMappingRecord {
  return {
    id: row.id,
    schoolId: row.schoolId,
    planId: row.planId,
    objectiveId: row.objectiveId,
    templateVersion: row.templateVersion,
    contentVersion: row.contentVersion,
    knowledgePointId: row.knowledgePointId,
    courseVersion: row.courseVersion,
    source: row.source as MasteryObjectiveMappingRecord['source'],
    mappedAt: row.mappedAt,
  };
}

function mapAttempt(row: AttemptRow): AttemptRecord {
  return {
    id: row.id,
    studentUserId: row.studentUserId,
    planId: row.planId,
    objectiveId: row.objectiveId,
    questionId: row.questionId,
    result: row.result as GradeValue,
    isCorrect: row.isCorrect,
    assessmentType: row.assessmentType as AttemptRecord['assessmentType'],
    errorType: row.errorType as LearningErrorType | null,
    hintsUsed: row.hintsUsed,
    attemptCount: row.attemptCount,
    qualityBasisPoints: row.qualityBasisPoints,
    userAnswer: row.userAnswer,
    createdAt: row.createdAt,
  };
}

function mapProject(row: ProjectRow): LearningProjectRecord {
  return {
    id: row.id,
    studentId: row.studentUserId,
    templateVersionId: row.templateVersionId,
    status: row.status as ProjectStage,
    currentStageIndex: row.currentStageIndex,
    stageTotal: row.stageTotal,
    progressPercent: row.progressPercent,
    title: row.title,
    subtitle: row.subtitle,
    tags: row.tags ?? [],
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  };
}

function isUniqueViolation(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  return (error as { code?: unknown }).code === PG_UNIQUE_VIOLATION;
}
