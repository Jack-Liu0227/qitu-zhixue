import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { CurrentUser, LearningEvidenceProof } from '@qitu/contracts';
import { AuditWriter } from '../../common/audit/audit.service';
import { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { LearningPlanStore } from '../learning-plan/learning-plan.store';
import { MasteryDomainService } from '../mastery/mastery-domain.service';
import { TemplateBindingService } from '../templates/templates-binding.service';
import { LessonQualityEvaluator } from './lesson-quality-evaluator';
import { WorksDirectory } from './works.access';
import { WorksStore, type ArtifactRecord, type ArtifactVersionRecord } from './works.store';
import { ProjectEvidenceStore } from './project-evidence.store';
import { ProjectEvidenceMaterializer } from './project-evidence.service';
import { WorksLessonQuality } from './works-lesson-quality';
import { conflict, requireLearningPracticeGate, resolveLearningEvidenceContext } from './works-learning-context';
import { decodeInlineVersion } from './works-inline-content';
import type { LearningSubmissionReceipt } from './works-learning-evidence.types';

/** Publication consumes the same immutable quality receipt as lesson progress, never a teacher approval. */
@Injectable()
export class WorksPublicationReview {
  private readonly quality: WorksLessonQuality;
  constructor(private readonly plans: LearningPlanStore, private readonly bindings: TemplateBindingService,
    private readonly directory: WorksDirectory, private readonly artifacts: WorksStore,
    private readonly facts: ProjectEvidenceStore, evidence: ProjectEvidenceMaterializer,
    audit: AuditWriter, idempotency: IdempotencyStore, evaluator: LessonQualityEvaluator,
    private readonly mastery: MasteryDomainService) {
    this.quality = new WorksLessonQuality({ plans, bindings, directory, artifacts, facts, evidence, audit, idempotency, evaluator, mastery });
  }

  private async subject(artifact: ArtifactRecord, version: ArtifactVersionRecord) {
    if (!artifact.projectId || version.ordinal !== artifact.currentVersionIndex || version.artifactId !== artifact.id) return null;
    const content = decodeInlineVersion(version.note).inlineText;
    if (!content) return null;
    for (const row of await this.facts.listByProject(artifact.projectId)) {
      if (row.sourceKind !== 'task_submission' || row.artifactId !== artifact.id || row.studentUserId !== artifact.studentId || !row.detail) continue;
      let receipt: LearningSubmissionReceipt;
      try { receipt = JSON.parse(row.detail) as LearningSubmissionReceipt; } catch { continue; }
      if (receipt.schema !== 'qitu.learning-submission.v1' || receipt.kind !== 'submitted_artifact'
        || receipt.artifactId !== artifact.id || receipt.artifactVersionId !== version.id
        || receipt.scope?.projectId !== artifact.projectId
        || receipt.contentDigest !== createHash('sha256').update(content).digest('hex')) continue;
      const actor = { id: artifact.studentId, role: 'student' } as CurrentUser;
      const context = await resolveLearningEvidenceContext(this.plans, this.bindings, this.directory, actor, receipt.scope);
      if (context.project.templateVersionId !== artifact.templateVersionId) continue;
      const proof: LearningEvidenceProof = { kind: 'submitted_artifact', ref: `task_submission:${row.sourceId}`,
        scope: receipt.scope, objectiveId: receipt.scope.objectiveIds[0]!, sourceKind: 'task_submission',
        artifactId: artifact.id, artifactVersionId: version.id, activityId: receipt.activityId };
      return { actor, context, proof };
    }
    return null;
  }

  async status(artifact: ArtifactRecord, version: ArtifactVersionRecord) {
    const subject = await this.subject(artifact, version);
    return subject ? (await this.quality.read(subject.context, subject.proof)).status : null;
  }

  async evaluate(artifact: ArtifactRecord, version: ArtifactVersionRecord) {
    const subject = await this.subject(artifact, version);
    if (!subject) conflict('ARTIFACT_EVALUATION_SCOPE_REQUIRED', '请在当前课时提交作品正文，自动评价需绑定确切的课时与版本。');
    await requireLearningPracticeGate(this.mastery, this.plans, subject.actor, subject.context);
    return this.quality.evaluate(subject.actor, subject.context, subject.proof);
  }

  async practiceGate(artifact: ArtifactRecord, version: ArtifactVersionRecord) {
    const subject = await this.subject(artifact, version);
    if (!subject || artifact.status !== 'published' || (await this.quality.read(subject.context, subject.proof)).status !== 'accepted') return null;
    const context = subject.context;
    const teaching = await this.bindings.getFrozenTeachingBundle(context.project.id, context.project.templateVersionId!);
    const phase = teaching.template.phases.find(item => item.phase === 'guided_practice');
    return phase?.evidenceProfile === 'rubric_artifact' && phase.gateCondition === 'rubric_artifact_validated'
      && context.lesson.phase === 'guided_practice' && context.lesson.checkpoint?.requiredGate === 'rubric_artifact_validated'
      ? 'rubric_artifact_validated' as const : null;
  }
}
