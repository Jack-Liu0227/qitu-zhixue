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

type Context = Awaited<ReturnType<typeof resolveLearningEvidenceContext>>;
interface Ports {
  plans: LearningPlanStore; bindings: TemplateBindingService; directory: WorksDirectory; artifacts: WorksStore;
  facts: ProjectEvidenceStore; evidence: ProjectEvidenceMaterializer; audit: AuditWriter; idempotency: IdempotencyStore;
  readProofs: WorksLearningEvidenceService['readLessonProofs'];
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Version-bound teacher decisions in the existing Works evidence store, never mastery or project gates. */
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

  private identity(context: Context, proof: LearningEvidenceProof, subjectDigest: string, mentorId: string | null) {
    return `lesson-quality:${digest([context.scope, proof.ref, subjectDigest, context.lesson.completionSpec, mentorId])}`;
  }

  async read(context: Context, proof: LearningEvidenceProof): Promise<LessonQualityStatus> {
    let subjectDigest: string;
    try { subjectDigest = (await this.subject(context, proof)).subjectDigest; }
    catch (error) {
      if (error instanceof ConflictException) return { status: 'stale', subjectDigest: '', feedback: [] };
      throw error;
    }
    const mentorId = await this.ports.directory.mentorOfStudent(context.project.studentId);
    const id = this.identity(context, proof, subjectDigest, mentorId);
    const row = (await this.ports.facts.listByProject(context.project.id)).find(entry => entry.sourceId === id
      && entry.studentUserId === context.project.studentId && entry.sourceKind === 'task_submission');
    if (row?.detail && mentorId) {
      const receipt = JSON.parse(row.detail) as { schema?: string; reviewerId?: string; quality?: LessonQualityStatus };
      const spec = context.lesson.completionSpec;
      const criteria = spec?.version === 'learning-session-completion.v2' ? spec.qualityReview.criteria : [];
      if (receipt.schema === 'qitu.lesson-quality.v1' && receipt.reviewerId === mentorId
        && receipt.quality?.subjectDigest === subjectDigest && Array.isArray(receipt.quality.feedback)
        && receipt.quality.feedback.length === criteria.length
        && criteria.every(criterion => receipt.quality!.feedback.filter(entry => entry.criterionId === criterion.id).length === 1)
        && receipt.quality.status === (receipt.quality.feedback.every(entry => entry.meets === true) ? 'accepted' : 'needs_revision')) return receipt.quality;
    }
    return { status: 'pending', subjectDigest, feedback: [] };
  }

  async review(actor: CurrentUser, planId: string, learningSessionId: string, input: LessonQualityDecision, key: string) {
    if (actor.role !== 'teacher') throw new ForbiddenException({ code: 'LESSON_QUALITY_FORBIDDEN', message: '仅当前班主任可以采纳课内质量评价' });
    const context = await resolveLearningEvidenceContext(this.ports.plans, this.ports.bindings, this.ports.directory,
      actor, { planId, learningSessionId, planRevision: input.planRevision });
    const spec = context.lesson.completionSpec;
    if (spec?.version !== 'learning-session-completion.v2') conflict('LESSON_QUALITY_NOT_REQUIRED', '该冻结课程未启用课内质量合同');
    if (typeof input.evidenceRef !== 'string' || input.evidenceRef.length > 500 || !/^[a-f0-9]{64}$/.test(input.subjectDigest)
      || !Array.isArray(input.criteria) || input.criteria.length !== spec.qualityReview.criteria.length
      || input.criteria.some(entry => !entry || typeof entry !== 'object')
      || new Set(input.criteria.map(entry => entry.criterionId)).size !== input.criteria.length
      || input.criteria.some(entry => !entry || !spec.qualityReview.criteria.some(criterion => criterion.id === entry.criterionId)
        || typeof entry.meets !== 'boolean' || typeof entry.feedback !== 'string' || entry.feedback.length > 500
        || !entry.meets && !entry.feedback.trim())) {
      throw new BadRequestException({ code: 'LESSON_QUALITY_INVALID', message: '请逐项核对冻结质量标准，并为需修改项填写反馈' });
    }
    const proofs = await this.ports.readProofs(actor, context.scope, [input.evidenceRef]);
    const proof = [...proofs.submissions, ...proofs.observations, ...proofs.reflections].find(entry => entry.ref === input.evidenceRef);
    if (!proof) conflict('LESSON_QUALITY_SCOPE_INVALID', '评价必须指向本课时的学习产物');
    const subject = await this.subject(context, proof);
    if (subject.subjectDigest !== input.subjectDigest) conflict('LESSON_QUALITY_VERSION_CHANGED', '待评价版本已变化，请重新读取');
    const criteria = [...input.criteria].sort((a, b) => a.criterionId.localeCompare(b.criterionId));
    const quality: LessonQualityStatus = { status: criteria.every(entry => entry.meets) ? 'accepted' : 'needs_revision',
      subjectDigest: subject.subjectDigest, feedback: criteria };
    const sourceId = this.identity(context, proof, subject.subjectDigest, actor.id);
    const detail = JSON.stringify({ schema: 'qitu.lesson-quality.v1', reviewerId: actor.id, quality });
    const result = await this.ports.idempotency.execute(`lesson.quality:${actor.id}:${planId}:${learningSessionId}`, key,
      digest([input.planRevision, input.evidenceRef, input.subjectDigest, criteria]), async () => {
        const prior = (await this.ports.facts.listByProject(context.project.id)).find(row => row.sourceId === sourceId);
        if (prior) {
          if (prior.detail !== detail) conflict('LESSON_QUALITY_ALREADY_RECORDED', '此版本已有评价，请提交修订后的新产物');
          return { status: 200, body: quality };
        }
        if (context.bundle.plan.status !== 'active') conflict('LEARNING_PLAN_NOT_ACTIVE', '课程已结束，不能新增评价');
        if (!await this.ports.directory.isMentorOf(actor.id, context.project.studentId)
          || await this.ports.directory.mentorOfStudent(context.project.studentId) !== actor.id) {
          throw new ForbiddenException({ code: 'LESSON_QUALITY_FORBIDDEN', message: '当前教师关系已变化' });
        }
        await this.ports.audit.write({ actorId: actor.id, actorRole: actor.role, action: 'learning.quality.reviewed',
          targetType: 'learning_session', targetId: learningSessionId, idempotencyKey: sourceId,
          detail: { planId, planRevision: input.planRevision, evidenceRef: proof.ref, subjectDigest: subject.subjectDigest,
            status: quality.status, criterionIds: criteria.map(entry => entry.criterionId) } });
        await this.ports.evidence.ingestServerFacts([{ projectId: context.project.id, studentUserId: context.project.studentId,
          schoolId: null, artifactId: proof.artifactId ?? null, columnKind: 'independent', sourceKind: 'task_submission',
          sourceId, label: '课内产物质量评价', detail, occurredAt: new Date() }]);
        const saved = (await this.ports.facts.listByProject(context.project.id)).find(row => row.sourceId === sourceId);
        if (saved?.detail !== detail) conflict('LESSON_QUALITY_READBACK_FAILED', '评价回读不一致，请重新读取');
        return { status: 200, body: quality };
      }).catch(throwHttpForIdempotencyError);
    // Revalidate the current teacher and immutable subject even for cached replays.
    await resolveLearningEvidenceContext(this.ports.plans, this.ports.bindings, this.ports.directory, actor, context.scope);
    if ((await this.subject(context, proof)).subjectDigest !== input.subjectDigest) conflict('LESSON_QUALITY_VERSION_CHANGED', '产物已变化');
    return { quality: result.body, replayed: result.replayed };
  }

  async queue(actor: CurrentUser, studentId: string,cursor?: string): Promise<{ items: LessonQualityQueueItem[]; hasMore: boolean; nextCursor:string|null; unavailablePlans: number }> {
    if (actor.role !== 'teacher' || !await this.ports.directory.isMentorOf(actor.id, studentId)) {
      throw new ForbiddenException({ code: 'LESSON_QUALITY_FORBIDDEN', message: '无权读取该学生的课内评价' });
    }
    const plans = (await this.ports.plans.listPlansByStudent(studentId)).filter(plan => plan.status === 'active')
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
      const completed = new Set((await this.ports.plans.listSessionCompletions(plan.id, plan.version)).map(row => row.learningSessionId));
      const session = [...bundle.sessions].sort((a, b) => a.index - b.index).find(entry => !completed.has(entry.id));
      if (!session) continue;
      const context = await resolveLearningEvidenceContext(this.ports.plans, this.ports.bindings, this.ports.directory,
        actor, { planId: plan.id, learningSessionId: session.id, planRevision: plan.version });
      const spec = context.lesson.completionSpec;
      if (spec?.version !== 'learning-session-completion.v2') continue;
      const proofs = await this.ports.readProofs(actor, context.scope);
      for (const proof of [...proofs.submissions, ...proofs.observations, ...proofs.reflections].slice(-20)) {
        const quality = await this.read(context, proof);
        if (quality.status !== 'pending') continue;
        const subject = await this.subject(context, proof);
        items.push({ planId: plan.id, learningSessionId: session.id, planRevision: plan.version, projectId: context.project.id,
          lessonTitle: context.lesson.title, proof: { ...proof, quality }, criteria: spec.qualityReview.criteria, content: subject.content });
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
