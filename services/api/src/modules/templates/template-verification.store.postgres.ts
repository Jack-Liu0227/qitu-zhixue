import { eq } from 'drizzle-orm';
import {
  templateVerificationEvidence,
  templateVerificationRuns,
  withTransaction,
  type Database,
} from '@qitu/database';
import type { VerificationCheckKey } from './templates.types';
import {
  TemplateVerificationStore,
  buildVerificationEvidenceRows,
  type RecordVerificationRunInput,
  type RecordVerificationRunResult,
  type VerificationEvidenceSourceKind,
  type VerificationRunEvidenceRecord,
  type VerificationRunRecord,
} from './template-verification.store';

type RunRow = typeof templateVerificationRuns.$inferSelect;
type RunInsert = typeof templateVerificationRuns.$inferInsert;
type EvidenceRow = typeof templateVerificationEvidence.$inferSelect;
type EvidenceInsert = typeof templateVerificationEvidence.$inferInsert;

/**
 * 模板验证 run / 证据的 live 持久化实现（迁移 0009）。
 *
 * - **只追加**：run 与证据行只有 insert，没有 update / delete；结论不可改写。
 * - **幂等**：唯一索引 `template_verification_runs_idempotency_unique_idx` 保证
 *   同键只落一条 run；命中时回读既有 run（含其证据行）并标记 `replayed`。
 * - **原子**：`withTransaction` 内先 `onConflictDoNothing` 插 run，未新写则不碰
 *   证据列（避免为既有 run 造出主键不匹配的孤儿证据），再统一回读。
 */
export class PostgresTemplateVerificationStore extends TemplateVerificationStore {
  readonly persistent = true;

  constructor(private readonly db: Database) {
    super();
  }

  async record(
    input: RecordVerificationRunInput,
  ): Promise<RecordVerificationRunResult> {
    return withTransaction(this.db, async (tx) => {
      const inserted = await tx
        .insert(templateVerificationRuns)
        .values(toVerificationRunInsert(input))
        .onConflictDoNothing({ target: templateVerificationRuns.idempotencyKey })
        .returning({ id: templateVerificationRuns.id });

      if (inserted.length > 0) {
        const evidenceRows = buildVerificationEvidenceRows(input).map(
          toVerificationEvidenceInsert,
        );
        if (evidenceRows.length > 0) {
          await tx
            .insert(templateVerificationEvidence)
            .values(evidenceRows)
            .onConflictDoNothing();
        }
      }

      const [row] = await tx
        .select()
        .from(templateVerificationRuns)
        .where(eq(templateVerificationRuns.idempotencyKey, input.idempotencyKey))
        .limit(1);
      if (row === undefined) {
        throw new Error(`模板验证 run 写入后无法回读：${input.idempotencyKey}`);
      }
      const evidenceRows = await tx
        .select()
        .from(templateVerificationEvidence)
        .where(eq(templateVerificationEvidence.runId, row.id));
      return {
        run: toVerificationRunRecord(row, evidenceRows),
        replayed: inserted.length === 0,
      };
    });
  }

  async findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<VerificationRunRecord | null> {
    const [row] = await this.db
      .select()
      .from(templateVerificationRuns)
      .where(eq(templateVerificationRuns.idempotencyKey, idempotencyKey))
      .limit(1);
    if (row === undefined) return null;
    const evidenceRows = await this.db
      .select()
      .from(templateVerificationEvidence)
      .where(eq(templateVerificationEvidence.runId, row.id));
    return toVerificationRunRecord(row, evidenceRows);
  }

  async listByVersion(templateVersionId: string): Promise<VerificationRunRecord[]> {
    const rows = await this.db
      .select()
      .from(templateVerificationRuns)
      .where(eq(templateVerificationRuns.templateVersionId, templateVersionId));
    const out: VerificationRunRecord[] = [];
    for (const row of rows) {
      const evidenceRows = await this.db
        .select()
        .from(templateVerificationEvidence)
        .where(eq(templateVerificationEvidence.runId, row.id));
      out.push(toVerificationRunRecord(row, evidenceRows));
    }
    out.sort((a, b) => a.evaluatedAt.getTime() - b.evaluatedAt.getTime());
    return out;
  }
}

/** 领域输入 → run 插入行（纯函数，便于无数据库单测）。 */
export function toVerificationRunInsert(input: RecordVerificationRunInput): RunInsert {
  return {
    id: input.id,
    schoolId: input.schoolId,
    templateVersionId: input.templateVersionId,
    passed: input.report.passed,
    checks: input.report.checks,
    evidenceRefs: input.report.evidenceRefs,
    evidenceCount: input.report.evidenceRefs.length,
    evaluatedBy: input.evaluatedBy,
    idempotencyKey: input.idempotencyKey,
    evaluatedAt: input.evaluatedAt,
  };
}

/** 领域证据行 → 插入行（纯函数）。 */
export function toVerificationEvidenceInsert(
  row: VerificationRunEvidenceRecord,
): EvidenceInsert {
  return {
    id: row.id,
    runId: row.runId,
    schoolId: row.schoolId,
    checkKey: row.checkKey,
    sourceKind: row.sourceKind,
    sourceId: row.sourceId,
    studentUserId: row.studentUserId,
    detail: row.detail,
    createdAt: row.createdAt,
  };
}

/** run 行 + 证据行 → 领域投影（纯函数）。 */
export function toVerificationRunRecord(
  row: RunRow,
  evidenceRows: readonly EvidenceRow[],
): VerificationRunRecord {
  return {
    id: row.id,
    schoolId: row.schoolId ?? null,
    templateVersionId: row.templateVersionId,
    passed: row.passed,
    report: {
      templateVersionId: row.templateVersionId,
      passed: row.passed,
      checks: row.checks as VerificationRunRecord['report']['checks'],
      evidenceRefs: [...(row.evidenceRefs ?? [])],
      evaluatedAt: row.evaluatedAt.toISOString(),
    },
    evidenceCount: row.evidenceCount,
    evaluatedBy: row.evaluatedBy ?? null,
    idempotencyKey: row.idempotencyKey,
    evaluatedAt: row.evaluatedAt,
    evidence: evidenceRows.map(toVerificationEvidenceRecord),
  };
}

/** 证据行 → 领域投影（纯函数）。 */
export function toVerificationEvidenceRecord(
  row: EvidenceRow,
): VerificationRunEvidenceRecord {
  return {
    id: row.id,
    runId: row.runId,
    schoolId: row.schoolId ?? null,
    checkKey: row.checkKey as VerificationCheckKey,
    sourceKind: row.sourceKind as VerificationEvidenceSourceKind,
    sourceId: row.sourceId,
    studentUserId: row.studentUserId ?? null,
    detail: row.detail ?? null,
    createdAt: row.createdAt,
  };
}
