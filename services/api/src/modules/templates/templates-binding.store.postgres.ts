import { and, eq, isNull, or } from 'drizzle-orm';
import {
  learningPlans,
  pblTemplateTeamBindings,
  projectBindingSnapshots,
  projects as projectsTable,
  withTransaction,
  type Database,
} from '@qitu/database';
import type { PblBindingStatus } from '@qitu/contracts';
import type { AuditTransaction } from '../../common/audit/audit.service';
import { TemplateBindingStore, TemplateBindingStoreConflictError } from './templates-binding.store';
import type {
  AffectedProjectRecord,
  BindingRecord,
  CreateBindingRecordInput,
  InsertSnapshotRecordInput,
  SnapshotRecord,
  TeamVersionRecord,
  UpdateTeachingBundleRecordInput,
} from './templates-binding.types';

const PG_UNIQUE_VIOLATION = '23505';

type BindingRow = typeof pblTemplateTeamBindings.$inferSelect;
type SnapshotRow = typeof projectBindingSnapshots.$inferSelect;

/**
 * live 持久化实现（F2 / F3）。
 *
 * - `activateBinding` 在事务里先退役旧 active 行再置目标 active；
 *   并发双激活由局部唯一索引
 *   `pbl_template_team_bindings_one_active_per_template_idx` 兜底（23505）。
 * - `insertSnapshot` 用 `ON CONFLICT (project_id) DO NOTHING`，冻结与回填都幂等。
 */
export class PostgresTemplateBindingStore extends TemplateBindingStore {
  constructor(private readonly db: Database) {
    super();
  }

  async findTeamVersion(id: string, bindingId?: string): Promise<TeamVersionRecord | null> {
    if (!bindingId) return null;
    const binding = await this.findBinding(bindingId);
    return binding?.teamSnapshots?.[id] ?? null;
  }

  async createBinding(input: CreateBindingRecordInput): Promise<BindingRecord> {
    try {
      const [row] = await this.db
        .insert(pblTemplateTeamBindings)
        .values({
          id: input.id,
          templateVersionId: input.templateVersionId,
          teamVersionId: input.teamVersionId,
          teamSnapshots: Object.fromEntries(Object.entries(input.teamSnapshots ?? {}).map(([id, team]) => [id, { ...team, createdAt: team.createdAt.toISOString() }])),
          status: 'draft',
          bindingHash: input.bindingHash,
          bundleDigest: input.bundleDigest,
          createdBy: input.createdBy,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .returning();
      if (row === undefined) throw new Error('插入绑定未返回数据行');
      return mapBinding(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new TemplateBindingStoreConflictError(`绑定已存在：${input.templateVersionId}`);
      }
      throw error;
    }
  }

  async findBinding(id: string, tx?: AuditTransaction): Promise<BindingRecord | null> {
    const executor = tx ?? this.db;
    const query = executor
      .select()
      .from(pblTemplateTeamBindings)
      .where(eq(pblTemplateTeamBindings.id, id))
      .limit(1);
    const [row] = await (tx ? query.for('share') : query);
    return row === undefined ? null : mapBinding(row);
  }

  async findActiveBinding(
    templateVersionId: string,
    tx?: AuditTransaction,
  ): Promise<BindingRecord | null> {
    const executor = tx ?? this.db;
    const query = executor
      .select()
      .from(pblTemplateTeamBindings)
      .where(
        and(
          eq(pblTemplateTeamBindings.templateVersionId, templateVersionId),
          eq(pblTemplateTeamBindings.status, 'active'),
        ),
      )
      .limit(1);
    const [row] = await (tx ? query.for('share') : query);
    return row === undefined ? null : mapBinding(row);
  }

  async listBindings(templateVersionId: string): Promise<BindingRecord[]> {
    const rows = await this.db
      .select()
      .from(pblTemplateTeamBindings)
      .where(eq(pblTemplateTeamBindings.templateVersionId, templateVersionId))
      .orderBy(pblTemplateTeamBindings.createdAt);
    return rows.map(mapBinding);
  }

  async updateValidation(
    id: string,
    validation: BindingRecord['validation'],
    now: Date,
    expectedUpdatedAt?: Date,
  ): Promise<BindingRecord> {
    const [row] = await this.db
      .update(pblTemplateTeamBindings)
      .set({ validation, updatedAt: now })
      .where(and(eq(pblTemplateTeamBindings.id, id),
        ...(expectedUpdatedAt ? [eq(pblTemplateTeamBindings.updatedAt, expectedUpdatedAt), eq(pblTemplateTeamBindings.status, 'draft')] : [])))
      .returning();
    if (row === undefined) throw new TemplateBindingStoreConflictError('Binding changed during validation');
    return mapBinding(row);
  }

  async updateTeachingBundle(
    id: string,
    input: UpdateTeachingBundleRecordInput,
  ): Promise<BindingRecord> {
    const [row] = await this.db
      .update(pblTemplateTeamBindings)
      .set({
        bundleDigest: input.digest,
        bundleDraft: input.draft as unknown as Record<string, unknown>,
        bundlePayload: input.payload as unknown as Record<string, unknown> | null,
        ...(input.bindingHash === undefined ? {} : { bindingHash: input.bindingHash }),
        // A bundle change invalidates a previous validation stamp.
        validation: { valid: false, errors: [], warnings: [], checkedAt: null },
        status: 'draft',
        updatedAt: input.now,
      })
      .where(and(
        eq(pblTemplateTeamBindings.id, id),
        eq(pblTemplateTeamBindings.status, 'draft'),
        ...(input.expectedUpdatedAt ? [eq(pblTemplateTeamBindings.updatedAt, input.expectedUpdatedAt)] : []),
      ))
      .returning();
    if (row === undefined) throw new TemplateBindingStoreConflictError('Teaching Bundle changed during compilation');
    return mapBinding(row);
  }

  async setStatus(id: string, status: PblBindingStatus, now: Date, expectedUpdatedAt?: Date): Promise<BindingRecord> {
    const [row] = await this.db
      .update(pblTemplateTeamBindings)
      .set({ status, updatedAt: now })
      .where(and(eq(pblTemplateTeamBindings.id, id),
        ...(expectedUpdatedAt ? [eq(pblTemplateTeamBindings.updatedAt, expectedUpdatedAt), eq(pblTemplateTeamBindings.status, 'draft')] : [])))
      .returning();
    if (row === undefined) throw new TemplateBindingStoreConflictError('Binding changed during validation');
    return mapBinding(row);
  }

  async activateBinding(
    templateVersionId: string,
    bindingId: string,
    now: Date,
    expectedUpdatedAt?: Date,
  ): Promise<BindingRecord> {
    try {
      return await withTransaction(this.db, async (tx) => {
        // 先退役旧 active 行（若有），再置目标 active。
        await tx
          .update(pblTemplateTeamBindings)
          .set({ status: 'retired', retiredAt: now, updatedAt: now })
          .where(
            and(
              eq(pblTemplateTeamBindings.templateVersionId, templateVersionId),
              eq(pblTemplateTeamBindings.status, 'active'),
            ),
          );

        const [row] = await tx
          .update(pblTemplateTeamBindings)
          .set({ status: 'active', activatedAt: now, updatedAt: now })
          .where(and(eq(pblTemplateTeamBindings.id, bindingId),
            ...(expectedUpdatedAt ? [eq(pblTemplateTeamBindings.updatedAt, expectedUpdatedAt), eq(pblTemplateTeamBindings.status, 'validated')] : [])))
          .returning();
        if (row === undefined) throw new TemplateBindingStoreConflictError('Binding changed during activation');
        return mapBinding(row);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new TemplateBindingStoreConflictError(
          `模板版本 ${templateVersionId} 已有 active 绑定（并发双激活被拒绝）`,
        );
      }
      throw error;
    }
  }

  async retireBinding(id: string, now: Date): Promise<BindingRecord> {
    const [row] = await this.db
      .update(pblTemplateTeamBindings)
      .set({ status: 'retired', retiredAt: now, updatedAt: now })
      .where(eq(pblTemplateTeamBindings.id, id))
      .returning();
    if (row === undefined) throw new Error(`binding not found: ${id}`);
    return mapBinding(row);
  }

  async insertSnapshot(input: InsertSnapshotRecordInput, tx?: AuditTransaction): Promise<void> {
    const executor = tx ?? this.db;
    await executor
      .insert(projectBindingSnapshots)
      .values({
        projectId: input.projectId,
        templateVersionId: input.templateVersionId,
        bindingId: input.bindingId,
        teamVersionId: input.teamVersionId,
        bindingHash: input.bindingHash,
        bundleDigest: input.bundleDigest,
        boundAt: input.boundAt,
        backfilled: input.backfilled,
      })
      .onConflictDoNothing({ target: projectBindingSnapshots.projectId });
  }

  async findSnapshot(projectId: string, tx?: AuditTransaction): Promise<SnapshotRecord | null> {
    const executor = tx ?? this.db;
    const [row] = await executor
      .select()
      .from(projectBindingSnapshots)
      .where(eq(projectBindingSnapshots.projectId, projectId))
      .limit(1);
    return row === undefined ? null : mapSnapshot(row);
  }

  async reconfirmLegacySnapshot(input: InsertSnapshotRecordInput, expected: SnapshotRecord | null, tx?: AuditTransaction): Promise<void> {
    const executor = tx ?? this.db;
    const values = { projectId: input.projectId, templateVersionId: input.templateVersionId, bindingId: input.bindingId,
      teamVersionId: input.teamVersionId, bindingHash: input.bindingHash, bundleDigest: input.bundleDigest,
      boundAt: input.boundAt, backfilled: false };
    const rows = expected === null
      ? await executor.insert(projectBindingSnapshots).values(values).onConflictDoNothing().returning({ id: projectBindingSnapshots.projectId })
      : await executor.update(projectBindingSnapshots).set(values).where(and(
        eq(projectBindingSnapshots.projectId, input.projectId), eq(projectBindingSnapshots.templateVersionId, expected.templateVersionId),
        eq(projectBindingSnapshots.bindingHash, expected.bindingHash), eq(projectBindingSnapshots.bindingId, expected.bindingId),
        eq(projectBindingSnapshots.teamVersionId, expected.teamVersionId),
        eq(projectBindingSnapshots.backfilled, expected.backfilled),
        expected.bundleDigest === null ? isNull(projectBindingSnapshots.bundleDigest) : eq(projectBindingSnapshots.bundleDigest, expected.bundleDigest),
        or(eq(projectBindingSnapshots.backfilled, true), isNull(projectBindingSnapshots.bundleDigest)),
      )).returning({ id: projectBindingSnapshots.projectId });
    if (!rows.length) throw new TemplateBindingStoreConflictError('项目绑定已变化，请重新读取。');
  }

  async listAffectedProjects(templateVersionId: string): Promise<AffectedProjectRecord[]> {
    const rows = await this.db
      .select({
        projectId: projectsTable.id,
        studentUserId: projectsTable.studentUserId,
        title: projectsTable.title,
        planId: learningPlans.id,
      })
      .from(projectsTable)
      .leftJoin(learningPlans, eq(learningPlans.projectId, projectsTable.id))
      .where(eq(projectsTable.templateVersionId, templateVersionId));
    return rows.map((row) => ({
      projectId: row.projectId,
      studentUserId: row.studentUserId,
      title: row.title,
      planId: row.planId,
    }));
  }
}

/* ============================ 行映射 ============================ */

function mapBinding(row: BindingRow): BindingRecord {
  const validation = row.validation ?? { valid: false, errors: [], warnings: [], checkedAt: null };
  return {
    id: row.id,
    templateVersionId: row.templateVersionId,
    teamVersionId: row.teamVersionId,
    status: row.status as BindingRecord['status'],
    bindingHash: row.bindingHash,
    bundleDigest: row.bundleDigest ?? null,
    teamSnapshots: Object.fromEntries(Object.entries(row.teamSnapshots ?? {}).map(([id, team]) => [id, { ...team, createdAt: new Date(team.createdAt) }])),
    bundleDraft: row.bundleDraft as BindingRecord['bundleDraft'],
    bundlePayload: row.bundlePayload as BindingRecord['bundlePayload'],
    validation: {
      valid: validation.valid,
      errors: [...(validation.errors ?? [])],
      warnings: [...(validation.warnings ?? [])],
      checkedAt: validation.checkedAt,
    },
    activatedAt: row.activatedAt,
    retiredAt: row.retiredAt,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapSnapshot(row: SnapshotRow): SnapshotRecord {
  return {
    projectId: row.projectId,
    templateVersionId: row.templateVersionId,
    bindingId: row.bindingId,
    teamVersionId: row.teamVersionId,
    bindingHash: row.bindingHash,
    bundleDigest: row.bundleDigest ?? null,
    boundAt: row.boundAt,
    backfilled: row.backfilled,
  };
}

function isUniqueViolation(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return code === PG_UNIQUE_VIOLATION;
}
