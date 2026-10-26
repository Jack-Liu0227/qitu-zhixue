import { assertResourceNameAvailable } from '../../common/resource-name';
import { randomUUID } from 'node:crypto';
import type { AuditTransaction } from '../../common/audit/audit.service';
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

/** Server-owned audit callback runs before the deletion transaction commits. */
export type TemplateDeleteCommit = (tx?: AuditTransaction) => Promise<void>;

export interface RestoreTemplateInput {
  expectedUpdatedAt: Date;
  createdBy: string;
  versionId: string;
  now: Date;
}

export interface RestoredTemplateRecord {
  template: ProjectTemplateRecord;
  version: ProjectTemplateVersionRecord | null;
  sourceVersionId: string | null;
}

export type TemplateRestoreCommit = (result: RestoredTemplateRecord, tx?: AuditTransaction) => Promise<void>;

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

export class TemplateRestoreConflictError extends TemplateStoreConflictError {}

export class TemplateDeleteProtectedError extends TemplateStoreConflictError {}

export function assertTemplateDeletable(status: TemplateStatus, versionStatuses: TemplateStatus[]): void {
  if (status === 'archived' || status === 'draft' && versionStatuses.every(value => value === 'draft')) return;
  throw new TemplateDeleteProtectedError('仅可删除未发布草稿或已归档课程，请先归档当前课程。');
}

/** Restore the parent for editing; historical version states and content remain frozen. */
export function prepareTemplateRestoration(template: ProjectTemplateRecord, versions: ProjectTemplateVersionRecord[], input: RestoreTemplateInput): RestoredTemplateRecord {
  if (template.status !== 'archived' || template.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) {
    throw new TemplateRestoreConflictError('课程状态已变化，请重新加载后再恢复。');
  }
  const source = versions.slice().sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    || parseVersionLabel(b.version) - parseVersionLabel(a.version))[0];
  const content = structuredClone(source?.content ?? {});
  delete content.bootstrapKey;
  return {
    template: { ...template, status: 'draft', verifiedBy: null, verifiedAt: null, updatedAt: input.now },
    sourceVersionId: source?.id ?? null,
    version: source ? {
      id: input.versionId, templateId: template.id,
      version: `v${Math.max(0, ...versions.map(entry => parseVersionLabel(entry.version))) + 1}`,
      stages: structuredClone(source.stages), content, rubric: structuredClone(source.rubric),
      status: 'draft', createdBy: input.createdBy, createdAt: input.now, publishedAt: null,
    } : null,
  };
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
  abstract deleteTemplate(id: string, beforeCommit?: TemplateDeleteCommit): Promise<boolean>;
  abstract restoreTemplate(id: string, input: RestoreTemplateInput, beforeCommit: TemplateRestoreCommit): Promise<RestoredTemplateRecord>;
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
  private readonly restoreLocks = new Set<string>();
  private readonly templates = new Map<string, ProjectTemplateRecord>();
  private readonly versions = new Map<string, ProjectTemplateVersionRecord>();

  async createTemplate(input: CreateTemplateRecordInput): Promise<ProjectTemplateRecord> {
    if (this.slugExists(input.schoolId, input.slug, null)) {
      throw new TemplateStoreConflictError(`模板 slug 已存在：${input.slug}`);
    }
    assertResourceNameAvailable('template', input.title, [...this.templates.values()]
      .filter(record => record.schoolId === input.schoolId).map(record => ({ id: record.id, name: record.title })));
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
    if (patch.title !== undefined) assertResourceNameAvailable('template', patch.title, [...this.templates.values()]
      .filter(entry => entry.schoolId === record.schoolId).map(entry => ({ id: entry.id, name: entry.title })), id);
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

  async deleteTemplate(id: string, beforeCommit?: TemplateDeleteCommit): Promise<boolean> {
    const template = this.templates.get(id);
    if (!template) return false;
    assertTemplateDeletable(template.status, (await this.listVersions(id)).map(version => version.status));
    await beforeCommit?.();
    this.templates.delete(id);
    for (const [vId, v] of this.versions.entries()) {
      if (v.templateId === id) this.versions.delete(vId);
    }
    return true;
  }

  async restoreTemplate(id: string, input: RestoreTemplateInput, beforeCommit: TemplateRestoreCommit): Promise<RestoredTemplateRecord> {
    if (this.restoreLocks.has(id)) throw new TemplateRestoreConflictError('课程正在恢复，请重新加载。');
    this.restoreLocks.add(id);
    try {
      const template = this.templates.get(id);
      if (!template) throw new TemplateRestoreConflictError('课程不存在或状态已变化，请重新加载。');
      const result = prepareTemplateRestoration(template, await this.listVersions(id), input);
      await beforeCommit(result);
      this.templates.set(id, cloneTemplate(result.template));
      if (result.version) this.versions.set(result.version.id, cloneVersion(result.version));
      return structuredClone(result);
    } finally { this.restoreLocks.delete(id); }
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
