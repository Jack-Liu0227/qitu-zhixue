import type { PblBindingStatus } from '@qitu/contracts';
import type { AuditTransaction } from '../../common/audit/audit.service';
import type {
  AffectedProjectRecord,
  BindingRecord,
  CreateBindingRecordInput,
  InsertSnapshotRecordInput,
  SnapshotRecord,
  TeamVersionRecord,
  UpdateTeachingBundleRecordInput,
} from './templates-binding.types';

/**
 * 绑定持久化边界。
 *
 * 服务层只依赖本抽象；`demo` / `test` 用内存实现，`live` 用 PostgreSQL 实现。
 * 状态机判定留在纯函数 / 服务层，存储层只做读与原子写。
 */
export abstract class TemplateBindingStore {
  abstract findTeamVersion(id: string): Promise<TeamVersionRecord | null>;
  abstract createBinding(input: CreateBindingRecordInput): Promise<BindingRecord>;
  abstract findBinding(id: string, tx?: AuditTransaction): Promise<BindingRecord | null>;
  abstract findActiveBinding(
    templateVersionId: string,
    tx?: AuditTransaction,
  ): Promise<BindingRecord | null>;
  /** 列出某模板版本的全部绑定（含非 active 状态），按创建时间升序。 */
  abstract listBindings(templateVersionId: string): Promise<BindingRecord[]>;
  abstract updateValidation(
    id: string,
    validation: BindingRecord['validation'],
    now: Date,
    expectedUpdatedAt?: Date,
  ): Promise<BindingRecord>;
  abstract updateTeachingBundle(
    id: string,
    input: UpdateTeachingBundleRecordInput,
  ): Promise<BindingRecord>;
  abstract setStatus(id: string, status: PblBindingStatus, now: Date, expectedUpdatedAt?: Date): Promise<BindingRecord>;
  /** 原子激活：先退役旧 active 行再置目标 active；并发双激活由局部唯一索引兜底。 */
  abstract activateBinding(
    templateVersionId: string,
    bindingId: string,
    now: Date,
    expectedUpdatedAt?: Date,
  ): Promise<BindingRecord>;
  abstract retireBinding(id: string, now: Date): Promise<BindingRecord>;
  /** `ON CONFLICT (project_id) DO NOTHING`——回填 / 冻结都幂等。 */
  abstract insertSnapshot(input: InsertSnapshotRecordInput, tx?: AuditTransaction): Promise<void>;
  abstract findSnapshot(projectId: string, tx?: AuditTransaction): Promise<SnapshotRecord | null>;
  /** Explicit audited recovery only; never replaces a complete formal snapshot. */
  abstract reconfirmLegacySnapshot(input: InsertSnapshotRecordInput, expected: SnapshotRecord | null, tx?: AuditTransaction): Promise<void>;
  abstract listAffectedProjects(templateVersionId: string): Promise<AffectedProjectRecord[]>;
}

/**
 * 并发双激活被局部唯一索引拒绝时抛出（23505 的绑定域翻译）。
 * 服务层映射为 `BINDING_CONFLICT`(409)。
 */
export class TemplateBindingStoreConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateBindingStoreConflictError';
  }
}

/* ============================ 内存实现 ============================ */

function cloneTeamVersion(record: TeamVersionRecord): TeamVersionRecord {
  return {
    ...record,
    members: [...record.members],
    pblSpec: structuredClone(record.pblSpec),
  };
}

function cloneBinding(record: BindingRecord): BindingRecord {
  return {
    ...record,
    bundleDraft: record.bundleDraft === null ? null : structuredClone(record.bundleDraft),
    bundlePayload: record.bundlePayload === null ? null : structuredClone(record.bundlePayload),
    validation: {
      ...record.validation,
      errors: [...record.validation.errors],
      warnings: [...record.validation.warnings],
    },
  };
}

function cloneSnapshot(record: SnapshotRecord): SnapshotRecord {
  return { ...record };
}

/**
 * 内存实现：仅用于 `demo` / `test`。
 *
 * 与 `InMemoryTemplateStore` 同思路——它不是 live 持久化；live 走
 * `PostgresTemplateBindingStore`，未配置数据库时由工厂按数据模式决定。
 */
export class InMemoryTemplateBindingStore extends TemplateBindingStore {
  private readonly teamVersions = new Map<string, TeamVersionRecord>();
  private readonly bindings = new Map<string, BindingRecord>();
  private readonly snapshots = new Map<string, SnapshotRecord>();
  private readonly affected = new Map<string, AffectedProjectRecord[]>();

  async findTeamVersion(id: string): Promise<TeamVersionRecord | null> {
    const record = this.teamVersions.get(id);
    return record === undefined ? null : cloneTeamVersion(record);
  }

  async createBinding(input: CreateBindingRecordInput): Promise<BindingRecord> {
    const record: BindingRecord = {
      id: input.id,
      templateVersionId: input.templateVersionId,
      teamVersionId: input.teamVersionId,
      status: 'draft',
      bindingHash: input.bindingHash,
      bundleDigest: input.bundleDigest ?? null,
      bundleDraft: null,
      bundlePayload: null,
      validation: { valid: false, errors: [], warnings: [], checkedAt: null },
      activatedAt: null,
      retiredAt: null,
      createdBy: input.createdBy,
      createdAt: input.now,
      updatedAt: input.now,
    };
    this.bindings.set(record.id, record);
    return cloneBinding(record);
  }

  async findBinding(id: string, _tx?: AuditTransaction): Promise<BindingRecord | null> {
    const record = this.bindings.get(id);
    return record === undefined ? null : cloneBinding(record);
  }

  async findActiveBinding(
    templateVersionId: string,
    _tx?: AuditTransaction,
  ): Promise<BindingRecord | null> {
    for (const record of this.bindings.values()) {
      if (record.templateVersionId === templateVersionId && record.status === 'active') {
        return cloneBinding(record);
      }
    }
    return null;
  }

  async listBindings(templateVersionId: string): Promise<BindingRecord[]> {
    const out: BindingRecord[] = [];
    for (const record of this.bindings.values()) {
      if (record.templateVersionId === templateVersionId) out.push(cloneBinding(record));
    }
    out.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return out;
  }

  async updateValidation(
    id: string,
    validation: BindingRecord['validation'],
    now: Date,
    expectedUpdatedAt?: Date,
  ): Promise<BindingRecord> {
    const record = this.bindings.get(id);
    if (record === undefined) throw new Error(`binding not found: ${id}`);
    if (expectedUpdatedAt && (record.updatedAt.getTime() !== expectedUpdatedAt.getTime() || record.status !== 'draft')) throw new TemplateBindingStoreConflictError('Binding changed during validation');
    record.validation = {
      ...validation,
      errors: [...validation.errors],
      warnings: [...validation.warnings],
    };
    record.updatedAt = now;
    return cloneBinding(record);
  }

  async updateTeachingBundle(
    id: string,
    input: UpdateTeachingBundleRecordInput,
  ): Promise<BindingRecord> {
    const record = this.bindings.get(id);
    if (record === undefined) throw new Error(`binding not found: ${id}`);
    if (record.status !== 'draft' || (input.expectedUpdatedAt && record.updatedAt.getTime() !== input.expectedUpdatedAt.getTime())) {
      throw new TemplateBindingStoreConflictError('只有 draft 绑定可以修改 Teaching Bundle');
    }
    record.bundleDraft = structuredClone(input.draft);
    record.bundlePayload = input.payload === null ? null : structuredClone(input.payload);
    record.bundleDigest = input.digest;
    record.validation = { valid: false, errors: [], warnings: [], checkedAt: null };
    if (input.bindingHash !== undefined) record.bindingHash = input.bindingHash;
    record.updatedAt = input.now;
    return cloneBinding(record);
  }

  async setStatus(id: string, status: PblBindingStatus, now: Date, expectedUpdatedAt?: Date): Promise<BindingRecord> {
    const record = this.bindings.get(id);
    if (record === undefined) throw new Error(`binding not found: ${id}`);
    if (expectedUpdatedAt && (record.updatedAt.getTime() !== expectedUpdatedAt.getTime() || record.status !== 'draft')) throw new TemplateBindingStoreConflictError('Binding changed during validation');
    record.status = status;
    record.updatedAt = now;
    return cloneBinding(record);
  }

  async activateBinding(
    templateVersionId: string,
    bindingId: string,
    now: Date,
    expectedUpdatedAt?: Date,
  ): Promise<BindingRecord> {
    // 模拟数据库事务：先退役旧 active 行，再置目标 active。
    const checked = this.bindings.get(bindingId);
    if (expectedUpdatedAt && (!checked || checked.status !== 'validated' || checked.updatedAt.getTime() !== expectedUpdatedAt.getTime())) throw new TemplateBindingStoreConflictError('Binding changed during activation');
    for (const record of this.bindings.values()) {
      if (
        record.templateVersionId === templateVersionId &&
        record.status === 'active' &&
        record.id !== bindingId
      ) {
        record.status = 'retired';
        record.retiredAt = now;
        record.updatedAt = now;
      }
    }
    const target = this.bindings.get(bindingId);
    if (target === undefined) throw new Error(`binding not found: ${bindingId}`);
    target.status = 'active';
    target.activatedAt = now;
    target.updatedAt = now;
    return cloneBinding(target);
  }

  async retireBinding(id: string, now: Date): Promise<BindingRecord> {
    const record = this.bindings.get(id);
    if (record === undefined) throw new Error(`binding not found: ${id}`);
    record.status = 'retired';
    record.retiredAt = now;
    record.updatedAt = now;
    return cloneBinding(record);
  }

  async insertSnapshot(input: InsertSnapshotRecordInput, _tx?: AuditTransaction): Promise<void> {
    if (this.snapshots.has(input.projectId)) return; // ON CONFLICT DO NOTHING
    this.snapshots.set(input.projectId, {
      projectId: input.projectId,
      templateVersionId: input.templateVersionId,
      bindingId: input.bindingId,
      teamVersionId: input.teamVersionId,
      bindingHash: input.bindingHash,
      bundleDigest: input.bundleDigest ?? null,
      boundAt: input.boundAt,
      backfilled: input.backfilled,
    });
  }

  async findSnapshot(projectId: string, _tx?: AuditTransaction): Promise<SnapshotRecord | null> {
    const record = this.snapshots.get(projectId);
    return record === undefined ? null : cloneSnapshot(record);
  }

  async reconfirmLegacySnapshot(input: InsertSnapshotRecordInput, expected: SnapshotRecord | null): Promise<void> {
    const current = this.snapshots.get(input.projectId) ?? null;
    if ((current === null) !== (expected === null) || current && expected && (
      current.bindingHash !== expected.bindingHash || current.bindingId !== expected.bindingId || current.teamVersionId !== expected.teamVersionId
      || current.templateVersionId !== expected.templateVersionId || current.backfilled !== expected.backfilled || current.bundleDigest !== expected.bundleDigest
      || (!current.backfilled && current.bundleDigest !== null))) {
      throw new TemplateBindingStoreConflictError('项目绑定已变化，请重新读取。');
    }
    this.snapshots.set(input.projectId, { ...input, bundleDigest: input.bundleDigest ?? null, backfilled: false });
  }

  async listAffectedProjects(templateVersionId: string): Promise<AffectedProjectRecord[]> {
    return [...(this.affected.get(templateVersionId) ?? [])].map((project) => ({ ...project }));
  }

  /* ============================ 测试辅助 ============================ */

  seedTeamVersion(record: TeamVersionRecord): void {
    this.teamVersions.set(record.id, cloneTeamVersion(record));
  }

  seedAffectedProjects(templateVersionId: string, projects: AffectedProjectRecord[]): void {
    this.affected.set(
      templateVersionId,
      projects.map((project) => ({ ...project })),
    );
  }

  reset(): void {
    this.teamVersions.clear();
    this.bindings.clear();
    this.snapshots.clear();
    this.affected.clear();
  }
}
