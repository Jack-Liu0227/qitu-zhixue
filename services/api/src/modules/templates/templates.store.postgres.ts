import { and, asc, eq, isNull, or } from 'drizzle-orm';
import {
  projectTemplates,
  projectTemplateVersions,
  withTransaction,
  type Database,
  type ProjectTemplateStage,
} from '@qitu/database';
import type {
  ProjectTemplateRecord,
  ProjectTemplateVersionRecord,
  TemplateStatus,
  UpdateTemplateInput,
} from './templates.types';
import {
  TemplateStore,
  TemplateStoreConflictError,
  parseVersionLabel,
  type CreateTemplateRecordInput,
  type CreateVersionRecordInput,
  type TemplateListFilter,
} from './templates.store';

const PG_UNIQUE_VIOLATION = '23505';

type TemplateRow = typeof projectTemplates.$inferSelect;
type VersionRow = typeof projectTemplateVersions.$inferSelect;

/**
 * live 持久化实现：使用 `packages/database` 中已迁移的
 * `project_templates` / `project_template_versions` 两张表。
 *
 * 版本正文（`stages` / `content` / `rubric`）只在 `createVersion` 写入一次；
 * 本类**不提供**更新版本正文的方法，从存储层保证「发布后不可变」。
 */
export class PostgresTemplateStore extends TemplateStore {
  constructor(private readonly db: Database) {
    super();
  }

  async createTemplate(input: CreateTemplateRecordInput): Promise<ProjectTemplateRecord> {
    try {
      const [row] = await this.db
        .insert(projectTemplates)
        .values({
          id: input.id,
          schoolId: input.schoolId,
          slug: input.slug,
          title: input.title,
          summary: input.summary,
          domain: input.domain ?? null,
          ageRange: input.ageRange ?? null,
          difficulty: input.difficulty ?? null,
          estimatedDurationMinutes: input.estimatedDurationMinutes ?? null,
          requiredMaterials: [...(input.requiredMaterials ?? [])],
          learningObjectives: [...(input.learningObjectives ?? [])],
          outcomeForm: input.outcomeForm ?? null,
          safetyNotes: input.safetyNotes ?? null,
          status: 'draft',
          createdBy: input.createdBy,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .returning();
      if (row === undefined) throw new Error('插入模板未返回数据行');
      return mapTemplate(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new TemplateStoreConflictError(`模板 slug 已存在：${input.slug}`);
      }
      throw error;
    }
  }

  async findTemplate(id: string): Promise<ProjectTemplateRecord | null> {
    const [row] = await this.db
      .select()
      .from(projectTemplates)
      .where(eq(projectTemplates.id, id))
      .limit(1);
    return row === undefined ? null : mapTemplate(row);
  }

  async findTemplateBySlug(
    schoolId: string | null,
    slug: string,
  ): Promise<ProjectTemplateRecord | null> {
    const [row] = await this.db
      .select()
      .from(projectTemplates)
      .where(
        and(
          eq(projectTemplates.slug, slug),
          schoolId === null
            ? isNull(projectTemplates.schoolId)
            : eq(projectTemplates.schoolId, schoolId),
        ),
      )
      .limit(1);
    return row === undefined ? null : mapTemplate(row);
  }

  async listTemplates(filter: TemplateListFilter): Promise<ProjectTemplateRecord[]> {
    const conditions = [];
    if (filter.status !== undefined) {
      conditions.push(eq(projectTemplates.status, filter.status));
    }
    if (filter.schoolId !== undefined) {
      conditions.push(
        filter.schoolId === null
          ? isNull(projectTemplates.schoolId)
          : eq(projectTemplates.schoolId, filter.schoolId),
      );
    }
    if (filter.visibleToSchoolId !== undefined) {
      conditions.push(
        filter.visibleToSchoolId === null
          ? isNull(projectTemplates.schoolId)
          : or(
              isNull(projectTemplates.schoolId),
              eq(projectTemplates.schoolId, filter.visibleToSchoolId),
            ),
      );
    }
    const rows = await this.db
      .select()
      .from(projectTemplates)
      .where(conditions.length === 0 ? undefined : and(...conditions))
      .orderBy(asc(projectTemplates.createdAt));
    return rows.map(mapTemplate);
  }

  async updateTemplate(
    id: string,
    patch: UpdateTemplateInput,
    now: Date,
  ): Promise<ProjectTemplateRecord> {
    const set: Partial<typeof projectTemplates.$inferInsert> = { updatedAt: now };
    if (patch.title !== undefined) set.title = patch.title;
    if (patch.summary !== undefined) set.summary = patch.summary;
    if (patch.domain !== undefined) set.domain = patch.domain;
    if (patch.ageRange !== undefined) set.ageRange = patch.ageRange;
    if (patch.difficulty !== undefined) set.difficulty = patch.difficulty;
    if (patch.estimatedDurationMinutes !== undefined) {
      set.estimatedDurationMinutes = patch.estimatedDurationMinutes;
    }
    if (patch.requiredMaterials !== undefined) set.requiredMaterials = [...patch.requiredMaterials];
    if (patch.learningObjectives !== undefined) {
      set.learningObjectives = [...patch.learningObjectives];
    }
    if (patch.outcomeForm !== undefined) set.outcomeForm = patch.outcomeForm;
    if (patch.safetyNotes !== undefined) set.safetyNotes = patch.safetyNotes;

    const [row] = await this.db
      .update(projectTemplates)
      .set(set)
      .where(eq(projectTemplates.id, id))
      .returning();
    if (row === undefined) throw new Error(`template not found: ${id}`);
    return mapTemplate(row);
  }

  async setTemplateStatus(
    id: string,
    status: TemplateStatus,
    verifiedBy: string | null,
    verifiedAt: Date | null,
    now: Date,
  ): Promise<ProjectTemplateRecord> {
    const set: Partial<typeof projectTemplates.$inferInsert> = { status, updatedAt: now };
    if (status === 'published') {
      set.verifiedBy = verifiedBy;
      set.verifiedAt = verifiedAt;
    }
    const [row] = await this.db
      .update(projectTemplates)
      .set(set)
      .where(eq(projectTemplates.id, id))
      .returning();
    if (row === undefined) throw new Error(`template not found: ${id}`);
    return mapTemplate(row);
  }

  async listVersions(templateId: string): Promise<ProjectTemplateVersionRecord[]> {
    const rows = await this.db
      .select()
      .from(projectTemplateVersions)
      .where(eq(projectTemplateVersions.templateId, templateId));
    const mapped = rows.map(mapVersion);
    mapped.sort((a, b) => parseVersionLabel(a.version) - parseVersionLabel(b.version));
    return mapped;
  }

  async findVersion(versionId: string): Promise<ProjectTemplateVersionRecord | null> {
    const [row] = await this.db
      .select()
      .from(projectTemplateVersions)
      .where(eq(projectTemplateVersions.id, versionId))
      .limit(1);
    return row === undefined ? null : mapVersion(row);
  }

  async nextVersionLabel(templateId: string): Promise<string> {
    const rows = await this.db
      .select({ version: projectTemplateVersions.version })
      .from(projectTemplateVersions)
      .where(eq(projectTemplateVersions.templateId, templateId));
    let max = 0;
    for (const row of rows) {
      const parsed = parseVersionLabel(row.version);
      if (parsed > max) max = parsed;
    }
    return `v${max + 1}`;
  }

  async createVersion(input: CreateVersionRecordInput): Promise<ProjectTemplateVersionRecord> {
    try {
      return await withTransaction(this.db, async (tx) => {
        const [row] = await tx
          .insert(projectTemplateVersions)
          .values({
            id: input.id,
            templateId: input.templateId,
            version: input.version,
            stages: input.stages.map((stage) => ({ id: stage.id, label: stage.label })),
            content: input.content ?? {},
            rubric: input.rubric ?? [],
            status: 'draft',
            createdBy: input.createdBy,
            createdAt: input.now,
          })
          .returning();
        if (row === undefined) throw new Error('插入模板版本未返回数据行');
        return mapVersion(row);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new TemplateStoreConflictError(
          `模板版本已存在：${input.templateId}@${input.version}`,
        );
      }
      throw error;
    }
  }

  async setVersionStatus(
    versionId: string,
    status: TemplateStatus,
    publishedAt: Date | null,
    _now: Date,
  ): Promise<ProjectTemplateVersionRecord> {
    const set: Partial<typeof projectTemplateVersions.$inferInsert> = { status };
    if (status === 'published') set.publishedAt = publishedAt;
    const [row] = await this.db
      .update(projectTemplateVersions)
      .set(set)
      .where(eq(projectTemplateVersions.id, versionId))
      .returning();
    if (row === undefined) throw new Error(`version not found: ${versionId}`);
    return mapVersion(row);
  }
}

function mapTemplate(row: TemplateRow): ProjectTemplateRecord {
  return {
    id: row.id,
    schoolId: row.schoolId,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    domain: row.domain,
    ageRange: row.ageRange,
    difficulty: row.difficulty,
    estimatedDurationMinutes: row.estimatedDurationMinutes,
    requiredMaterials: row.requiredMaterials ?? [],
    learningObjectives: row.learningObjectives ?? [],
    outcomeForm: row.outcomeForm,
    safetyNotes: row.safetyNotes,
    status: row.status as TemplateStatus,
    createdBy: row.createdBy,
    verifiedBy: row.verifiedBy,
    verifiedAt: row.verifiedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapVersion(row: VersionRow): ProjectTemplateVersionRecord {
  const stages = (row.stages ?? []) as ProjectTemplateStage[];
  return {
    id: row.id,
    templateId: row.templateId,
    version: row.version,
    stages: stages.map((stage) => ({ id: stage.id, label: stage.label })),
    content: (row.content ?? {}) as Record<string, unknown>,
    rubric: (row.rubric ?? []) as unknown[],
    status: row.status as TemplateStatus,
    createdBy: row.createdBy,
    publishedAt: row.publishedAt,
    createdAt: row.createdAt,
  };
}

function isUniqueViolation(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  return (error as { code?: unknown }).code === PG_UNIQUE_VIOLATION;
}
