import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { CompleteLearningSessionResponse, CurrentUser, LearningSessionProgressView, PblTemplateSession } from '@qitu/contracts';
import { hasLearningSessionCompletion } from '@qitu/contracts';
import { AccessPolicy } from '../../common/access/access-policy';
import { AuditWriter } from '../../common/audit/audit.service';
import { MasteryDomainService } from '../mastery/mastery-domain.service';
import { TemplateBindingService } from '../templates/templates-binding.service';
import { WorksLearningEvidenceService } from '../works/works-learning-evidence.service';
import { LearningPlanStore, type PlanBundle, type SessionCompletionRecord, type SessionRecord } from './learning-plan.store';
import { projectLessonActivities } from './lesson-activity-progress';

interface SessionContext { session: SessionRecord; frozen: PblTemplateSession; objectiveIds: string[] }
interface ProgressContext { bundle: PlanBundle; projectId: string; sessions: SessionContext[]; contractReady: boolean; }
function fail(code: string, message: string): never { throw new ConflictException({ code, message }); }
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Owns lesson completion only. Evidence, mastery, works approval and project stages retain their owners. */
@Injectable()
export class LearningSessionProgressService {
  constructor(
    private readonly store: LearningPlanStore,
    private readonly access: AccessPolicy,
    private readonly bindings: TemplateBindingService,
    private readonly mastery: MasteryDomainService,
    private readonly works: WorksLearningEvidenceService,
    private readonly audit: AuditWriter,
  ) {}

  async readProgress(actor: CurrentUser, planId: string, store: LearningPlanStore = this.store): Promise<LearningSessionProgressView> {
    const context = await this.context(actor, planId, store);
    return this.project(actor, context, store);
  }

  async complete(actor: CurrentUser, planId: string, sessionId: string, body: unknown, rawKey: string | undefined): Promise<CompleteLearningSessionResponse> {
    if (actor.role !== 'student') throw new ForbiddenException({ code: 'LEARNING_SESSION_FORBIDDEN', message: '只有学生本人可提交课时完成请求' });
    const input = this.input(body, rawKey);
    const key = `session-complete:${digest([actor.id, planId, input.key])}`;
    const requestHash = digest([planId, sessionId, input.projectId, input.planRevision, input.evidenceRefs]);
    return this.store.withSessionProgressTransaction(actor.id, planId, async (store) => {
      const context = await this.context(actor, planId, store);
      const plan = context.bundle.plan;
      if (plan.studentUserId !== actor.id) throw new ForbiddenException({ code: 'LEARNING_SESSION_FORBIDDEN', message: '无权完成其他学生的课时' });
      if (context.projectId !== input.projectId || plan.version !== input.planRevision) fail('LEARNING_SESSION_SCOPE_STALE', '项目或计划版本已变化，请刷新');
      const selected = context.sessions.find((entry) => entry.session.id === sessionId);
      if (!selected) throw new NotFoundException({ code: 'LEARNING_SESSION_NOT_FOUND', message: '课时不属于当前计划' });
      const byKey = await store.findSessionCompletionByKey(key);
      if (byKey && byKey.requestHash !== requestHash) fail('IDEMPOTENCY_KEY_CONFLICT', '该幂等键已用于不同的完成请求');
      const records = await store.listSessionCompletions(planId, plan.version);
      const existing = byKey ?? records.find((entry) => entry.learningSessionId === sessionId);
      if (existing) return this.response(actor, context, existing, true, store);
      if (plan.status !== 'active') fail('LEARNING_PLAN_NOT_ACTIVE', '学习计划尚未开始或已结束');
      if (!context.contractReady) fail('LEARNING_SESSION_CONTRACT_REQUIRED', '冻结课程缺少课时完成规则，请管理员更新课程合同');
      const completed = new Set(records.map((entry) => entry.learningSessionId));
      if (context.sessions.find((entry) => !completed.has(entry.session.id))?.session.id !== sessionId) fail('LEARNING_SESSION_OUT_OF_ORDER', '请先完成前面的课时');
      const result = await this.requirements(actor, context, selected, store, input.evidenceRefs.length ? input.evidenceRefs : undefined);
      if (result.blockers.length) throw new ConflictException({ code: 'LEARNING_SESSION_REQUIREMENTS_UNMET', message: '本课完成条件尚未满足', blockers: result.blockers });
      const record: SessionCompletionRecord = {
        id: randomUUID(), studentUserId: actor.id, projectId: context.projectId, planId, planRevision: plan.version,
        learningSessionId: sessionId, evidenceRefs: result.evidenceRefs, idempotencyKey: key, requestHash, completedAt: new Date(),
      };
      await store.saveSessionCompletion(record, async (tx) => {
        await this.audit.write({ actorId: actor.id, actorRole: actor.role, action: 'learning.session.complete',
          targetType: 'learning_session', targetId: sessionId, idempotencyKey: key,
          detail: { planId, projectId: context.projectId, planRevision: plan.version, evidenceRefs: record.evidenceRefs },
        }, tx);
      });
      return this.response(actor, context, record, false, store);
    });
  }

  private async context(actor: CurrentUser, planId: string, store: LearningPlanStore): Promise<ProgressContext> {
    if (actor.role !== 'student' && actor.role !== 'teacher') throw new ForbiddenException({ code: 'LEARNING_SESSION_FORBIDDEN', message: '课时进度仅向学生本人和当前导师开放' });
    const bundle = await store.findBundle(planId);
    if (!bundle) throw new NotFoundException({ code: 'LEARNING_PLAN_NOT_FOUND', message: '学习计划不存在' });
    if (!(await this.access.canReadStudent(actor, bundle.plan.studentUserId))) throw new ForbiddenException({ code: 'LEARNING_SESSION_FORBIDDEN', message: '无权读取该学习计划' });
    const plan = bundle.plan;
    const project = plan.projectId ? await store.findProject(plan.projectId) : null;
    if (!project || project.studentId !== plan.studentUserId || !project.templateVersionId
      || project.templateVersionId !== plan.templateVersion || !Number.isSafeInteger(plan.version) || plan.version < 1) {
      fail('LEARNING_SESSION_SCOPE_INVALID', '学习计划缺少一致的正式项目范围');
    }
    const teaching = await this.bindings.getFrozenTeachingBundle(project.id, project.templateVersionId);
    const profile = teaching.template.curriculum?.profiles.find((entry) => entry.id === teaching.scheduleProfileId);
    if (!profile || teaching.templateVersionId !== project.templateVersionId || profile.sessions.length !== bundle.sessions.length
      || plan.lessonCount !== profile.sessions.length) fail('LEARNING_SESSION_CONTRACT_INVALID', '冻结课表与计划不一致');
    const objectives = new Set(bundle.objectives.map((entry) => entry.id));
    const sessions = [...bundle.sessions].sort((a, b) => a.index - b.index).map((session, index) => {
      const frozen = profile.sessions[index];
      if (!frozen || session.index !== index || session.lessonIndex !== frozen.sessionIndex
        || session.id !== `${plan.id}:${frozen.id}` || session.planId !== plan.id) fail('LEARNING_SESSION_CONTRACT_INVALID', '课时与冻结课程不一致');
      const objectiveIds = frozen.objectiveIds.map((id) => `${plan.id}:${id}`);
      if (objectiveIds.some((id) => !objectives.has(id))) fail('LEARNING_SESSION_CONTRACT_INVALID', '课时目标不属于当前计划');
      return { session, frozen, objectiveIds };
    });
    return { bundle, projectId: project.id, sessions, contractReady: sessions.every((entry) => hasLearningSessionCompletion(entry.frozen)) };
  }

  private async requirements(actor: CurrentUser, context: ProgressContext, selected: SessionContext, store: LearningPlanStore, refs?: readonly string[]) {
    const blockers: string[] = [];
    const spec = selected.frozen.completionSpec;
    if (!spec) return { blockers: ['LEARNING_SESSION_CONTRACT_REQUIRED'], evidenceRefs: [] as string[] };
    const { plan } = context.bundle;
    const masteryIds = spec.requiredMasteryObjectiveIds.map((id) => `${plan.id}:${id}`);
    if (masteryIds.length && !(await this.mastery.checkRequiredObjectives(actor, plan.studentUserId, plan.id, masteryIds, store))) blockers.push('REQUIRED_THEORY_NOT_MASTERED');
    if (selected.frozen.phase === 'guided_practice' || selected.frozen.phase === 'deliverable_review') {
      const theoryIds = [...new Set(context.sessions.filter((entry) => entry.frozen.phase === 'concept_mastery').flatMap((entry) => entry.objectiveIds))];
      if (!theoryIds.length || !(await this.mastery.checkRequiredObjectives(actor, plan.studentUserId, plan.id, theoryIds, store))) blockers.push('THEORY_GATE_REQUIRED');
    }
    const awaiting = await store.findAwaitingQuestion(plan.studentUserId, plan.id);
    if (awaiting) blockers.push('PENDING_QUESTION_REQUIRES_ANSWER');
    const proof = await this.works.readLessonProofs(actor, { projectId: context.projectId, planId: plan.id,
      planRevision: plan.version, learningSessionId: selected.session.id, objectiveIds: selected.objectiveIds }, refs);
    const responseProofs = selected.frozen.checkpoint?.requiredGate === 'review_completed_and_archived'
      ? proof.reflections : [...proof.reflections, ...proof.submissions.filter((entry) => entry.kind === 'session_response')];
    const reportSessionIds = new Set(context.sessions.filter((entry) => entry.frozen.checkpoint?.requiredGate === 'experiment_report_validated')
      .map((entry) => entry.session.id));
    const approvedReports = selected.frozen.checkpoint?.requiredGate === 'review_completed_and_archived'
      ? proof.approvedArtifacts.filter((entry) => reportSessionIds.has(entry.scope.learningSessionId)) : proof.approvedArtifacts;
    const evidence = {
      session_response: responseProofs,
      experiment_observation: proof.observations,
      submitted_artifact: proof.submissions.filter((entry) => entry.kind === 'submitted_artifact'),
      approved_artifact: approvedReports,
    };
    const acceptedRefs = new Set<string>();
    for (const requirement of spec.requiredEvidence) {
      const matching = evidence[requirement.kind].filter((entry) => entry.scope.projectId === context.projectId
        && entry.scope.planId === plan.id && entry.scope.planRevision === plan.version
        && (requirement.scope === 'project' || entry.scope.learningSessionId === selected.session.id));
      const qualified = [];
      for (const proof of matching) {
        if (spec.version === 'learning-session-completion.v2' && requirement.kind !== 'approved_artifact'
          && !await this.works.lessonQualityAccepted(actor, proof.scope, proof)) continue;
        qualified.push(proof);
      }
      const distinct = [...new Set(qualified.map((entry) => entry.ref))];
      if (spec.version === 'learning-session-completion.v2' && qualified.length < requirement.minimumCount
        && matching.length >= requirement.minimumCount) blockers.push('LESSON_QUALITY_REQUIRED');
      if (distinct.length < requirement.minimumCount) blockers.push(`EVIDENCE_REQUIRED:${requirement.kind}`);
      for (const ref of distinct.slice(0, requirement.minimumCount)) acceptedRefs.add(ref);
    }
    // A report's approval must refer to the same immutable artifact version submitted this lesson.
    if (selected.frozen.checkpoint?.requiredGate === 'experiment_report_validated'
      && !proof.submissions.some((submission) => submission.kind === 'submitted_artifact' && proof.approvedArtifacts.some((approved) =>
        !!submission.artifactId && !!submission.artifactVersionId && approved.artifactId === submission.artifactId && approved.artifactVersionId === submission.artifactVersionId))) blockers.push('SUBMITTED_REPORT_APPROVAL_REQUIRED');
    const activities = selected.frozen.activityRequirements ? await this.activities(actor, context, selected, store) : undefined;
    if (activities?.some(activity => activity.status !== 'completed')) blockers.push('LESSON_ACTIVITIES_INCOMPLETE');
    for (const activity of activities ?? []) for (const ref of activity.evidenceRefs) acceptedRefs.add(ref);
    return { blockers, evidenceRefs: [...acceptedRefs].sort() };
  }

  private async activities(actor: CurrentUser, context: ProgressContext, selected: SessionContext, store: LearningPlanStore, completed = false, locked = false) {
    if (completed || locked) return projectLessonActivities({ lesson: selected.frozen, sessionId: selected.session.id,
      proofs: [], masteryAccepted: false, sessionCompleted: completed, locked });
    const { plan } = context.bundle;
    const view = await this.works.getLessonProofs(actor, plan.id, selected.session.id, plan.version);
    const ids = selected.frozen.completionSpec?.requiredMasteryObjectiveIds.map(id => `${plan.id}:${id}`) ?? [];
    const awaiting = await store.findAwaitingQuestion(plan.studentUserId, plan.id);
    return projectLessonActivities({ lesson: selected.frozen, sessionId: selected.session.id,
      proofs: [...view.submissions, ...view.observations, ...view.reflections], sessionCompleted: completed, locked,
      masteryAccepted: !awaiting && ids.length > 0 && await this.mastery.checkRequiredObjectives(actor, plan.studentUserId, plan.id, ids, store) });
  }

  private async project(actor: CurrentUser, context: ProgressContext, store: LearningPlanStore): Promise<LearningSessionProgressView> {
    const { plan } = context.bundle;
    const completions = new Map((await store.listSessionCompletions(plan.id, plan.version)).map((entry) => [entry.learningSessionId, entry]));
    const current = context.sessions.find((entry) => !completions.has(entry.session.id));
    const sessions = [];
    for (const entry of context.sessions) {
      const completed = completions.get(entry.session.id);
      const isCurrent = current?.session.id === entry.session.id;
      const blockers = completed ? [] : !context.contractReady ? ['LEARNING_SESSION_CONTRACT_REQUIRED']
        : !isCurrent ? ['PREVIOUS_SESSION_INCOMPLETE'] : plan.status !== 'active' ? ['LEARNING_PLAN_NOT_ACTIVE']
          : (await this.requirements(actor, context, entry, store)).blockers;
      sessions.push({ sessionId: entry.session.id, lessonIndex: entry.session.lessonIndex, title: entry.frozen.title,
        ...(entry.frozen.activityRequirements ? { activities: await this.activities(actor, context, entry, store, !!completed, !completed && !isCurrent) } : {}),
        status: completed ? 'completed' as const : isCurrent ? 'current' as const : 'locked' as const,
        completedAt: completed?.completedAt.toISOString() ?? null, canComplete: isCurrent && !completed && blockers.length === 0, blockers });
    }
    return { planId: plan.id, projectId: context.projectId, planRevision: plan.version, currentSessionId: current?.session.id ?? null,
      completedCount: sessions.filter((entry) => entry.status === 'completed').length, totalCount: sessions.length, contractReady: context.contractReady, sessions };
  }

  private async response(actor: CurrentUser, context: ProgressContext, record: SessionCompletionRecord, replayed: boolean, store: LearningPlanStore): Promise<CompleteLearningSessionResponse> {
    return { completion: { sessionId: record.learningSessionId, completedAt: record.completedAt.toISOString(), evidenceRefs: [...record.evidenceRefs] },
      progress: await this.project(actor, context, store), replayed };
  }

  private input(body: unknown, rawKey: string | undefined) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException({ code: 'INVALID_SESSION_COMPLETION', message: '完成请求必须是对象' });
    const value = body as Record<string, unknown>;
    if (Object.keys(value).some((key) => !['projectId', 'planRevision', 'evidenceRefs'].includes(key))
      || typeof value.projectId !== 'string' || !value.projectId.trim() || value.projectId.length > 200
      || !Number.isSafeInteger(value.planRevision) || (value.planRevision as number) < 1
      || !Array.isArray(value.evidenceRefs) || value.evidenceRefs.length > 20
      || value.evidenceRefs.some((ref) => typeof ref !== 'string' || ref !== ref.trim() || !ref || ref.length > 500)
      || new Set(value.evidenceRefs).size !== value.evidenceRefs.length) {
      throw new BadRequestException({ code: 'INVALID_SESSION_COMPLETION', message: '项目、版本或证据引用格式无效' });
    }
    if (!rawKey?.trim() || rawKey.length > 200) throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED', message: '需要有效的 Idempotency-Key' });
    return { projectId: value.projectId, planRevision: value.planRevision as number, evidenceRefs: [...value.evidenceRefs as string[]].sort(), key: rawKey.trim() };
  }
}
