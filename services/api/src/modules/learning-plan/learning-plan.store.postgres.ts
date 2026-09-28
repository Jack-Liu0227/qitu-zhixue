import { and, asc, eq } from 'drizzle-orm';
import {
  learningModules,
  learningObjectives,
  learningPlans,
  learningSessions,
  masteryAttempts,
  masteryRecords,
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
import {
  LearningPlanStore,
  LearningPlanStoreConflictError,
  type AttemptRecord,
  type ConfirmPlanInput,
  type ConfirmPlanResult,
  type LearningProjectRecord,
  type MasteryRecord,
  type ModuleRecord,
  type ObjectiveRecord,
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
type AttemptRow = typeof masteryAttempts.$inferSelect;
type ProjectRow = typeof projectsTable.$inferSelect;

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
  constructor(private readonly db: Database) {
    super();
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
        await ensureCurriculumTemplate(tx, bundle.plan.templateVersion);
        await tx.insert(learningPlans).values({
          id: bundle.plan.id,
          studentUserId: bundle.plan.studentUserId,
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
        studentUserId: record.studentUserId,
        planId: record.planId,
        objectiveId: record.objectiveId,
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
        updatedAt: record.updatedAt,
      })
      .onConflictDoUpdate({
        target: [masteryRecords.studentUserId, masteryRecords.objectiveId],
        set: {
          planId: record.planId,
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

function mapMastery(row: MasteryRow): MasteryRecord {
  return {
    id: row.id,
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
    updatedAt: row.updatedAt,
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
