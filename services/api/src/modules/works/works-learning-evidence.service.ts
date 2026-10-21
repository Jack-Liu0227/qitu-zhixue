import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { CurrentUser, TutorExperimentActionResponse } from '@qitu/contracts';
import { AuditWriter } from '../../common/audit/audit.service';
import { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { hashIdempotentInput } from '../../common/idempotency/idempotency.hash';
import { throwHttpForIdempotencyError } from '../../common/idempotency/idempotency.errors';
import { LearningPlanStore } from '../learning-plan/learning-plan.store';
import { MasteryDomainService } from '../mastery/mastery-domain.service';
import { TemplateBindingService } from '../templates/templates-binding.service';
import { ProjectEvidenceMaterializer } from './project-evidence.service';
import { ProjectEvidenceStore, type ProjectEvidenceRecord } from './project-evidence.store';
import { WorksDirectory } from './works.access';
import { WorksService, type ArtifactView } from './works.service';
import { WorksStore } from './works.store';
import { boundedStudentText, decodeInlineVersion } from './works-inline-content';
import { conflict, requireLearningPracticeGate, resolveLearningEvidenceContext, sameIds } from './works-learning-context';
import type { LearningEvidenceProof, LearningEvidenceScope, LearningSubmissionReceipt, LessonEvidenceProofs } from './works-learning-evidence.types';

export type { LearningEvidenceProof, LearningEvidenceScope, LessonEvidenceProofs } from './works-learning-evidence.types';
export interface LearningTextSubmission {
  planRevision: number;
  content: string;
  evidenceRefs?: readonly string[];
  objectiveId?: string;
  title?: string;
  requestReview?: boolean;
}
export interface LearningSubmissionResponse {
  proof: LearningEvidenceProof;
  artifact: ArtifactView;
  assessmentStatus: 'assessment_required';
  masteryUpdated: false;
  replayed: boolean;
}

/** Owns submission receipts; never writes mastery, lesson progress, or project stage. */
@Injectable()
export class WorksLearningEvidenceService {
  constructor(
    private readonly plans: LearningPlanStore,
    private readonly bindings: TemplateBindingService,
    private readonly directory: WorksDirectory,
    private readonly mastery: MasteryDomainService,
    private readonly works: WorksService,
    private readonly artifacts: WorksStore,
    private readonly evidence: ProjectEvidenceMaterializer,
    private readonly facts: ProjectEvidenceStore,
    private readonly idempotency: IdempotencyStore,
    private readonly audit: AuditWriter,
  ) {}

  async getLessonProofs(actor: CurrentUser, planId: string, learningSessionId: string, planRevision: number) {
    const context = await this.context(actor, { planId, learningSessionId, planRevision });
    const allowedActions = actor.role === 'student' && context.bundle.plan.status === 'active'
      ? ['respond', 'submit_artifact', ...(context.lesson.checkpoint?.requiredGate === 'review_completed_and_archived' ? ['reflect'] : [])] : [];
    return { ...await this.readLessonProofs(actor, context.scope), scope: context.scope, sessionType: context.lesson.sessionType, allowedActions };
  }

  async readLessonProofs(actor: CurrentUser, scope: LearningEvidenceScope, refs?: readonly string[]): Promise<LessonEvidenceProofs> {
    const context = await this.context(actor, scope);
    const requested = refs === undefined ? null : new Set(validRefs(refs));
    const result: LessonEvidenceProofs = { submissions: [], observations: [], approvedArtifacts: [], reflections: [] };
    const rows = await this.facts.listByProject(scope.projectId);
    for (const row of rows) {
      if (row.studentUserId !== context.project.studentId) continue;
      if (row.sourceKind === 'experiment_observation') {
        const proof = observationProof(row, context.scope);
        if (proof && (!requested || requested.has(proof.ref))) result.observations.push(proof);
        continue;
      }
      const receipt = readSubmission(row);
      if (!receipt || receipt.scope.projectId !== scope.projectId || receipt.scope.planId !== scope.planId
        || receipt.scope.planRevision !== scope.planRevision) continue;
      const stored = await this.artifacts.findVersionById(receipt.artifactVersionId);
      if (!stored || stored.artifact.id !== receipt.artifactId || row.artifactId !== receipt.artifactId
        || stored.artifact.studentId !== context.project.studentId || stored.artifact.projectId !== scope.projectId
        || stored.artifact.templateVersionId !== context.project.templateVersionId) continue;
      const text = decodeInlineVersion(stored.version.note).inlineText;
      if (!text || digest(text) !== receipt.contentDigest) continue;
      const proof: LearningEvidenceProof = {
        kind: receipt.kind, ref: `${row.sourceKind}:${row.sourceId}`, scope: receipt.scope,
        objectiveId: receipt.scope.objectiveIds[0]!, sourceKind: row.sourceKind as 'task_submission' | 'reflection',
        artifactId: receipt.artifactId, artifactVersionId: receipt.artifactVersionId,
      };
      if (sameScope(receipt.scope, scope) && (!requested || requested.has(proof.ref))) {
        if (row.sourceKind === 'reflection') result.reflections.push(proof);
        else result.submissions.push(proof);
      }
      if (receipt.kind !== 'submitted_artifact' || row.sourceKind !== 'task_submission'
        || stored.artifact.status !== 'published' || !stored.artifact.publishedAt
        || stored.version.ordinal !== stored.artifact.currentVersionIndex) continue;
      const mentorId = await this.directory.mentorOfStudent(context.project.studentId);
      if (!mentorId) continue;
      const reviews = await this.artifacts.listReviewsForArtifact(stored.artifact.id);
      for (const review of reviews) {
        if (review.status !== 'approved' || review.mentorUserId !== mentorId || review.studentId !== context.project.studentId
          || review.projectId !== scope.projectId || !review.reviewedAt
          || !await this.evidence.hasArtifactReviewRequest(stored.artifact, stored.version, review)) continue;
        const approved: LearningEvidenceProof = { ...proof, kind: 'approved_artifact', ref: `artifact:${stored.artifact.id}`,
          reviewId: review.id, mentorId };
        if (!requested || requested.has(approved.ref)) result.approvedArtifacts.push(approved);
        break;
      }
    }
    if (requested) {
      const found = new Set(Object.values(result).flat().map((proof) => proof.ref));
      if ([...requested].some((ref) => !found.has(ref))) conflict('LEARNING_EVIDENCE_SCOPE_MISMATCH', '引用不存在、已失效或不属于本课时/项目');
    }
    return result;
  }

  submitResponse(actor: CurrentUser, planId: string, learningSessionId: string, body: LearningTextSubmission, key: string) {
    return this.submitText(actor, planId, learningSessionId, body, key, 'session_response', false);
  }

  submitArtifact(actor: CurrentUser, planId: string, learningSessionId: string, body: LearningTextSubmission, key: string) {
    return this.submitText(actor, planId, learningSessionId, body, key, 'submitted_artifact', false);
  }

  submitReflection(actor: CurrentUser, planId: string, learningSessionId: string, body: LearningTextSubmission, key: string) {
    return this.submitText(actor, planId, learningSessionId, body, key, 'session_response', true);
  }

  /** A verified submission is pending assessment. Observation existence is never a correct answer. */
  async recordEvidenceSubmission(actor: CurrentUser, scope: LearningEvidenceScope, objectiveId: string, evidenceRef: string, key: string) {
    const context = await this.context(actor, scope, true);
    if (!context.scope.objectiveIds.includes(objectiveId)) conflict('LEARNING_EVIDENCE_OBJECTIVE_MISMATCH', '目标不属于该课时');
    await requireLearningPracticeGate(this.mastery, this.plans, actor, context);
    const proofs = await this.readLessonProofs(actor, scope, [evidenceRef]);
    const proof = [...proofs.submissions, ...proofs.observations].find((entry) => entry.ref === evidenceRef
      && entry.scope.objectiveIds.includes(objectiveId));
    if (!proof) conflict('LEARNING_EVIDENCE_SCOPE_MISMATCH', '需引用本课时已保存的学习产物或实验观察');
    const sourceId = `submission-${digest(JSON.stringify([actor.id, scope, objectiveId, evidenceRef]))}`;
    const detail = JSON.stringify({ schema: 'qitu.evidence-submission.v1', scope, objectiveId, evidenceRef, assessmentStatus: 'assessment_required' });
    await this.evidence.ingestServerFacts([{
      projectId: scope.projectId, studentUserId: actor.id, schoolId: null, artifactId: proof.artifactId ?? null,
      columnKind: 'independent', sourceKind: 'task_submission', sourceId, label: '实践证据已提交，待评价', detail, occurredAt: new Date(),
    }]);
    await this.context(actor, scope, true);
    await this.readLessonProofs(actor, scope, [evidenceRef]);
    const saved = (await this.facts.listByProject(scope.projectId)).find((row) => row.sourceKind === 'task_submission'
      && row.sourceId === sourceId && row.studentUserId === actor.id);
    if (saved?.detail !== detail) conflict('LEARNING_EVIDENCE_READBACK_FAILED', '证据提交回读失败，请重试');
    await this.audit.write({ actorId: actor.id, actorRole: actor.role, action: 'learning_plan.evidence_submitted',
      targetType: 'learning_session', targetId: scope.learningSessionId, idempotencyKey: `learning-evidence:${sourceId}`,
      detail: { planId: scope.planId, planRevision: scope.planRevision, objectiveId, evidenceRef, masteryUpdated: false } });
    return { evidenceRef: `task_submission:${sourceId}`, assessmentStatus: 'assessment_required' as const, masteryUpdated: false as const };
  }

  private async submitText(actor: CurrentUser, planId: string, learningSessionId: string, body: LearningTextSubmission,
    key: string, kind: LearningSubmissionReceipt['kind'], reflection: boolean): Promise<LearningSubmissionResponse> {
    const content = boundedStudentText(body.content, reflection ? 4000 : 10_000);
    const evidenceRefs = validRefs(body.evidenceRefs ?? []);
    if (body.requestReview !== undefined && typeof body.requestReview !== 'boolean') invalid('requestReview 必须为布尔值');
    const inputScope = { planId, learningSessionId, planRevision: body.planRevision };
    const initial = await this.context(actor, inputScope, true);
    const objectiveIds = body.objectiveId === undefined ? initial.scope.objectiveIds : [body.objectiveId];
    if (!objectiveIds.every((id) => initial.scope.objectiveIds.includes(id))) conflict('LEARNING_EVIDENCE_OBJECTIVE_MISMATCH', '目标不属于该课时');
    // Store the full frozen lesson scope; caller-selected objective never changes authorization.
    const operation = reflection ? 'reflection' : kind;
    const idemScope = `learning.${operation}:${actor.id}:${planId}:${learningSessionId}`;
    const normalized = { content, evidenceRefs, objectiveId: body.objectiveId ?? null, title: body.title ?? null,
      requestReview: body.requestReview === true, planRevision: body.planRevision };
    try {
      const result = await this.idempotency.execute(idemScope, key, hashIdempotentInput(idemScope, inputScope, normalized), async () => {
        const context = await this.context(actor, inputScope, true);
        await requireLearningPracticeGate(this.mastery, this.plans, actor, context);
        if (reflection && context.lesson.checkpoint?.requiredGate !== 'review_completed_and_archived') {
          conflict('REFLECTION_SESSION_REQUIRED', '当前课时没有最终反思归档任务');
        }
        if (evidenceRefs.length) await this.readLessonProofs(actor, context.scope, evidenceRefs);
        if (reflection) {
          const projectProofs = await this.readLessonProofs(actor, context.scope);
          if (!projectProofs.approvedArtifacts.length) conflict('PROJECT_REVIEW_REQUIRED', '需先完成当前班主任审核并发布报告');
        }
        const childKey = digest(`${idemScope}:${key}`);
        const artifact = await this.works.createArtifact(actor.id, {
          projectId: context.project.id, title: body.title ?? `${context.lesson.title} · ${reflection ? '反思' : kind === 'session_response' ? '学习回应' : '作品'}`,
          summary: '', version: { inlineText: content },
        }, childKey);
        const versionId = artifact.latestVersion?.id;
        if (!versionId || artifact.latestVersion?.inlineText !== content) conflict('LEARNING_EVIDENCE_READBACK_FAILED', '学习产物保存回读失败');
        const receipt: LearningSubmissionReceipt = { schema: 'qitu.learning-submission.v1', kind,
          scope: context.scope, artifactId: artifact.id, artifactVersionId: versionId,
          contentDigest: digest(content), evidenceRefs };
        const sourceKind = reflection ? 'reflection' as const : 'task_submission' as const;
        const sourceId = `learning-${childKey}`;
        await this.evidence.ingestServerFacts([{
          projectId: context.project.id, studentUserId: actor.id, schoolId: null, artifactId: artifact.id,
          columnKind: 'independent', sourceKind, sourceId, label: reflection ? '已提交学习反思' : kind === 'session_response' ? '已保存本课学习回应' : '已提交课时作品',
          detail: JSON.stringify(receipt), occurredAt: new Date(),
        }]);
        await this.context(actor, context.scope, true);
        const saved = await this.readLessonProofs(actor, context.scope, [`${sourceKind}:${sourceId}`]);
        const proof = (reflection ? saved.reflections : saved.submissions)[0];
        if (!proof) conflict('LEARNING_EVIDENCE_READBACK_FAILED', '学习产物引用回读失败');
        const view = kind === 'submitted_artifact' && body.requestReview
          ? await this.works.publishArtifact(actor.id, artifact.id, `${childKey}:review`) : artifact;
        await this.audit.write({ actorId: actor.id, actorRole: actor.role, action: `learning.${operation}.submitted`,
          targetType: 'learning_session', targetId: learningSessionId, idempotencyKey: `learning-submission:${sourceId}`,
          detail: { planId, planRevision: body.planRevision, artifactId: artifact.id, artifactVersionId: versionId, contentDigest: receipt.contentDigest } });
        return { status: 201, body: { proof, artifact: view, assessmentStatus: 'assessment_required' as const, masteryUpdated: false as const } };
      });
      // Idempotent replays still revalidate live scope and original proof.
      await this.context(actor, inputScope);
      await this.readLessonProofs(actor, initial.scope, [result.body.proof.ref]);
      return { ...result.body, replayed: result.replayed };
    } catch (error) { throwHttpForIdempotencyError(error); throw error; }
  }

  private context(actor: CurrentUser, scope: Parameters<typeof resolveLearningEvidenceContext>[4], write = false) {
    return resolveLearningEvidenceContext(this.plans, this.bindings, this.directory, actor, scope, write);
  }
}

function digest(text: string): string { return createHash('sha256').update(text).digest('hex'); }
function validRefs(input: readonly string[]): string[] {
  if (!Array.isArray(input) || input.length > 20 || input.some((ref) => typeof ref !== 'string' || !ref || ref.length > 500)) invalid('证据引用须为最多 20 个有效引用');
  return [...new Set(input)];
}
function invalid(message: string): never { throw new BadRequestException({ code: 'LEARNING_EVIDENCE_INVALID', message }); }
function sameScope(left: LearningEvidenceScope, right: LearningEvidenceScope): boolean {
  return left.projectId === right.projectId && left.planId === right.planId && left.planRevision === right.planRevision
    && left.learningSessionId === right.learningSessionId && sameIds(left.objectiveIds, right.objectiveIds);
}
function readSubmission(row: ProjectEvidenceRecord): LearningSubmissionReceipt | null {
  if (!['task_submission', 'reflection'].includes(row.sourceKind) || !row.detail) return null;
  try {
    const data = JSON.parse(row.detail) as LearningSubmissionReceipt;
    if (data.schema !== 'qitu.learning-submission.v1' || !['session_response', 'submitted_artifact'].includes(data.kind)
      || !data.scope || typeof data.scope.projectId !== 'string' || typeof data.scope.planId !== 'string'
      || typeof data.scope.learningSessionId !== 'string' || !Number.isSafeInteger(data.scope.planRevision)
      || !Array.isArray(data.scope.objectiveIds) || !data.scope.objectiveIds.length
      || data.scope.objectiveIds.some((id) => typeof id !== 'string') || typeof data.artifactId !== 'string'
      || typeof data.artifactVersionId !== 'string' || !/^[a-f0-9]{64}$/u.test(data.contentDigest)) return null;
    return data;
  } catch { return null; }
}
function observationProof(row: ProjectEvidenceRecord, scope: LearningEvidenceScope): LearningEvidenceProof | null {
  if (!row.detail) return null;
  try {
    const data = JSON.parse(row.detail) as { objectiveId: string; receipt: NonNullable<TutorExperimentActionResponse['observationReceipt']> };
    const receipt = data.receipt;
    if (!receipt || receipt.projectId !== scope.projectId || receipt.planId !== scope.planId || receipt.planRevision !== scope.planRevision
      || receipt.learningSessionId !== scope.learningSessionId || !scope.objectiveIds.includes(data.objectiveId)
      || receipt.provenance !== 'simulated_observation' || receipt.observationId !== row.sourceId
      || receipt.evidenceRef !== `experiment_observation:${row.sourceId}` || !receipt.runActionId
      || !/^[a-f0-9]{64}$/u.test(receipt.parameterDigest) || !Number.isFinite(Date.parse(receipt.savedAt))) return null;
    return { kind: 'experiment_observation', ref: receipt.evidenceRef, scope, objectiveId: data.objectiveId,
      sourceKind: 'experiment_observation', parameterDigest: receipt.parameterDigest };
  } catch { return null; }
}
