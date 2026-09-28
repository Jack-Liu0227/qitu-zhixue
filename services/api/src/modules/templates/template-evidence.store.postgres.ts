import { and, eq, inArray, or } from 'drizzle-orm';
import {
  learningObjectives,
  learningPlans,
  masteryRecords,
  mentorReviews,
  projects,
  users,
  type Database,
} from '@qitu/database';
import type { VerificationEvidence } from './templates.types';
import {
  TemplateEvidenceSource,
  TemplateViewerDirectory,
  emptyEvidence,
} from './template-evidence.store';
import {
  PRACTICE_KNOWLEDGE_TYPES,
  THEORY_KNOWLEDGE_TYPES,
} from './template-verification.evaluator';

/**
 * 生产证据聚合：只读 `packages/database` 已迁移的领域表。
 *
 * 证据聚合查询（自上而下）：
 * 1. `projects`：`template_version_id = :v AND status = 'completed'` → 已完成项目；
 * 2. `learning_plans`：`project_id IN (...) OR template_version_id = :v` → 关联计划；
 * 3. `learning_objectives`：`plan_id IN (...)`，按 `type` 分理论/实践；
 * 4. `mastery_records`：`(student_user_id, objective_id)` 中 `status = 'mastered'`；
 * 5. `mentor_reviews`：`project_id IN (...) AND status = 'approved'`，
 *    `kind = 'artifact'` → 作品通过；`kind = 'project'` → 项目复核通过。
 *
 * 本查询**从不写库、从不重算掌握度**：`status` 是掌握度引擎的唯一输出。
 */
export class PostgresTemplateEvidenceSource extends TemplateEvidenceSource {
  constructor(private readonly db: Database) {
    super();
  }

  async collect(templateVersionId: string): Promise<VerificationEvidence> {
    const completed = await this.db
      .select({ id: projects.id, studentUserId: projects.studentUserId })
      .from(projects)
      .where(
        and(
          eq(projects.templateVersionId, templateVersionId),
          eq(projects.status, 'completed'),
        ),
      );
    if (completed.length === 0) return emptyEvidence(templateVersionId);

    const projectIds = completed.map((project) => project.id);

    const plans = await this.db
      .select({ id: learningPlans.id, studentUserId: learningPlans.studentUserId })
      .from(learningPlans)
      .where(
        or(
          inArray(learningPlans.projectId, projectIds),
          eq(learningPlans.templateVersionId, templateVersionId),
        ),
      );
    const planIds = plans.map((plan) => plan.id);

    const objectives =
      planIds.length === 0
        ? []
        : await this.db
            .select({ id: learningObjectives.id, type: learningObjectives.type })
            .from(learningObjectives)
            .where(inArray(learningObjectives.planId, planIds));

    const objectiveIds = objectives.map((objective) => objective.id);
    const studentIds = [
      ...new Set([
        ...completed.map((project) => project.studentUserId),
        ...plans.map((plan) => plan.studentUserId),
      ]),
    ];

    const masteries =
      objectiveIds.length === 0 || studentIds.length === 0
        ? []
        : await this.db
            .select({
              objectiveId: masteryRecords.objectiveId,
              status: masteryRecords.status,
            })
            .from(masteryRecords)
            .where(
              and(
                inArray(masteryRecords.objectiveId, objectiveIds),
                inArray(masteryRecords.studentUserId, studentIds),
              ),
            );

    const masteredObjectiveIds = new Set(
      masteries.filter((row) => row.status === 'mastered').map((row) => row.objectiveId),
    );

    const toEvidence = (objective: { id: string; type: string }) => ({
      objectiveId: objective.id,
      knowledgeType: objective.type,
      mastered: masteredObjectiveIds.has(objective.id),
    });

    const reviews = await this.db
      .select({ id: mentorReviews.id, kind: mentorReviews.kind })
      .from(mentorReviews)
      .where(
        and(
          inArray(mentorReviews.projectId, projectIds),
          eq(mentorReviews.status, 'approved'),
        ),
      );

    return {
      templateVersionId,
      completedProjectIds: projectIds,
      theoryObjectives: objectives
        .filter((objective) => THEORY_KNOWLEDGE_TYPES.includes(objective.type))
        .map(toEvidence),
      practiceObjectives: objectives
        .filter((objective) => PRACTICE_KNOWLEDGE_TYPES.includes(objective.type))
        .map(toEvidence),
      artifactAcceptedRefs: reviews
        .filter((review) => review.kind === 'artifact')
        .map((review) => review.id),
      mentorApprovalRefs: reviews
        .filter((review) => review.kind === 'project')
        .map((review) => review.id),
    };
  }
}

/** 生产视角目录：只读 `users.school_id`。 */
export class PostgresTemplateViewerDirectory extends TemplateViewerDirectory {
  constructor(private readonly db: Database) {
    super();
  }

  async findSchoolId(userId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ schoolId: users.schoolId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row?.schoolId ?? null;
  }
}
