import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  artifacts,
  consultationRequests,
  projects,
  projectTemplates,
  projectTemplateVersions,
  schools,
  users,
  type Database,
} from '@qitu/database';
import type {
  ConsultationRecord,
  CreateConsultationRecordInput,
  PublicHomeStatsRecord,
  PublicTemplateRecord,
} from './public-content.types';
import {
  PublicContentStore,
  PublicContentStoreConflictError,
} from './public-content.store';

const PG_UNIQUE_VIOLATION = '23505';

/**
 * 公开首页的作品计数口径：只统计**已发布**且可见范围**超出班级**的作品。
 *
 * `student_private` / `mentor_visible` / `class` 都不计入公开数字——公开首页
 * 不能因为「有个数字更好看」而把未成年人未公开的作品算进去（AGENTS.md
 * 「涉及未成年人数据时默认最小化可见范围」）。
 */
const PUBLIC_WORK_VISIBILITIES = ['school', 'public'] as const;

/**
 * `live` 持久化实现。
 *
 * 只读查询，全部走已建索引：
 * - 计数：`users`(role) / `schools`(status) / `project_templates`(status, school_id)
 *   / `artifacts`(status, visibility)；
 * - 展厅：平台模板 + 该模板最新已发布版本 + 参与人数分组聚合，
 *   共 3 条查询（不做 N+1），模板数量受 `limit` 限制。
 */
export class PostgresPublicContentStore extends PublicContentStore {
  constructor(private readonly db: Database) {
    super();
  }

  async readHomeStats(): Promise<PublicHomeStatsRecord> {
    const [learnerRow, schoolRow, templateRow, workRow] = await Promise.all([
      this.db
        .select({ value: sql<number>`count(*)`.mapWith(Number) })
        .from(users)
        .where(and(eq(users.role, 'student'), isNull(users.disabledAt))),
      this.db
        .select({ value: sql<number>`count(*)`.mapWith(Number) })
        .from(schools)
        .where(eq(schools.status, 'active')),
      this.db
        .select({ value: sql<number>`count(*)`.mapWith(Number) })
        .from(projectTemplates)
        .where(and(eq(projectTemplates.status, 'published'), isNull(projectTemplates.schoolId))),
      this.db
        .select({ value: sql<number>`count(*)`.mapWith(Number) })
        .from(artifacts)
        .where(
          and(
            eq(artifacts.status, 'published'),
            inArray(artifacts.visibility, [...PUBLIC_WORK_VISIBILITIES]),
          ),
        ),
    ]);

    return {
      learners: learnerRow[0]?.value ?? 0,
      schools: schoolRow[0]?.value ?? 0,
      publishedTemplates: templateRow[0]?.value ?? 0,
      publishedWorks: workRow[0]?.value ?? 0,
    };
  }

  async listFeaturedTemplates(limit: number): Promise<PublicTemplateRecord[]> {
    const templateRows = await this.db
      .select({
        id: projectTemplates.id,
        slug: projectTemplates.slug,
        title: projectTemplates.title,
        summary: projectTemplates.summary,
        domain: projectTemplates.domain,
        ageRange: projectTemplates.ageRange,
        difficulty: projectTemplates.difficulty,
        estimatedDurationMinutes: projectTemplates.estimatedDurationMinutes,
        outcomeForm: projectTemplates.outcomeForm,
        learningObjectives: projectTemplates.learningObjectives,
      })
      .from(projectTemplates)
      .where(and(eq(projectTemplates.status, 'published'), isNull(projectTemplates.schoolId)))
      .orderBy(desc(projectTemplates.updatedAt))
      .limit(limit);

    if (templateRows.length === 0) {
      return [];
    }
    const templateIds = templateRows.map((row) => row.id);

    // 与 `TemplatesService` 的「当前版本 = 已发布版本里最新的一条」保持一致。
    const versionRows = await this.db
      .select({
        templateId: projectTemplateVersions.templateId,
        version: projectTemplateVersions.version,
        stages: projectTemplateVersions.stages,
        publishedAt: projectTemplateVersions.publishedAt,
        createdAt: projectTemplateVersions.createdAt,
      })
      .from(projectTemplateVersions)
      .where(
        and(
          inArray(projectTemplateVersions.templateId, templateIds),
          eq(projectTemplateVersions.status, 'published'),
        ),
      )
      .orderBy(desc(projectTemplateVersions.createdAt));

    const latestVersion = new Map<string, (typeof versionRows)[number]>();
    for (const row of versionRows) {
      if (!latestVersion.has(row.templateId)) {
        latestVersion.set(row.templateId, row);
      }
    }

    // 参与人数：按模板分组去重计数（同一学生的多个项目只算一次）。
    const participantRows = await this.db
      .select({
        templateId: projectTemplateVersions.templateId,
        value: sql<number>`count(distinct ${projects.studentUserId})`.mapWith(Number),
      })
      .from(projects)
      .innerJoin(
        projectTemplateVersions,
        eq(projectTemplateVersions.id, projects.templateVersionId),
      )
      .where(inArray(projectTemplateVersions.templateId, templateIds))
      .groupBy(projectTemplateVersions.templateId);

    const participants = new Map(participantRows.map((row) => [row.templateId, row.value]));

    return templateRows.map((row) => {
      const version = latestVersion.get(row.id);
      return {
        id: row.id,
        slug: row.slug,
        title: row.title,
        summary: row.summary,
        domain: row.domain,
        ageRange: row.ageRange,
        difficulty: row.difficulty,
        estimatedDurationMinutes: row.estimatedDurationMinutes,
        outcomeForm: row.outcomeForm,
        learningObjectives: [...row.learningObjectives],
        stages: (version?.stages ?? []).map((stage) => ({ id: stage.id, label: stage.label })),
        version: version?.version ?? null,
        publishedAt: version?.publishedAt ?? null,
        participants: participants.get(row.id) ?? 0,
      } satisfies PublicTemplateRecord;
    });
  }

  async createConsultation(input: CreateConsultationRecordInput): Promise<ConsultationRecord> {
    try {
      const [row] = await this.db
        .insert(consultationRequests)
        .values({
          id: input.id,
          name: input.name,
          phone: input.phone,
          identity: input.identity,
          message: input.message,
          source: input.source,
          idempotencyKey: input.idempotencyKey,
          status: 'received',
          createdAt: input.now,
          updatedAt: input.now,
        })
        .returning();
      if (row === undefined) {
        throw new PublicContentStoreConflictError('consultation insert returned no row');
      }
      return toRecord(row);
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      // 唯一索引兜底：同一幂等键已落库，回读首次结果（不产生第二行）。
      const existing = await this.findConsultationByIdempotencyKey(input.idempotencyKey);
      if (existing === null) {
        throw new PublicContentStoreConflictError();
      }
      return existing;
    }
  }

  async findConsultationByIdempotencyKey(key: string): Promise<ConsultationRecord | null> {
    const [row] = await this.db
      .select()
      .from(consultationRequests)
      .where(eq(consultationRequests.idempotencyKey, key))
      .limit(1);
    return row === undefined ? null : toRecord(row);
  }
}

type ConsultationRow = typeof consultationRequests.$inferSelect;

function toRecord(row: ConsultationRow): ConsultationRecord {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    identity: row.identity as ConsultationRecord['identity'],
    message: row.message,
    status: row.status,
    source: row.source,
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === PG_UNIQUE_VIOLATION
  );
}
