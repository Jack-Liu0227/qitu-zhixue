import { BadRequestException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import {
  GROWTH_PROJECTION_CONTRACT_VERSION,
  isGrowthEvidenceRef,
  normalizeGrowthEvidenceRefs,
  validateGrowthProjectionResult,
  type GrowthProjectionType,
} from '@qitu/contracts';
import {
  agentProjectionCandidates,
  agentTeamEvents,
  agentTeamRuns,
  projects,
  type Database,
} from '@qitu/database';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { AuditWriter } from '../../common/audit/audit.service';
import { DATABASE_TOKEN } from '../../database';
import type { AuditTransaction } from '../../common/audit/audit.service';

export type ProjectionReviewAction = 'accepted' | 'rejected';

export interface ProjectionReviewResult {
  candidateId: string;
  status: string;
  errorCode: string | null;
  supersededCandidateIds: string[];
}

interface CandidateRow {
  id: string;
  runId: string | null;
  taskId: string | null;
  agentId: string;
  projectionType: string;
  studentUserId: string | null;
  projectId: string | null;
  payload: Record<string, unknown>;
  status: string;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
}

interface ReviewActor {
  id: string;
  role: 'admin' | 'teacher';
}

const EXPECTED_AGENT: Readonly<Record<GrowthProjectionType, string>> = {
  learner_profile: 'learner-profile',
  growth_trajectory: 'growth-analyst',
};

const REJECTION_CODES = new Set(['INSUFFICIENT_EVIDENCE', 'OWNER_REVIEW_REJECTED', 'SOURCE_INVALID']);

/** The only writer of accepted projection facts; worker output remains a proposal. */
@Injectable()
export class GrowthProjectionOwnerService {
  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Database | null,
    private readonly audit: AuditWriter,
  ) {}

  async inspect(candidateId: string): Promise<{ valid: boolean; errorCodes: string[] }> {
    const db = this.requireDb();
    const candidate = await db.select().from(agentProjectionCandidates)
      .where(eq(agentProjectionCandidates.id, candidateId)).limit(1);
    if (!candidate[0]) throw new NotFoundException('画像候选不存在');
    const source = await this.readSource(db, candidate[0] as CandidateRow);
    const latest = await this.latestAccepted(db, candidate[0] as CandidateRow);
    return { valid: source.errorCodes.length === 0 && latest.errorCodes.length === 0, errorCodes: [...source.errorCodes, ...latest.errorCodes] };
  }

  async accept(candidateId: string, actor: ReviewActor, idempotencyKey?: string): Promise<ProjectionReviewResult> {
    const db = this.requireDb();
    return db.transaction(async (tx) => {
      const [candidate] = await tx.select().from(agentProjectionCandidates)
        .where(eq(agentProjectionCandidates.id, candidateId)).limit(1).for('update');
      if (!candidate) throw new NotFoundException('画像候选不存在');
      if (candidate.status === 'accepted' || candidate.status === 'superseded') {
        return { candidateId, status: candidate.status, errorCode: candidate.reviewErrorCode ?? null, supersededCandidateIds: [] };
      }
      if (candidate.status === 'rejected') {
        return { candidateId, status: candidate.status, errorCode: candidate.reviewErrorCode ?? null, supersededCandidateIds: [] };
      }
      if (candidate.status !== 'proposed' && candidate.status !== 'validating') throw new BadRequestException('PROJECTION_STATE_INVALID');
      if (!isProjectionType(candidate.projectionType)) throw new BadRequestException('PROJECTION_TYPE_INVALID');

      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`growth-projection:${candidate.studentUserId}:${candidate.projectionType}`}, 0))`);
      const locked = { ...candidate, status: 'validating' } as CandidateRow;
      await tx.update(agentProjectionCandidates).set({ status: 'validating' }).where(eq(agentProjectionCandidates.id, candidate.id));
      const source = await this.readSource(tx, locked);
      const accepted = await this.latestAccepted(tx, locked, true);
      const errors = [...source.errorCodes, ...accepted.errorCodes];
      if (errors.length > 0) {
        const errorCode = errors[0]!;
        await tx.update(agentProjectionCandidates).set({
          status: 'rejected', reviewedBy: actor.id, reviewedAt: new Date(), reviewErrorCode: errorCode,
        }).where(eq(agentProjectionCandidates.id, candidate.id));
        await this.audit.write({
          actorId: actor.id, actorRole: actor.role, action: 'growth.projection.reject',
          targetType: 'agent_projection_candidate', targetId: candidate.id,
          idempotencyKey: auditKey('accept-invalid', candidate.id, idempotencyKey),
          detail: { errorCode, projectionType: candidate.projectionType },
        }, tx as AuditTransaction);
        return { candidateId, status: 'rejected', errorCode, supersededCandidateIds: [] };
      }

      const [current] = await tx.select().from(agentProjectionCandidates).where(and(
        eq(agentProjectionCandidates.studentUserId, candidate.studentUserId!),
        eq(agentProjectionCandidates.projectionType, candidate.projectionType),
        eq(agentProjectionCandidates.status, 'accepted'),
      )).orderBy(desc(agentProjectionCandidates.createdAt)).limit(1).for('update');
      const expectedVersion = current ? resultVersion(current.payload) + 1 : 1;
      const validated = validateGrowthProjectionResult(candidate.projectionType, candidate.payload.result);
      if (!validated.ok || !validated.value || validated.value.version !== expectedVersion) {
        const errorCode = validated.code ?? 'PROJECTION_VERSION_INVALID';
        await tx.update(agentProjectionCandidates).set({
          status: 'rejected', reviewedBy: actor.id, reviewedAt: new Date(), reviewErrorCode: errorCode,
        }).where(eq(agentProjectionCandidates.id, candidate.id));
        await this.audit.write({
          actorId: actor.id, actorRole: actor.role, action: 'growth.projection.reject',
          targetType: 'agent_projection_candidate', targetId: candidate.id,
          idempotencyKey: auditKey('accept-invalid', candidate.id, idempotencyKey),
          detail: { errorCode, projectionType: candidate.projectionType },
        }, tx as AuditTransaction);
        return { candidateId, status: 'rejected', errorCode, supersededCandidateIds: [] };
      }

      const oldRows = await tx.select({ id: agentProjectionCandidates.id }).from(agentProjectionCandidates).where(and(
        eq(agentProjectionCandidates.studentUserId, candidate.studentUserId!),
        eq(agentProjectionCandidates.projectionType, candidate.projectionType),
        eq(agentProjectionCandidates.status, 'accepted'),
      )).for('update');
      const supersededCandidateIds = oldRows.map((row) => row.id);
      if (supersededCandidateIds.length > 0) {
        await tx.update(agentProjectionCandidates).set({
          status: 'superseded', reviewedBy: actor.id, reviewedAt: new Date(),
          supersededByCandidateId: candidate.id,
        }).where(inArray(agentProjectionCandidates.id, supersededCandidateIds));
      }
      await tx.update(agentProjectionCandidates).set({
        status: 'accepted', reviewedBy: actor.id, reviewedAt: new Date(),
        reviewErrorCode: null, supersededByCandidateId: null,
      }).where(eq(agentProjectionCandidates.id, candidate.id));
      await this.audit.write({
        actorId: actor.id, actorRole: actor.role, action: 'growth.projection.accept',
        targetType: 'agent_projection_candidate', targetId: candidate.id,
        idempotencyKey: auditKey('accept', candidate.id, idempotencyKey),
        detail: { projectionType: candidate.projectionType, version: validated.value!.version, supersededCandidateIds },
      }, tx as AuditTransaction);
      return { candidateId, status: 'accepted', errorCode: null, supersededCandidateIds };
    });
  }

  async reject(
    candidateId: string,
    actor: ReviewActor,
    reasonCode: string,
    idempotencyKey?: string,
  ): Promise<ProjectionReviewResult> {
    const db = this.requireDb();
    if (!REJECTION_CODES.has(reasonCode)) throw new BadRequestException('PROJECTION_REJECTION_CODE_INVALID');
    return db.transaction(async (tx) => {
      const [candidate] = await tx.select().from(agentProjectionCandidates)
        .where(eq(agentProjectionCandidates.id, candidateId)).limit(1).for('update');
      if (!candidate) throw new NotFoundException('画像候选不存在');
      if (candidate.status === 'rejected') return { candidateId, status: 'rejected', errorCode: candidate.reviewErrorCode ?? null, supersededCandidateIds: [] };
      if (candidate.status !== 'proposed' && candidate.status !== 'validating') throw new BadRequestException('PROJECTION_STATE_INVALID');
      await tx.update(agentProjectionCandidates).set({
        status: 'rejected', reviewedBy: actor.id, reviewedAt: new Date(), reviewErrorCode: reasonCode,
      }).where(eq(agentProjectionCandidates.id, candidate.id));
      await this.audit.write({
        actorId: actor.id, actorRole: actor.role, action: 'growth.projection.reject',
        targetType: 'agent_projection_candidate', targetId: candidate.id,
        idempotencyKey: auditKey('reject', candidate.id, idempotencyKey),
        detail: { projectionType: candidate.projectionType, errorCode: reasonCode },
      }, tx as AuditTransaction);
      return { candidateId, status: 'rejected', errorCode: reasonCode, supersededCandidateIds: [] };
    });
  }

  private async readSource(db: Database | AuditTransaction, candidate: CandidateRow): Promise<{ errorCodes: string[] }> {
    const errors: string[] = [];
    const payload = candidate.payload;
    if (!isProjectionType(candidate.projectionType) || candidate.agentId !== EXPECTED_AGENT[candidate.projectionType]) errors.push('PROJECTION_TYPE_INVALID');
    if (payload.contractVersion !== GROWTH_PROJECTION_CONTRACT_VERSION) errors.push('PROJECTION_CONTRACT_INVALID');
    if (candidate.studentUserId === null || payload.studentUserId !== candidate.studentUserId || typeof payload.sourceEventId !== 'string') errors.push('PROJECTION_SOURCE_INVALID');
    if (!Array.isArray(payload.evidenceRefs) || payload.evidenceRefs.length === 0 || payload.evidenceRefs.length > 20 || payload.evidenceRefs.some((ref) => !isGrowthEvidenceRef(ref))) errors.push('PROJECTION_EVIDENCE_INVALID');
    const result = validateGrowthProjectionResult(candidate.projectionType, payload.result);
    if (!result.ok) errors.push(result.code ?? 'PROJECTION_RESULT_INVALID');
    if (candidate.projectionType === 'growth_trajectory' && result.ok && result.value) {
      const sourceRefs = normalizeGrowthEvidenceRefs(payload.evidenceRefs);
      const trajectory = result.value as { evidenceRefs: string[] };
      if (trajectory.evidenceRefs.length === 0 || trajectory.evidenceRefs.some((ref: string) => !sourceRefs.includes(ref))) errors.push('PROJECTION_EVIDENCE_INVALID');
    }
    if (typeof payload.sourceTopic !== 'string') errors.push('PROJECTION_SOURCE_INVALID');

    if (typeof payload.sourceEventId === 'string') {
      const [event] = await db.select().from(agentTeamEvents).where(eq(agentTeamEvents.id, payload.sourceEventId)).limit(1);
      if (!event || event.topic !== payload.sourceTopic || event.runId !== candidate.runId) {
        errors.push('PROJECTION_SOURCE_INVALID');
      } else {
        const eventPayload = event.payload;
        if (eventPayload.studentUserId !== candidate.studentUserId
          || (eventPayload.projectId ?? null) !== candidate.projectId) errors.push('PROJECTION_SOURCE_INVALID');
        const ownerRefs = normalizeGrowthEvidenceRefs([
          ...(Array.isArray(eventPayload.evidenceRefs) ? eventPayload.evidenceRefs : []),
          ...(typeof eventPayload.evidenceRef === 'string' ? [eventPayload.evidenceRef] : []),
        ]);
        const candidateRefs = normalizeGrowthEvidenceRefs(payload.evidenceRefs);
        if (ownerRefs.length !== candidateRefs.length || ownerRefs.some((ref) => !candidateRefs.includes(ref))) errors.push('PROJECTION_EVIDENCE_INVALID');
      }
      if (candidate.runId !== null && candidate.studentUserId !== null) {
        const [run] = await db.select().from(agentTeamRuns).where(eq(agentTeamRuns.id, candidate.runId)).limit(1);
        if (!run || run.studentUserId !== candidate.studentUserId || run.projectId !== candidate.projectId) errors.push('PROJECTION_OWNER_INVALID');
        if (candidate.projectId !== null) {
          const [project] = await db.select({ id: projects.id, studentUserId: projects.studentUserId })
            .from(projects).where(eq(projects.id, candidate.projectId)).limit(1);
          if (!project || project.studentUserId !== candidate.studentUserId) errors.push('PROJECTION_OWNER_INVALID');
        }
      } else errors.push('PROJECTION_OWNER_INVALID');
    }
    return { errorCodes: [...new Set(errors)] };
  }

  private async latestAccepted(
    db: Database | AuditTransaction,
    candidate: CandidateRow,
    lock = false,
  ): Promise<{ errorCodes: string[] }> {
    if (candidate.studentUserId === null || !isProjectionType(candidate.projectionType)) return { errorCodes: ['PROJECTION_OWNER_INVALID'] };
    const query = db.select().from(agentProjectionCandidates).where(and(
      eq(agentProjectionCandidates.studentUserId, candidate.studentUserId),
      eq(agentProjectionCandidates.projectionType, candidate.projectionType),
      eq(agentProjectionCandidates.status, 'accepted'),
    )).orderBy(desc(agentProjectionCandidates.createdAt)).limit(1);
    const [current] = lock ? await query.for('update') : await query;
    if (!current) return { errorCodes: [] };
    const currentResult = validateGrowthProjectionResult(candidate.projectionType, current.payload.result);
    return currentResult.ok ? { errorCodes: [] } : { errorCodes: ['PROJECTION_CURRENT_VERSION_INVALID'] };
  }

  private requireDb(): Database {
    if (!this.db) throw new ServiceUnavailableException('画像候选审核存储不可用');
    return this.db;
  }
}

function isProjectionType(value: string): value is GrowthProjectionType {
  return value === 'learner_profile' || value === 'growth_trajectory';
}

function resultVersion(payload: Record<string, unknown>): number {
  const result = payload.result;
  return typeof result === 'object' && result !== null && !Array.isArray(result)
    && Number.isInteger((result as Record<string, unknown>).version)
    ? (result as Record<string, number>).version!
    : 0;
}

function auditKey(action: string, candidateId: string, requestKey?: string): string {
  const key = requestKey && /^[A-Za-z0-9._:-]{1,120}$/u.test(requestKey) ? requestKey : 'default';
  return `growth-projection:${action}:${candidateId}:${key}`;
}
