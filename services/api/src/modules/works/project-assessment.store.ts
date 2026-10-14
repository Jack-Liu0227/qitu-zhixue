import type { ProjectReviewCandidate } from '@qitu/contracts';
import type { AutomaticAcceptanceState } from './project-review';
import type { MediaComplianceVerdict } from './assessor/media-compliance-validator';
import type { CodeStaticCheckReport } from './assessor/code-static-check-producer';
import type { DocumentValidationReport } from './assessor/document-structure-validator';

/**
 * P2 评估留痕存储边界（两张**新增**表，见迁移 0023）。
 *
 * 边界说明：
 * - 只存**结论**与**不透明引用**：候选（分数 + 逐条理由）、校验结论
 *   （validatorVersion + sha256 + verdict + findings）；
 * - **不存**媒体内容、报告正文、转写文本、缩略图；
 * - 幂等由唯一键承担（`candidate_key` / `check_key`），重复写入不新增行，
 *   与 `project_evidence` 的既有幂等口径一致（ON CONFLICT DO NOTHING）。
 *
 * 这里**没有**任何客户端可调用的路径：控制器不会暴露本存储。
 */

export type ValidationCheckKind = 'document_structure' | 'media_compliance' | 'code_static';

export interface ValidationCheckRecord {
  id: string;
  schoolId: string | null;
  projectId: string | null;
  studentUserId: string;
  artifactId: string | null;
  artifactVersionId: string;
  kind: ValidationCheckKind;
  validatorVersion: string;
  /** 被检字节摘要；不可判定时为 null（**不**填占位值）。 */
  sha256: string | null;
  verdict: string;
  findings: string[];
  notes: string[];
  checkKey: string;
  createdAt: Date;
}

export interface AssessmentCandidateRecord {
  id: string;
  schoolId: string | null;
  projectId: string;
  studentUserId: string;
  artifactId: string;
  artifactVersionId: string;
  candidate: ProjectReviewCandidate;
  state: AutomaticAcceptanceState;
  evidenceRef: string | null;
  acceptedAt: Date | null;
  acceptedByRule: string | null;
  candidateKey: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertCheckInput {
  id: string;
  schoolId: string | null;
  projectId: string | null;
  studentUserId: string;
  artifactId: string | null;
  artifactVersionId: string;
  kind: ValidationCheckKind;
  validatorVersion: string;
  sha256: string | null;
  verdict: string;
  findings: readonly string[];
  notes: readonly string[];
  checkKey: string;
  now: Date;
}

export interface UpsertCandidateInput {
  id: string;
  schoolId: string | null;
  projectId: string;
  studentUserId: string;
  artifactId: string;
  artifactVersionId: string;
  candidate: ProjectReviewCandidate;
  state: AutomaticAcceptanceState;
  evidenceRef: string | null;
  acceptedAt: Date | null;
  acceptedByRule: string | null;
  candidateKey: string;
  now: Date;
}

export abstract class ProjectAssessmentStore {
  /** 幂等写入：已存在同键行时返回既有行（不更新）。 */
  abstract upsertCheck(input: UpsertCheckInput): Promise<{ record: ValidationCheckRecord; inserted: boolean }>;
  abstract listChecks(artifactVersionId: string, kind?: ValidationCheckKind): Promise<ValidationCheckRecord[]>;
  abstract upsertCandidate(input: UpsertCandidateInput): Promise<{ record: AssessmentCandidateRecord; inserted: boolean }>;
  abstract findCandidateByKey(candidateKey: string): Promise<AssessmentCandidateRecord | null>;
  abstract listCandidates(projectId: string): Promise<AssessmentCandidateRecord[]>;
}

export const PROJECT_ASSESSMENT_CHECK_KINDS: readonly ValidationCheckKind[] = [
  'document_structure',
  'media_compliance',
  'code_static',
];

/** 确定性检查幂等键：同一份字节 + 同一校验器版本只留一行。 */
export function validationCheckKey(input: {
  kind: ValidationCheckKind;
  artifactVersionId: string;
  sha256: string | null;
  validatorVersion: string;
}): string {
  return `${input.kind}:${input.artifactVersionId}:${input.sha256 ?? 'unavailable'}@${input.validatorVersion}`;
}

/** 确定性候选幂等键：同一项目 + 版本 + rubric 只留一个候选。 */
export function assessmentCandidateKey(input: {
  projectId: string;
  artifactVersionId: string;
  rubricId: string;
  rubricVersion: string;
}): string {
  return `candidate:${input.projectId}:${input.artifactVersionId}:${input.rubricId}@${input.rubricVersion}`;
}

/* ------------------------------------------------------------------ *
 * 内存实现（demo / test）
 * ------------------------------------------------------------------ */

export class InMemoryProjectAssessmentStore extends ProjectAssessmentStore {
  private readonly checks = new Map<string, ValidationCheckRecord>();
  private readonly candidates = new Map<string, AssessmentCandidateRecord>();

  async upsertCheck(input: UpsertCheckInput): Promise<{ record: ValidationCheckRecord; inserted: boolean }> {
    const existing = this.checks.get(input.checkKey);
    if (existing !== undefined) return { record: { ...existing }, inserted: false };
    const record: ValidationCheckRecord = {
      id: input.id,
      schoolId: input.schoolId,
      projectId: input.projectId,
      studentUserId: input.studentUserId,
      artifactId: input.artifactId,
      artifactVersionId: input.artifactVersionId,
      kind: input.kind,
      validatorVersion: input.validatorVersion,
      sha256: input.sha256,
      verdict: input.verdict,
      findings: [...input.findings],
      notes: [...input.notes],
      checkKey: input.checkKey,
      createdAt: input.now,
    };
    this.checks.set(input.checkKey, record);
    return { record: { ...record }, inserted: true };
  }

  async listChecks(artifactVersionId: string, kind?: ValidationCheckKind): Promise<ValidationCheckRecord[]> {
    return [...this.checks.values()]
      .filter((record) => record.artifactVersionId === artifactVersionId)
      .filter((record) => kind === undefined || record.kind === kind)
      .map((record) => ({ ...record, findings: [...record.findings], notes: [...record.notes] }));
  }

  async upsertCandidate(input: UpsertCandidateInput): Promise<{ record: AssessmentCandidateRecord; inserted: boolean }> {
    const existing = this.candidates.get(input.candidateKey);
    if (existing !== undefined) return { record: cloneCandidate(existing), inserted: false };
    const record: AssessmentCandidateRecord = {
      id: input.id,
      schoolId: input.schoolId,
      projectId: input.projectId,
      studentUserId: input.studentUserId,
      artifactId: input.artifactId,
      artifactVersionId: input.artifactVersionId,
      candidate: input.candidate,
      state: input.state,
      evidenceRef: input.evidenceRef,
      acceptedAt: input.acceptedAt,
      acceptedByRule: input.acceptedByRule,
      candidateKey: input.candidateKey,
      createdAt: input.now,
      updatedAt: input.now,
    };
    this.candidates.set(input.candidateKey, record);
    return { record: cloneCandidate(record), inserted: true };
  }

  async findCandidateByKey(candidateKey: string): Promise<AssessmentCandidateRecord | null> {
    const record = this.candidates.get(candidateKey);
    return record === undefined ? null : cloneCandidate(record);
  }

  async listCandidates(projectId: string): Promise<AssessmentCandidateRecord[]> {
    return [...this.candidates.values()]
      .filter((record) => record.projectId === projectId)
      .map(cloneCandidate)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  /** 测试辅助。 */
  reset(): void {
    this.checks.clear();
    this.candidates.clear();
  }
}

function cloneCandidate(record: AssessmentCandidateRecord): AssessmentCandidateRecord {
  return {
    ...record,
    candidate: {
      ...record.candidate,
      criteria: record.candidate.criteria.map((result) => ({ ...result, evidenceRefs: [...result.evidenceRefs] })),
      missingEvidenceIds: [...record.candidate.missingEvidenceIds],
    },
  };
}

/** 生产者结论 → 持久化输入的统一投影（三处都只落结构化字段）。 */
export function checkFromDocumentReport(input: {
  id: string;
  schoolId: string | null;
  projectId: string | null;
  studentUserId: string;
  artifactId: string | null;
  artifactVersionId: string;
  report: DocumentValidationReport;
  now: Date;
}): UpsertCheckInput {
  return {
    id: input.id,
    schoolId: input.schoolId,
    projectId: input.projectId,
    studentUserId: input.studentUserId,
    artifactId: input.artifactId,
    artifactVersionId: input.artifactVersionId,
    kind: 'document_structure',
    validatorVersion: input.report.validatorVersion,
    sha256: input.report.sha256,
    verdict: input.report.verdict,
    findings: [...input.report.missing],
    notes: [`章节 ${input.report.sections.filter((section) => section.present).length}/${input.report.sections.length}`],
    checkKey: validationCheckKey({
      kind: 'document_structure',
      artifactVersionId: input.artifactVersionId,
      sha256: input.report.sha256,
      validatorVersion: input.report.validatorVersion,
    }),
    now: input.now,
  };
}

export function checkFromMediaVerdict(input: {
  id: string;
  schoolId: string | null;
  projectId: string | null;
  studentUserId: string;
  artifactId: string | null;
  artifactVersionId: string;
  verdict: MediaComplianceVerdict;
  now: Date;
}): UpsertCheckInput {
  return {
    id: input.id,
    schoolId: input.schoolId,
    projectId: input.projectId,
    studentUserId: input.studentUserId,
    artifactId: input.artifactId,
    artifactVersionId: input.artifactVersionId,
    kind: 'media_compliance',
    validatorVersion: input.verdict.validatorVersion,
    sha256: input.verdict.headerDigest,
    verdict: input.verdict.verdict,
    findings: [...input.verdict.issues],
    notes: [...input.verdict.notes],
    checkKey: validationCheckKey({
      kind: 'media_compliance',
      artifactVersionId: input.artifactVersionId,
      sha256: input.verdict.headerDigest,
      validatorVersion: input.verdict.validatorVersion,
    }),
    now: input.now,
  };
}

export function checkFromCodeReport(input: {
  id: string;
  schoolId: string | null;
  projectId: string | null;
  studentUserId: string;
  artifactId: string | null;
  artifactVersionId: string;
  report: CodeStaticCheckReport;
  now: Date;
}): UpsertCheckInput {
  return {
    id: input.id,
    schoolId: input.schoolId,
    projectId: input.projectId,
    studentUserId: input.studentUserId,
    artifactId: input.artifactId,
    artifactVersionId: input.artifactVersionId,
    kind: 'code_static',
    validatorVersion: input.report.validatorVersion,
    sha256: input.report.files.find((file) => file.present && file.sha256 !== null)?.sha256 ?? null,
    verdict: input.report.verdict,
    findings: [...input.report.issues],
    // disclosures 一并留痕：静态结论的语义红线写进数据行，而不只写在代码注释里。
    notes: [...input.report.disclosures],
    checkKey: validationCheckKey({
      kind: 'code_static',
      artifactVersionId: input.artifactVersionId,
      sha256: input.report.files.find((file) => file.present && file.sha256 !== null)?.sha256 ?? null,
      validatorVersion: input.report.validatorVersion,
    }),
    now: input.now,
  };
}
