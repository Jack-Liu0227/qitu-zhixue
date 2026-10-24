import { BadRequestException, ForbiddenException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { CurrentUser, LearningEvidenceProof, LessonQualityDecision, LessonQualityQueueItem, LessonQualityStatus } from '@qitu/contracts';
import type { AuditWriter } from '../../common/audit/audit.service';
import type { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { throwHttpForIdempotencyError } from '../../common/idempotency/idempotency.errors';
import type { LearningPlanStore } from '../learning-plan/learning-plan.store';
import type { TemplateBindingService } from '../templates/templates-binding.service';
import type { WorksDirectory } from './works.access';
import type { WorksStore } from './works.store';
import type { ProjectEvidenceStore } from './project-evidence.store';
import type { ProjectEvidenceMaterializer } from './project-evidence.service';
import { decodeInlineVersion } from './works-inline-content';
import { conflict, resolveLearningEvidenceContext } from './works-learning-context';
import type { WorksLearningEvidenceService } from './works-learning-evidence.service';
import { LEARNING_REVIEW_POLICY, type LessonQualityEvaluator } from './lesson-quality-evaluator';

type Context = Awaited<ReturnType<typeof resolveLearningEvidenceContext>>;
interface Ports {
  plans: LearningPlanStore; bindings: TemplateBindingService; directory: WorksDirectory; artifacts: WorksStore;
  facts: ProjectEvidenceStore; evidence: ProjectEvidenceMaterializer; audit: AuditWriter; idempotency: IdempotencyStore;
  readProofs?: WorksLearningEvidenceService['readLessonProofs'];
  evaluator?: LessonQualityEvaluator;
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Server-owned, version-bound evaluation in the existing Works evidence store. */
export class WorksLessonQuality {
  constructor(private readonly ports: Ports) {}

  async subject(context: Context, proof: LearningEvidenceProof) {
    if (proof.artifactVersionId) {
      const stored = await this.ports.artifacts.findVersionById(proof.artifactVersionId);
      if (!stored || stored.artifact.id !== proof.artifactId || stored.artifact.studentId !== context.project.studentId
        || stored.artifact.projectId !== context.project.id || stored.version.ordinal !== stored.artifact.currentVersionIndex) {
        conflict('LESSON_QUALITY_VERSION_CHANGED', '产物版本已变化，请重新提交当前版本');
      }
      const text = decodeInlineVersion(stored.version.note).inlineText;
      if (text === null) conflict('LESSON_QUALITY_CONTENT_REQUIRED', '产物正文不可用');
      return { content: text, subjectDigest: digest([proof.ref, proof.artifactVersionId, text]) };
    }
    const row = (await this.ports.facts.listByProject(context.project.id)).find(entry =>
      entry.studentUserId === context.project.studentId && `${entry.sourceKind}:${entry.sourceId}` === proof.ref);
    if (!row?.detail) conflict('LESSON_QUALITY_CONTENT_REQUIRED', '观察正文不可用');
    const data = JSON.parse(row.detail) as { observation?: unknown };
    if (typeof data.observation !== 'string') conflict('LESSON_QUALITY_CONTENT_REQUIRED', '观察正文不可用');
    return { content: data.observation, subjectDigest: digest([proof.ref, row.detail]) };
  }

  private identity(context: Context, proof: LearningEvidenceProof, subjectDigest: string) {
    return `lesson-quality:${digest([context.scope, proof.ref, subjectDigest, context.lesson.completionSpec, LEARNING_REVIEW_POLICY])}`;
  }

  async read(context: Context, proof: LearningEvidenceProof): Promise<LessonQualityStatus> {
    let subjectDigest: string;
    try { subjectDigest = (await this.subject(context, proof)).subjectDigest; }
    catch (error) {
      if (error instanceof ConflictException) return { status: 'stale', subjectDigest: '', feedback: [] };
      throw error;
    }
    const id = this.identity(context, proof, subjectDigest);
    const row = (await this.ports.facts.listByProject(context.project.id)).find(entry => entry.sourceId === id
      && entry.studentUserId === context.project.studentId && entry.sourceKind === 'task_submission');
    if (row?.detail) {
      const receipt = JSON.parse(row.detail) as { schema?: string; policyVersion?: string; quality?: LessonQualityStatus };
      const spec = context.lesson.completionSpec;
      const criteria = spec?.version === 'learning-session-completion.v2' ? spec.qualityReview.criteria : [];
      if (receipt.schema === 'qitu.lesson-quality.v2' && receipt.policyVersion === LEARNING_REVIEW_POLICY
        && receipt.quality?.subjectDigest === subjectDigest && Array.isArray(receipt.quality.feedback)
        && receipt.quality.feedback.length === criteria.length
        && criteria.every(criterion => receipt.quality!.feedback.filter(entry => entry.criterionId === criterion.id).length === 1)
        && receipt.quality.status === (receipt.quality.feedback.every(entry => entry.meets === true) ? 'accepted' : 'needs_revision')) return receipt.quality;
    }
    return { status: 'pending', subjectDigest, feedback: [] };
  }

  async review(_actor: CurrentUser, _planId: string, _learningSessionId: string, _input: LessonQualityDecision, _key: string): Promise<{ quality: LessonQualityStatus; replayed: boolean }> {
    throw new ForbiddenException({ code: 'TEACHER_LEARNING_READ_ONLY', message: '教师只读学习记录，质量评价由服务端自动完成。' });
  }

  async evaluate(actor: CurrentUser, context: Context, proof: LearningEvidenceProof): Promise<LessonQualityStatus> {
    if (actor.role !== 'student' || actor.id !== context.project.studentId) {
      throw new ForbiddenException({ code: 'LEARNING_EVIDENCE_FORBIDDEN', message: '仅学生本人可触发自动评价' });
    }
    const spec = context.lesson.completionSpec;
    if (spec?.version !== 'learning-session-completion.v2') conflict('LESSON_QUALITY_NOT_REQUIRED', '该课程没有冻结质量标准');
    const subject = await this.subject(context, proof);
    const prior = await this.read(context, proof);
    if (prior.status === 'accepted' || prior.status === 'needs_revision') return prior;
    if (!this.ports.evaluator) throw new ServiceUnavailableException({ code: 'LESSON_EVALUATION_UNAVAILABLE', message: '自动评价暂不可用，请稍后重试。' });
    const sourceId = this.identity(context, proof, subject.subjectDigest);
    const result = await this.ports.idempotency.execute('lesson.automatic-evaluation', sourceId, digest([context.scope, proof.ref, subject.subjectDigest]), async () => {
      const candidate = await this.ports.evaluator!.evaluate({ lesson: context.lesson, activityId: proof.activityId,
        kind: proof.kind, content: subject.content, criteria: spec.qualityReview.criteria, evidence: [] });
      const criteria = [...candidate.criteria].sort((a, b) => a.criterionId.localeCompare(b.criterionId));
      if (!candidate.providerId || !candidate.modelId || criteria.length !== spec.qualityReview.criteria.length
        || criteria.some(entry => typeof entry.meets !== 'boolean' || !entry.feedback?.trim() || entry.feedback.length > 500)
        || spec.qualityReview.criteria.some(item => criteria.filter(entry => entry.criterionId === item.id).length !== 1)) {
        throw new ServiceUnavailableException({ code: 'LESSON_EVALUATION_INVALID', message: '自动评价结果不完整，请重试。' });
      }
      // A model cannot authorize a stale project, revision or edited submission.
      const current = await resolveLearningEvidenceContext(this.ports.plans, this.ports.bindings, this.ports.directory, actor, context.scope);
      if (current.bundle.plan.status !== 'active') conflict('LEARNING_PLAN_NOT_ACTIVE', '课程已结束，不能新增评价');
      if ((await this.subject(current, proof)).subjectDigest !== subject.subjectDigest) conflict('LESSON_QUALITY_VERSION_CHANGED', '产物已修改，请重新评价');
      const quality: LessonQualityStatus = { status: criteria.every(entry => entry.meets) ? 'accepted' : 'needs_revision',
        subjectDigest: subject.subjectDigest, feedback: criteria };
      const detail = JSON.stringify({ schema: 'qitu.lesson-quality.v2', policyVersion: LEARNING_REVIEW_POLICY,
        providerId: candidate.providerId, modelId: candidate.modelId, quality });
      await this.ports.audit.write({ actorId: actor.id, actorRole: actor.role, action: 'learning.quality.automatically_evaluated',
        targetType: 'learning_session', targetId: context.scope.learningSessionId, idempotencyKey: sourceId,
        detail: { policyVersion: LEARNING_REVIEW_POLICY, planId: context.scope.planId, planRevision: context.scope.planRevision,
          evidenceRef: proof.ref, subjectDigest: subject.subjectDigest, providerId: candidate.providerId, modelId: candidate.modelId,
          status: quality.status, criterionIds: criteria.map(entry => entry.criterionId) } });
      await this.ports.evidence.ingestServerFacts([{ projectId: context.project.id, studentUserId: context.project.studentId,
        schoolId: null, artifactId: proof.artifactId ?? null, columnKind: 'independent', sourceKind: 'task_submission',
        sourceId, label: '自动学习质量评价', detail, occurredAt: new Date() }]);
      if ((await this.read(current, proof)).status !== quality.status) conflict('LESSON_QUALITY_READBACK_FAILED', '评价回读不一致，请重试');
      return { status: 200, body: quality };
    }).catch(throwHttpForIdempotencyError);
    await resolveLearningEvidenceContext(this.ports.plans, this.ports.bindings, this.ports.directory, actor, context.scope);
    if ((await this.subject(context, proof)).subjectDigest !== subject.subjectDigest) conflict('LESSON_QUALITY_VERSION_CHANGED', '产物已修改，请重新评价');
    return result.body;
  }

  async queue(actor: CurrentUser, studentId: string,cursor?: string): Promise<{ items: LessonQualityQueueItem[]; hasMore: boolean; nextCursor:string|null; unavailablePlans: number }> {
    if (actor.role !== 'teacher' || !await this.ports.directory.isMentorOf(actor.id, studentId)) {
      throw new ForbiddenException({ code: 'LESSON_QUALITY_FORBIDDEN', message: '无权读取该学生的课内评价' });
    }
    const plans = (await this.ports.plans.listPlansByStudent(studentId)).filter(plan => ['active', 'completed'].includes(plan.status))
      .sort((a,b)=>b.createdAt.getTime()-a.createdAt.getTime() || b.id.localeCompare(a.id));
    const position = cursor === undefined ? -1 : plans.findIndex(plan=>plan.id === cursor);
    if (cursor !== undefined && (typeof cursor !== 'string' || cursor.length > 200 || position < 0)) {
      throw new BadRequestException({code:'LESSON_QUALITY_CURSOR_INVALID',message:'评价列表已变化，请返回首页'});
    }
    const page = plans.slice(position+1,position+21);
    const items: LessonQualityQueueItem[] = [];
    let unavailablePlans = 0;
    for (const plan of page) {
      try {
      const bundle = await this.ports.plans.findBundle(plan.id);
      if (!bundle) continue;
      for (const session of [...bundle.sessions].sort((a, b) => a.index - b.index)) {
      const context = await resolveLearningEvidenceContext(this.ports.plans, this.ports.bindings, this.ports.directory,
        actor, { planId: plan.id, learningSessionId: session.id, planRevision: plan.version });
      const spec = context.lesson.completionSpec;
      if (spec?.version !== 'learning-session-completion.v2') continue;
      const proofs = await this.ports.readProofs!(actor, context.scope);
      for (const proof of [...proofs.submissions, ...proofs.observations, ...proofs.reflections].slice(-20)) {
        const quality = await this.read(context, proof);
        const subject = await this.subject(context, proof);
        items.push({ planId: plan.id, learningSessionId: session.id, planRevision: plan.version, projectId: context.project.id,
          lessonTitle: context.lesson.title, proof: { ...proof, quality }, criteria: spec.qualityReview.criteria, content: subject.content });
      }
      }
      } catch (error) {
        if (!(error instanceof ConflictException) && !(error instanceof ServiceUnavailableException)) throw error;
        unavailablePlans++;
      }
    }
    const hasMore = plans.length > position+21;
    return { items,hasMore,nextCursor:hasMore ? page.at(-1)!.id : null,unavailablePlans };
  }
}
