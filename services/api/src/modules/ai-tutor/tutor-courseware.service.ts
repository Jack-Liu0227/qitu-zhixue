import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import type { CurrentUser, TutorCoursewareView, TutorLearningScope, CoursewareInstance, CoursewareFeedbackKind } from '@qitu/contracts';
import { teachingValueDigest } from '../templates/teaching-bundle.canonical';
import { TutorService } from './tutor.service';
import { CoursewareStore } from '../knowledge/courseware.store';
import { CoursewareService, coursewareObject } from '../knowledge/courseware.service';
import { KnowledgeRetrievalService } from '../knowledge/knowledge-retrieval.service';
import { LearningPlanStore } from '../learning-plan/learning-plan.store';
import { coursewareSources, frozenTeachingSpec } from './tutor-courseware-activity';
import { isCoursewareActivityAuthorized } from './tutor-lesson-activity';

@Injectable()
export class TutorCoursewareService {
  constructor(private readonly tutor: TutorService, private readonly store: CoursewareStore,
    private readonly courseware: CoursewareService, private readonly knowledge: KnowledgeRetrievalService,
    private readonly plans: LearningPlanStore) {}

  private async current(actor: CurrentUser, projectId: string) {
    if (actor.role !== 'student') throw new ForbiddenException('仅允许学生本人使用课件。');
    const context = await this.tutor.readCoursewareContext(projectId, actor.id);
    if (context && frozenTeachingSpec(context.teaching) && !isCoursewareActivityAuthorized(context.runtime)) {
      throw new ConflictException({ code: 'COURSEWARE_NOT_AUTHORIZED', message: '本课课件权限已变化，请联系教师。' });
    }
    return context;
  }

  private async verify(actor: CurrentUser, context: NonNullable<Awaited<ReturnType<TutorCoursewareService['current']>>>, instance: CoursewareInstance) {
    const { access, teaching } = context;
    if (instance.curriculumHash !== teachingValueDigest(teaching.bundle.template)) return false;
    await this.courseware.assertInstanceAvailable(instance);
    if (!access.managed || !access.scope || !await access.authorize?.('ima_read_document')) return false;
    const allowed = await access.scope.refreshAllowedKnowledgeBaseIds();
    if (instance.sources.some(s => !allowed.includes(s.knowledgeBaseId))) return false;
    // Re-read through the ordinary retrieval owner. Cached content and published status confer no grant.
    for (const source of instance.sources) {
      const alreadyRead = [...access.readEvidence?.values() ?? []].some(v => v.expiresAt > Date.now()
        && v.knowledgeBaseId === source.knowledgeBaseId && v.documentRefHash === source.documentRefHash);
      if (alreadyRead) continue;
      const result = await this.knowledge.search(actor.id, teaching.role.assistantId, source.title, 5, access.managed);
      for (const evidence of result.evidence) {
        await this.knowledge.read(actor.id, teaching.role.assistantId, evidence.citationId, access.managed);
        if ([...access.readEvidence?.values() ?? []].some(v => v.expiresAt > Date.now()
          && v.knowledgeBaseId === source.knowledgeBaseId && v.documentRefHash === source.documentRefHash)) break;
      }
    }
    const verified = coursewareSources([...access.readEvidence?.values() ?? []].filter(s => s.expiresAt > Date.now()));
    if (!instance.sources.every(s => verified.some(v => v.knowledgeBaseId === s.knowledgeBaseId && v.documentRefHash === s.documentRefHash))) return false;
    const linked = instance.assetVersionId ?? instance.parentVersionId;
    if (linked) await this.courseware.reuse(linked, instance.objectiveRefs, verified, instance.curriculumHash);
    return true;
  }

  async read(actor: CurrentUser, projectId: string): Promise<TutorCoursewareView | null> {
    const context = await this.current(actor, projectId);
    const teachingSpec = context && frozenTeachingSpec(context.teaching);
    if (!context || !teachingSpec) return null;
    const teaching = context.teaching;
    const instances = await this.store.instances(projectId, teaching.planId, teaching.planRevision, teaching.session.id);
    const visible: CoursewareInstance[] = [];
    let blockedReason: string | null = null;
    for (const instance of instances.slice(-12)) {
      try { if (await this.verify(actor, context, instance)) visible.push(instance);
        else blockedReason = '课件来源暂时无法重新核验，请让 AI搭档重新读取本课资料。';
      } catch { blockedReason = '课件或来源暂不可用，请重试或联系教师。'; }
    }
    const pending = await this.plans.findAwaitingQuestion(actor.id, teaching.planId);
    if (pending) blockedReason = '当前有一道待答题。可以回看课件帮助理解，作答后再继续下一学习活动。';
    const activity = teaching.lesson.currentActivity;
    const canPrepare = !pending && ['review', 'theory'].includes(activity?.kind ?? '');
    const validCurrent = visible.some(instance => instance.activityId === activity?.activityId);
    const hadCurrent = instances.some(instance => instance.activityId === activity?.activityId);
    return { enabled: true, planId: teaching.planId, planRevision: teaching.planRevision, learningSessionId: teaching.session.id,
      activityId: activity?.activityId ?? null, teaching: teachingSpec, instances: visible,
      canContinue: canPrepare && (validCurrent || !hadCurrent), canPrepare, blockedReason };
  }

  async position(actor: CurrentUser, projectId: string, raw: unknown, key: string) {
    const input = coursewareObject(raw, ['planId', 'planRevision', 'learningSessionId', 'instanceId', 'position', 'continueLearning', 'feedback']);
    const context = await this.current(actor, projectId);
    if (!context || !frozenTeachingSpec(context.teaching) || typeof input.continueLearning !== 'boolean'
      || typeof input.position !== 'number' || !Number.isSafeInteger(input.position)) this.changed();
    if (input.feedback !== undefined && (!['science', 'match', 'understanding', 'rendering', 'suggestion'].includes(String(input.feedback)) || input.continueLearning)) this.changed();
    const teaching = context.teaching;
    const scope: TutorLearningScope = { planId: teaching.planId, planRevision: teaching.planRevision, learningSessionId: teaching.session.id };
    if (input.planId !== scope.planId || input.planRevision !== scope.planRevision || input.learningSessionId !== scope.learningSessionId) this.changed();
    const row = typeof input.instanceId === 'string' ? await this.store.instance(input.instanceId) : null;
    if (!row || row.value.projectId !== projectId || row.value.planId !== scope.planId
      || row.value.planRevision !== scope.planRevision || row.value.learningSessionId !== scope.learningSessionId) this.changed();
    if (input.continueLearning && await this.plans.findAwaitingQuestion(actor.id, scope.planId)) this.changed('请先完成当前待答题。');
    if (input.continueLearning && (row.value.activityId !== teaching.lesson.currentActivity?.activityId
      || !['review', 'theory'].includes(teaching.lesson.currentActivity?.kind ?? '')
      || input.position !== row.value.content.steps.length - 1)) this.changed('请先看完当前活动的课件。');
    if (!await this.verify(actor, context, row.value)) this.changed('课件来源已变化，请重新读取本课资料。');
    // Serialize the delivery receipt with session changes; network reads happen before taking this lock.
    return this.plans.withSessionProgressTransaction(actor.id, scope.planId, async store => {
      const fresh = await this.current(actor, projectId);
      if (!fresh || fresh.teaching.planId !== scope.planId || fresh.teaching.planRevision !== scope.planRevision
        || fresh.teaching.session.id !== scope.learningSessionId || input.continueLearning && await store.findAwaitingQuestion(actor.id, scope.planId)
        || input.continueLearning && fresh.teaching.lesson.currentActivity?.activityId !== row.value.activityId) this.changed();
      const allowed = await fresh.access.scope?.refreshAllowedKnowledgeBaseIds() ?? [];
      if (!await fresh.access.authorize?.('ima_read_document') || row.value.sources.some(s => !allowed.includes(s.knowledgeBaseId)
        || !fresh.access.scope?.knowledgeBaseIds.includes(s.knowledgeBaseId))) this.changed('课件来源权限已变化。');
      return input.feedback ? this.courseware.feedback(actor, row.value, input.feedback as CoursewareFeedbackKind, key)
        : this.courseware.acknowledge(actor, row.value, Number(input.position), input.continueLearning as boolean, key);
    });
  }
  private changed(message = '当前课时或课件已变化，请刷新。'): never {
    throw new ConflictException({ code: 'COURSEWARE_CONTEXT_CHANGED', message });
  }
}
