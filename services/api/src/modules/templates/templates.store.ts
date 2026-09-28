import { randomUUID } from 'node:crypto';
import type {
  CreateTemplateInput,
  CreateTemplateVersionInput,
  ProjectTemplateRecord,
  ProjectTemplateVersionRecord,
  TemplateStatus,
  UpdateTemplateInput,
} from './templates.types';

/**
 * 模板库持久化边界。
 *
 * 服务层只依赖本抽象；`demo` / `test` 用内存实现，`live` 用 PostgreSQL 实现。
 * 作用域规则、状态机、验证评测全在纯函数/服务层，存储层不重复判定。
 */

export interface TemplateListFilter {
  status?: TemplateStatus;
  /** 精确匹配归属学校（`null` = 平台）。 */
  schoolId?: string | null;
  /** 可见性集合：`null` = 仅平台；否则 = 平台 ∪ 该校。 */
  visibleToSchoolId?: string | null;
}

export interface CreateTemplateRecordInput extends CreateTemplateInput {
  id: string;
  createdBy: string;
  now: Date;
}

export interface CreateVersionRecordInput extends CreateTemplateVersionInput {
  id: string;
  templateId: string;
  version: string;
  createdBy: string;
  now: Date;
}

/** 唯一约束冲突（slug / version）时抛出，由服务层转成幂等重放或 409。 */
export class TemplateStoreConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateStoreConflictError';
  }
}

export abstract class TemplateStore {
  abstract createTemplate(input: CreateTemplateRecordInput): Promise<ProjectTemplateRecord>;
  abstract findTemplate(id: string): Promise<ProjectTemplateRecord | null>;
  abstract findTemplateBySlug(
    schoolId: string | null,
    slug: string,
  ): Promise<ProjectTemplateRecord | null>;
  abstract listTemplates(filter: TemplateListFilter): Promise<ProjectTemplateRecord[]>;
  abstract updateTemplate(
    id: string,
    patch: UpdateTemplateInput,
    now: Date,
  ): Promise<ProjectTemplateRecord>;
  abstract setTemplateStatus(
    id: string,
    status: TemplateStatus,
    verifiedBy: string | null,
    verifiedAt: Date | null,
    now: Date,
  ): Promise<ProjectTemplateRecord>;

  abstract listVersions(templateId: string): Promise<ProjectTemplateVersionRecord[]>;
  abstract findVersion(versionId: string): Promise<ProjectTemplateVersionRecord | null>;
  abstract nextVersionLabel(templateId: string): Promise<string>;
  abstract createVersion(input: CreateVersionRecordInput): Promise<ProjectTemplateVersionRecord>;
  abstract setVersionStatus(
    versionId: string,
    status: TemplateStatus,
    publishedAt: Date | null,
    now: Date,
  ): Promise<ProjectTemplateVersionRecord>;
}

/* ============================ 内存实现 ============================ */

function cloneTemplate(record: ProjectTemplateRecord): ProjectTemplateRecord {
  return {
    ...record,
    requiredMaterials: [...record.requiredMaterials],
    learningObjectives: [...record.learningObjectives],
  };
}

function cloneVersion(record: ProjectTemplateVersionRecord): ProjectTemplateVersionRecord {
  return {
    ...record,
    stages: record.stages.map((stage) => ({ ...stage })),
    content: structuredClone(record.content),
    rubric: structuredClone(record.rubric),
  };
}

/**
 * 内存实现：仅用于 `demo` / `test`。
 *
 * 与 `InMemoryExplorationStore` 同思路——它不是 live 持久化；live 走
 * `PostgresTemplateStore`，未配置数据库时由存储工厂按数据模式决定。
 */
export class InMemoryTemplateStore extends TemplateStore {
  private readonly templates = new Map<string, ProjectTemplateRecord>();
  private readonly versions = new Map<string, ProjectTemplateVersionRecord>();

  async createTemplate(input: CreateTemplateRecordInput): Promise<ProjectTemplateRecord> {
    if (this.slugExists(input.schoolId, input.slug, null)) {
      throw new TemplateStoreConflictError(`模板 slug 已存在：${input.slug}`);
    }
    const record: ProjectTemplateRecord = {
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
      verifiedBy: null,
      verifiedAt: null,
      createdAt: input.now,
      updatedAt: input.now,
    };
    this.templates.set(record.id, record);
    return cloneTemplate(record);
  }

  async findTemplate(id: string): Promise<ProjectTemplateRecord | null> {
    const record = this.templates.get(id);
    return record === undefined ? null : cloneTemplate(record);
  }

  async findTemplateBySlug(
    schoolId: string | null,
    slug: string,
  ): Promise<ProjectTemplateRecord | null> {
    for (const record of this.templates.values()) {
      if (record.schoolId === schoolId && record.slug === slug) return cloneTemplate(record);
    }
    return null;
  }

  async listTemplates(filter: TemplateListFilter): Promise<ProjectTemplateRecord[]> {
    const out: ProjectTemplateRecord[] = [];
    for (const record of this.templates.values()) {
      if (filter.status !== undefined && record.status !== filter.status) continue;
      if (filter.schoolId !== undefined && record.schoolId !== filter.schoolId) continue;
      if (filter.visibleToSchoolId !== undefined) {
        const visible =
          record.schoolId === null || record.schoolId === filter.visibleToSchoolId;
        if (!visible) continue;
      }
      out.push(cloneTemplate(record));
    }
    out.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return out;
  }

  async updateTemplate(
    id: string,
    patch: UpdateTemplateInput,
    now: Date,
  ): Promise<ProjectTemplateRecord> {
    const record = this.templates.get(id);
    if (record === undefined) throw new Error(`template not found: ${id}`);
    applyTemplatePatch(record, patch);
    record.updatedAt = now;
    return cloneTemplate(record);
  }

  async setTemplateStatus(
    id: string,
    status: TemplateStatus,
    verifiedBy: string | null,
    verifiedAt: Date | null,
    now: Date,
  ): Promise<ProjectTemplateRecord> {
    const record = this.templates.get(id);
    if (record === undefined) throw new Error(`template not found: ${id}`);
    record.status = status;
    if (status === 'published') {
      record.verifiedBy = verifiedBy;
      record.verifiedAt = verifiedAt;
    }
    record.updatedAt = now;
    return cloneTemplate(record);
  }

  async listVersions(templateId: string): Promise<ProjectTemplateVersionRecord[]> {
    const out: ProjectTemplateVersionRecord[] = [];
    for (const record of this.versions.values()) {
      if (record.templateId === templateId) out.push(cloneVersion(record));
    }
    out.sort((a, b) => compareVersionLabels(a.version, b.version));
    return out;
  }

  async findVersion(versionId: string): Promise<ProjectTemplateVersionRecord | null> {
    const record = this.versions.get(versionId);
    return record === undefined ? null : cloneVersion(record);
  }

  async nextVersionLabel(templateId: string): Promise<string> {
    let max = 0;
    for (const record of this.versions.values()) {
      if (record.templateId !== templateId) continue;
      const parsed = parseVersionLabel(record.version);
      if (parsed > max) max = parsed;
    }
    return `v${max + 1}`;
  }

  async createVersion(input: CreateVersionRecordInput): Promise<ProjectTemplateVersionRecord> {
    for (const record of this.versions.values()) {
      if (record.templateId === input.templateId && record.version === input.version) {
        throw new TemplateStoreConflictError(
          `模板版本已存在：${input.templateId}@${input.version}`,
        );
      }
    }
    const record: ProjectTemplateVersionRecord = {
      id: input.id,
      templateId: input.templateId,
      version: input.version,
      stages: input.stages.map((stage) => ({ ...stage })),
      content: structuredClone(input.content ?? {}),
      rubric: structuredClone(input.rubric ?? []),
      status: 'draft',
      createdBy: input.createdBy,
      publishedAt: null,
      createdAt: input.now,
    };
    this.versions.set(record.id, record);
    return cloneVersion(record);
  }

  async setVersionStatus(
    versionId: string,
    status: TemplateStatus,
    publishedAt: Date | null,
    _now: Date,
  ): Promise<ProjectTemplateVersionRecord> {
    const record = this.versions.get(versionId);
    if (record === undefined) throw new Error(`version not found: ${versionId}`);
    record.status = status;
    if (status === 'published') record.publishedAt = publishedAt;
    return cloneVersion(record);
  }

  /** 测试辅助：清空内存状态。 */
  reset(): void {
    this.templates.clear();
    this.versions.clear();
  }

  private slugExists(schoolId: string | null, slug: string, exceptId: string | null): boolean {
    for (const record of this.templates.values()) {
      if (exceptId !== null && record.id === exceptId) continue;
      if (record.schoolId === schoolId && record.slug === slug) return true;
    }
    return false;
  }
}

function applyTemplatePatch(record: ProjectTemplateRecord, patch: UpdateTemplateInput): void {
  if (patch.title !== undefined) record.title = patch.title;
  if (patch.summary !== undefined) record.summary = patch.summary;
  if (patch.domain !== undefined) record.domain = patch.domain;
  if (patch.ageRange !== undefined) record.ageRange = patch.ageRange;
  if (patch.difficulty !== undefined) record.difficulty = patch.difficulty;
  if (patch.estimatedDurationMinutes !== undefined) {
    record.estimatedDurationMinutes = patch.estimatedDurationMinutes;
  }
  if (patch.requiredMaterials !== undefined) {
    record.requiredMaterials = [...patch.requiredMaterials];
  }
  if (patch.learningObjectives !== undefined) {
    record.learningObjectives = [...patch.learningObjectives];
  }
  if (patch.outcomeForm !== undefined) record.outcomeForm = patch.outcomeForm;
  if (patch.safetyNotes !== undefined) record.safetyNotes = patch.safetyNotes;
}

/** `v1` / `v12` → 数字；非法标签按 0 处理（防御脏数据）。 */
export function parseVersionLabel(label: string): number {
  const match = /^v(\d+)$/.exec(label.trim());
  if (match === null) return 0;
  const value = Number.parseInt(match[1] ?? '0', 10);
  return Number.isFinite(value) ? value : 0;
}

function compareVersionLabels(a: string, b: string): number {
  return parseVersionLabel(a) - parseVersionLabel(b);
}

/** 生成模板 id / 版本 id 的稳定前缀，便于日志与排障。 */
export function newTemplateId(): string {
  return `tpl-${randomUUID()}`;
}

export function newTemplateVersionId(): string {
  return `tplv-${randomUUID()}`;
}
