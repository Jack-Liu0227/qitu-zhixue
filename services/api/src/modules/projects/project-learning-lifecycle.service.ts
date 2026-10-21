import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { CurrentUser, ProjectStage, ReconcileProjectLearningRequest, ReconcileProjectLearningResponse } from '@qitu/contracts';
import { AuditWriter } from '../../common/audit/audit.service';
import { OutboxWriter } from '../../common/outbox/outbox.service';
import { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { hashIdempotentInput } from '../../common/idempotency/idempotency.hash';
import { LearningPlanStore } from '../learning-plan/learning-plan.store';
import { LearningSessionProgressService } from '../learning-plan/learning-session-progress.service';
import { MasteryDomainService } from '../mastery/mastery-domain.service';
import { TemplateBindingService } from '../templates/templates-binding.service';
import { WorksLearningEvidenceService } from '../works/works-learning-evidence.service';
import { PROJECT_STAGE_ORDER } from './intent-confirmation.state-machine';

export type ReconcileLearningInput = ReconcileProjectLearningRequest;
export type ReconcileLearningResult = ReconcileProjectLearningResponse;

/** Projects owns lifecycle; lesson participation, mastery and Works approval remain distinct facts. */
@Injectable()
export class ProjectLearningLifecycleService {
  constructor(
    private readonly store: LearningPlanStore,
    private readonly progress: LearningSessionProgressService,
    private readonly bindings: TemplateBindingService,
    private readonly mastery: MasteryDomainService,
    private readonly works: WorksLearningEvidenceService,
    private readonly idempotency: IdempotencyStore,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
  ) {}

  async reconcile(actor: CurrentUser, projectId: string, input: ReconcileLearningInput, key: string): Promise<ReconcileLearningResult> {
    if (actor.role !== 'student') throw new ForbiddenException('仅学生本人可提交学习进度请求');
    if (typeof input.planId !== 'string' || !input.planId || !Number.isSafeInteger(input.planRevision) || input.planRevision < 1) {
      throw new BadRequestException({ code: 'LEARNING_PROGRESS_INVALID', message: '需要当前计划与修订号。' });
    }
    await this.owned(actor, projectId, input);
    const scope = `project.learning.reconcile:${actor.id}:${projectId}`;
    const result = await this.idempotency.execute(scope, key, hashIdempotentInput(scope, { projectId }, input), async () => {
      const body = await this.store.withSessionProgressTransaction(actor.id, input.planId, async store => {
        const { project, plan } = await this.owned(actor, projectId, input, store);
        const teaching = await this.bindings.getFrozenTeachingBundle(projectId, project.templateVersionId!);
        const profile = teaching.template.curriculum?.profiles.find(item => item.id === teaching.scheduleProfileId);
        if (!profile || profile.sessions.some(session => !session.completionSpec)) this.reject('LEARNING_COMPLETION_CONTRACT_REQUIRED');
        const progress = await this.progress.readProgress(actor, plan.plan.id, store);
        if (!progress.contractReady || progress.planRevision !== input.planRevision) this.reject('LEARNING_PLAN_VERSION_MISMATCH');
        const current = progress.currentSessionId ? plan.sessions.find(session => session.id === progress.currentSessionId) : null;
        const final = [...plan.sessions].sort((a, b) => b.lessonIndex - a.lessonIndex)[0];
        if (!final) this.reject('LEARNING_SESSION_NOT_FOUND');
        const session = current ?? final;
        const frozen = profile.sessions.find(item => item.sessionIndex === session.lessonIndex);
        if (!frozen) this.reject('LEARNING_SESSION_NOT_FOUND');
        const proofs = await this.works.getLessonProofs(actor, input.planId, session.id, input.planRevision);
        let target: ProjectStage = 'intent_confirmed';
        if (frozen.phase === 'concept_mastery') target = frozen.checkpoint?.requiredGate === 'TheoryMastered' ? 'theory_check' : 'theory_learning';
        if (frozen.phase === 'guided_practice') {
          target = frozen.checkpoint?.requiredGate === 'experiment_report_validated' && proofs.submissions.some(proof => proof.kind === 'submitted_artifact')
            ? 'artifact_review' : 'practice_building';
        }
        if (frozen.phase === 'deliverable_review') {
          if (!proofs.approvedArtifacts.length) this.reject('PROJECT_REVIEW_REQUIRED');
          target = 'reflection';
        }
        if (progress.currentSessionId === null) {
          if (progress.completedCount !== profile.sessions.length || !proofs.approvedArtifacts.length || !proofs.reflections.length) this.reject('PROJECT_ARCHIVE_EVIDENCE_REQUIRED');
          target = 'completed';
        }
        if (PROJECT_STAGE_ORDER.indexOf(target) >= PROJECT_STAGE_ORDER.indexOf('practice_ready')) {
          const theoryIds = [...new Set(profile.sessions.filter(item => item.phase === 'concept_mastery').flatMap(item => item.objectiveIds))]
            .map(id => `${input.planId}:${id}`);
          if (!theoryIds.length || !await this.mastery.checkRequiredObjectives(actor, actor.id, input.planId, theoryIds, store)) this.reject('THEORY_MASTERED_REQUIRED');
        }
        const fromIndex = PROJECT_STAGE_ORDER.indexOf(project.status), targetIndex = PROJECT_STAGE_ORDER.indexOf(target);
        for (let index = fromIndex + 1; index <= targetIndex; index++) {
          const expected = PROJECT_STAGE_ORDER[index - 1]!, next = PROJECT_STAGE_ORDER[index]!;
          const eventId = `project.learning:${projectId}:${input.planRevision}:${next}`;
          const changed = await store.transitionProject(actor.id, projectId, expected, next, async tx => {
            await this.audit.write({ actorId: actor.id, actorRole: actor.role, action: 'project.learning.reconciled', targetType: 'project', targetId: projectId,
              idempotencyKey: eventId, detail: { planId: input.planId, planRevision: input.planRevision, from: expected, to: next, completedLessons: progress.completedCount } }, tx);
            await this.outbox.write({ id: eventId, topic: next === 'completed' ? 'project.completed' : 'project.advanced',
              payload: { studentId: actor.id, projectId, planId: input.planId, from: expected, to: next } }, tx);
          });
          if (!changed) this.reject('PROJECT_STATE_CHANGED');
        }
        if (target === 'completed' && plan.plan.status !== 'completed' &&
            !await store.finishPlanForProject(actor.id, input.planId, projectId, input.planRevision)) this.reject('LEARNING_PLAN_VERSION_MISMATCH');
        const refreshed = await store.findProject(projectId);
        const refreshedPlan = await store.findPlan(input.planId);
        return { projectId, stage: refreshed!.status, planStatus: refreshedPlan!.status, currentSessionId: progress.currentSessionId, replayed: false };
      });
      return { status: 200, body };
    });
    return { ...result.body, replayed: result.replayed };
  }

  private async owned(actor: CurrentUser, projectId: string, input: ReconcileLearningInput, store = this.store) {
    const project = await store.findProject(projectId);
    if (!project) throw new NotFoundException({ code: 'PROJECT_NOT_FOUND', message: '项目不存在。' });
    if (project.studentId !== actor.id) throw new ForbiddenException('无权访问该项目');
    const plan = await store.findBundle(input.planId);
    if (!plan || plan.plan.studentUserId !== actor.id || plan.plan.projectId !== projectId || !project.templateVersionId ||
        plan.plan.templateVersion !== project.templateVersionId || !plan.plan.confirmedAt || plan.plan.version !== input.planRevision ||
        !['active', 'completed'].includes(plan.plan.status)) this.reject('LEARNING_PLAN_VERSION_MISMATCH');
    return { project, plan };
  }
  private reject(code: string): never { throw new ConflictException({ code, message: '学习进度的服务端前置证据尚未满足，请查看课时任务或作品审核状态。' }); }
}
