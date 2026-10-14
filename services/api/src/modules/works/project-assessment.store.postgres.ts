import { and, eq } from 'drizzle-orm';
import {
  workAssessmentCandidates,
  workValidationChecks,
  type Database,
} from '@qitu/database';
import type { ProjectReviewCandidate } from '@qitu/contracts';
import {
  ProjectAssessmentStore,
  type AssessmentCandidateRecord,
  type UpsertCandidateInput,
  type UpsertCheckInput,
  type ValidationCheckKind,
  type ValidationCheckRecord,
} from './project-assessment.store';
import type { AutomaticAcceptanceState } from './project-review';

type CheckRow = typeof workValidationChecks.$inferSelect;
type CandidateRow = typeof workAssessmentCandidates.$inferSelect;

/**
 * live 持久化：迁移 0023 的两张**新增**表。
 *
 * 与 `project_evidence` 同一幂等口径：唯一键冲突 = 已存在，读回既有行，
 * **不更新**（重放必须得到同一条结论，否则同一份字节会随时间给出不同 verdict）。
 *
 * 本实现**只被服务端评估链路调用**，不挂任何控制器。
 */
export class PostgresProjectAssessmentStore extends ProjectAssessmentStore {
  constructor(private readonly db: Database) {
    super();
  }

  async upsertCheck(input: UpsertCheckInput): Promise<{ record: ValidationCheckRecord; inserted: boolean }> {
    const existing = await this.db
      .select()
      .from(workValidationChecks)
      .where(eq(workValidationChecks.checkKey, input.checkKey))
      .limit(1);
    if (existing[0] !== undefined) return { record: mapCheck(existing[0]), inserted: false };

    const inserted = await this.db
      .insert(workValidationChecks)
      .values({
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
      })
      .onConflictDoNothing({ target: workValidationChecks.checkKey })
      .returning();
    if (inserted[0] !== undefined) return { record: mapCheck(inserted[0]), inserted: true };

    // 并发下的唯一冲突：读回既有行（不抛，不重写）。
    const raced = await this.db
      .select()
      .from(workValidationChecks)
      .where(eq(workValidationChecks.checkKey, input.checkKey))
      .limit(1);
    if (raced[0] === undefined) throw new Error('校验结论写入冲突且无法读回');
    return { record: mapCheck(raced[0]), inserted: false };
  }

  async listChecks(artifactVersionId: string, kind?: ValidationCheckKind): Promise<ValidationCheckRecord[]> {
    const rows = await this.db
      .select()
      .from(workValidationChecks)
      .where(kind === undefined
        ? eq(workValidationChecks.artifactVersionId, artifactVersionId)
        : and(eq(workValidationChecks.artifactVersionId, artifactVersionId), eq(workValidationChecks.kind, kind)))
      .orderBy(workValidationChecks.createdAt);
    return rows.map(mapCheck);
  }

  async upsertCandidate(input: UpsertCandidateInput): Promise<{ record: AssessmentCandidateRecord; inserted: boolean }> {
    const existing = await this.db
      .select()
      .from(workAssessmentCandidates)
      .where(eq(workAssessmentCandidates.candidateKey, input.candidateKey))
      .limit(1);
    if (existing[0] !== undefined) return { record: mapCandidate(existing[0]), inserted: false };

    const inserted = await this.db
      .insert(workAssessmentCandidates)
      .values({
        id: input.id,
        schoolId: input.schoolId,
        projectId: input.projectId,
        studentUserId: input.studentUserId,
        artifactId: input.artifactId,
        artifactVersionId: input.artifactVersionId,
        rubricId: input.candidate.rubricId,
        rubricVersion: input.candidate.rubricVersion,
        source: input.candidate.source,
        modelId: input.candidate.modelId,
        status: input.candidate.status,
        state: input.state,
        score: input.candidate.score,
        criteria: input.candidate.criteria.map((result) => ({ ...result, evidenceRefs: [...result.evidenceRefs] })),
        missingEvidenceIds: [...input.candidate.missingEvidenceIds],
        evidenceRef: input.evidenceRef,
        acceptedAt: input.acceptedAt,
        acceptedByRule: input.acceptedByRule,
        candidateKey: input.candidateKey,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .onConflictDoNothing({ target: workAssessmentCandidates.candidateKey })
      .returning();
    if (inserted[0] !== undefined) return { record: mapCandidate(inserted[0]), inserted: true };

    const raced = await this.db
      .select()
      .from(workAssessmentCandidates)
      .where(eq(workAssessmentCandidates.candidateKey, input.candidateKey))
      .limit(1);
    if (raced[0] === undefined) throw new Error('候选写入冲突且无法读回');
    return { record: mapCandidate(raced[0]), inserted: false };
  }

  async findCandidateByKey(candidateKey: string): Promise<AssessmentCandidateRecord | null> {
    const rows = await this.db
      .select()
      .from(workAssessmentCandidates)
      .where(eq(workAssessmentCandidates.candidateKey, candidateKey))
      .limit(1);
    return rows[0] === undefined ? null : mapCandidate(rows[0]);
  }

  async listCandidates(projectId: string): Promise<AssessmentCandidateRecord[]> {
    const rows = await this.db
      .select()
      .from(workAssessmentCandidates)
      .where(eq(workAssessmentCandidates.projectId, projectId))
      .orderBy(workAssessmentCandidates.createdAt);
    return rows.map(mapCandidate);
  }
}

function mapCheck(row: CheckRow): ValidationCheckRecord {
  return {
    id: row.id,
    schoolId: row.schoolId,
    projectId: row.projectId,
    studentUserId: row.studentUserId,
    artifactId: row.artifactId,
    artifactVersionId: row.artifactVersionId,
    kind: row.kind as ValidationCheckKind,
    validatorVersion: row.validatorVersion,
    sha256: row.sha256,
    verdict: row.verdict,
    findings: row.findings ?? [],
    notes: row.notes ?? [],
    checkKey: row.checkKey,
    createdAt: row.createdAt,
  };
}

function mapCandidate(row: CandidateRow): AssessmentCandidateRecord {
  return {
    id: row.id,
    schoolId: row.schoolId,
    projectId: row.projectId,
    studentUserId: row.studentUserId,
    artifactId: row.artifactId,
    artifactVersionId: row.artifactVersionId,
    // 候选的 rubric 与 evidence 需求不落这两张表（需求来自模板真源，不复制一份）。
    candidate: {
      id: row.id,
      projectId: row.projectId,
      artifactVersionId: row.artifactVersionId,
      rubricId: row.rubricId,
      rubricVersion: row.rubricVersion,
      status: row.status as ProjectReviewCandidate['status'],
      score: row.score,
      criteria: (row.criteria ?? []) as ProjectReviewCandidate['criteria'],
      missingEvidenceIds: row.missingEvidenceIds ?? [],
      source: row.source as ProjectReviewCandidate['source'],
      modelId: row.modelId,
      reviewedBy: null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    },
    state: row.state as AutomaticAcceptanceState,
    evidenceRef: row.evidenceRef,
    acceptedAt: row.acceptedAt,
    acceptedByRule: row.acceptedByRule,
    candidateKey: row.candidateKey,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
