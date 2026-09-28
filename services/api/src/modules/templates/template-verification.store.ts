import { randomUUID } from 'node:crypto';
import type {
  VerificationCheckKey,
  VerificationEvidence,
  VerificationReport,
} from './templates.types';

/**
 * 模板验证运行 / 证据的持久化边界（迁移 0009）。
 *
 * 服务层只依赖本抽象：`verify` / `publish` 在评测后把**确定性报告**与
 * **不可变证据行**落库，供审计与重放。`demo` / `test` 用内存实现；`live` 用
 * `PostgresTemplateVerificationStore`。
 *
 * 硬约束：
 *  - **只追加**：接口有意不提供 update / delete；一次评测结论不可改写。
 *  - **幂等**：`idempotencyKey` 唯一，同键重放回读既有 run（`replayed=true`），
 *    不再落第二条，证据行亦不重复。
 *  - **服务端唯一来源**：`report` 由确定性纯函数算出、`evidence` 来自只读领域表；
 *    客户端没有任何写路径。
 */

/** 证据引用来源种类，对应迁移 0009 `source_kind`。 */
export type VerificationEvidenceSourceKind =
  | 'project'
  | 'objective'
  | 'artifact'
  | 'mentor_review';

/** `template_verification_evidence` 的领域投影。 */
export interface VerificationRunEvidenceRecord {
  id: string;
  runId: string;
  schoolId: string | null;
  /** 该证据支撑的检查项，对应 `report.checks[].key`。 */
  checkKey: VerificationCheckKey;
  sourceKind: VerificationEvidenceSourceKind;
  /** 被引用实体的不透明 id；不复制正文，避免未成年人数据二次暴露。 */
  sourceId: string;
  studentUserId: string | null;
  detail: string | null;
  createdAt: Date;
}

/** `template_verification_runs` + 其证据行的领域投影。 */
export interface VerificationRunRecord {
  id: string;
  schoolId: string | null;
  templateVersionId: string;
  passed: boolean;
  /** 由行内 `checks` / `evidence_refs` / `evaluated_at` 还原的不可变报告。 */
  report: VerificationReport;
  evidenceCount: number;
  evaluatedBy: string | null;
  idempotencyKey: string;
  evaluatedAt: Date;
  evidence: VerificationRunEvidenceRecord[];
}

export interface RecordVerificationRunInput {
  id: string;
  schoolId: string | null;
  templateVersionId: string;
  report: VerificationReport;
  /** 评测时的原始证据快照，用于派生结构化证据行。 */
  evidence: VerificationEvidence;
  evaluatedBy: string | null;
  idempotencyKey: string;
  evaluatedAt: Date;
}

export interface RecordVerificationRunResult {
  run: VerificationRunRecord;
  /** true 表示命中已存在的幂等键，本次未新写。 */
  replayed: boolean;
}

/** 检查项 → 证据来源种类。与评测器的 `evidenceRefs` 前缀一致。 */
export const EVIDENCE_SOURCE_KIND_BY_CHECK: Record<
  VerificationCheckKey,
  VerificationEvidenceSourceKind
> = {
  project_completed: 'project',
  theory_mastered: 'objective',
  practice_mastered: 'objective',
  artifact_accepted: 'artifact',
  mentor_approved: 'mentor_review',
};

/** 稳定的证据行 id：同一次 run 的同一事实重放时命中同一主键。 */
export function verificationEvidenceRowId(
  runId: string,
  checkKey: VerificationCheckKey,
  sourceKind: VerificationEvidenceSourceKind,
  sourceId: string,
): string {
  return `tve:${runId}:${checkKey}:${sourceKind}:${sourceId}`;
}

/**
 * 从证据快照派生不可变证据行（纯函数）。
 *
 * 每个事实只存 `sourceKind:opaqueId`，`detail` 留空——不复制被引用实体正文。
 * 顺序固定（项目 → 理论目标 → 实践目标 → 作品 → 复核），保证同输入同输出。
 */
export function buildVerificationEvidenceRows(
  input: RecordVerificationRunInput,
): VerificationRunEvidenceRecord[] {
  const rows: VerificationRunEvidenceRecord[] = [];
  const push = (
    checkKey: VerificationCheckKey,
    sourceKind: VerificationEvidenceSourceKind,
    sourceId: string,
  ): void => {
    rows.push({
      id: verificationEvidenceRowId(input.id, checkKey, sourceKind, sourceId),
      runId: input.id,
      schoolId: input.schoolId,
      checkKey,
      sourceKind,
      sourceId,
      studentUserId: null,
      detail: null,
      createdAt: input.evaluatedAt,
    });
  };

  for (const projectId of input.evidence.completedProjectIds) {
    push('project_completed', 'project', projectId);
  }
  for (const objective of input.evidence.theoryObjectives) {
    push('theory_mastered', 'objective', objective.objectiveId);
  }
  for (const objective of input.evidence.practiceObjectives) {
    push('practice_mastered', 'objective', objective.objectiveId);
  }
  for (const ref of input.evidence.artifactAcceptedRefs) {
    push('artifact_accepted', 'artifact', ref);
  }
  for (const ref of input.evidence.mentorApprovalRefs) {
    push('mentor_approved', 'mentor_review', ref);
  }
  return rows;
}

function cloneEvidenceRow(
  row: VerificationRunEvidenceRecord,
): VerificationRunEvidenceRecord {
  return { ...row };
}

export function cloneVerificationRunRecord(
  run: VerificationRunRecord,
): VerificationRunRecord {
  return {
    ...run,
    report: {
      ...run.report,
      checks: run.report.checks.map((check) => ({ ...check })),
      evidenceRefs: [...run.report.evidenceRefs],
    },
    evidence: run.evidence.map(cloneEvidenceRow),
  };
}

export abstract class TemplateVerificationStore {
  /** 是否连接了真正的持久化引擎。内存 fixture 实现为 `false`。 */
  abstract readonly persistent: boolean;

  /** 只追加一条 run；同 `idempotencyKey` 已存在时回读既有记录。 */
  abstract record(
    input: RecordVerificationRunInput,
  ): Promise<RecordVerificationRunResult>;

  /** 按幂等键回读（重启后重放 / 适配器测试）。 */
  abstract findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<VerificationRunRecord | null>;

  /** 读取某模板版本的全部 run（按评测时间）。 */
  abstract listByVersion(templateVersionId: string): Promise<VerificationRunRecord[]>;
}

/**
 * 内存实现：仅用于 `demo` / `test`。
 *
 * 不是 live 持久化；live 走 `PostgresTemplateVerificationStore`，未配置数据库时
 * 由模块工厂 fail fast。
 */
export class InMemoryTemplateVerificationStore extends TemplateVerificationStore {
  readonly persistent = false;

  private readonly byKey = new Map<string, VerificationRunRecord>();
  private readonly byId = new Map<string, VerificationRunRecord>();

  async record(
    input: RecordVerificationRunInput,
  ): Promise<RecordVerificationRunResult> {
    const existing = this.byKey.get(input.idempotencyKey);
    if (existing !== undefined) {
      return { run: cloneVerificationRunRecord(existing), replayed: true };
    }
    const record: VerificationRunRecord = {
      id: input.id,
      schoolId: input.schoolId,
      templateVersionId: input.templateVersionId,
      passed: input.report.passed,
      report: {
        ...input.report,
        checks: input.report.checks.map((check) => ({ ...check })),
        evidenceRefs: [...input.report.evidenceRefs],
      },
      evidenceCount: input.report.evidenceRefs.length,
      evaluatedBy: input.evaluatedBy,
      idempotencyKey: input.idempotencyKey,
      evaluatedAt: input.evaluatedAt,
      evidence: buildVerificationEvidenceRows(input),
    };
    this.byKey.set(record.idempotencyKey, record);
    this.byId.set(record.id, record);
    return { run: cloneVerificationRunRecord(record), replayed: false };
  }

  async findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<VerificationRunRecord | null> {
    const record = this.byKey.get(idempotencyKey);
    return record === undefined ? null : cloneVerificationRunRecord(record);
  }

  async listByVersion(templateVersionId: string): Promise<VerificationRunRecord[]> {
    return [...this.byId.values()]
      .filter((record) => record.templateVersionId === templateVersionId)
      .sort((a, b) => a.evaluatedAt.getTime() - b.evaluatedAt.getTime())
      .map(cloneVerificationRunRecord);
  }

  /** 测试辅助：清空内存状态。 */
  reset(): void {
    this.byKey.clear();
    this.byId.clear();
  }
}

export function newVerificationRunId(): string {
  return `tvrun-${randomUUID()}`;
}
