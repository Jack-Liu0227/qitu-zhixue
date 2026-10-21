import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { CurrentUser } from '@qitu/contracts';
import { hasLearningSessionCompletion } from '@qitu/contracts';
import type { LearningPlanStore } from '../learning-plan/learning-plan.store';
import type { MasteryDomainService } from '../mastery/mastery-domain.service';
import type { TemplateBindingService } from '../templates/templates-binding.service';
import type { WorksDirectory } from './works.access';
import type { LearningEvidenceScope } from './works-learning-evidence.types';

export async function resolveLearningEvidenceContext(
  plans: LearningPlanStore, bindings: TemplateBindingService, directory: WorksDirectory,
  actor: CurrentUser, input: Omit<LearningEvidenceScope, 'projectId' | 'objectiveIds'> & {
    projectId?: string; objectiveIds?: readonly string[];
  }, write = false,
) {
  const bundle = await plans.findBundle(input.planId);
  if (!bundle?.plan.projectId) throw new NotFoundException({ code: 'PLAN_NOT_FOUND', message: '学习计划不存在' });
  const plan = bundle.plan;
  const project = await plans.findProject(plan.projectId!);
  if (!project || (actor.role !== 'student' || actor.id !== plan.studentUserId)
    && (write || actor.role !== 'teacher' || !await directory.isMentorOf(actor.id, plan.studentUserId))) {
    throw new ForbiddenException({ code: 'LEARNING_EVIDENCE_FORBIDDEN', message: '无权访问该学习证据' });
  }
  if (project.studentId !== plan.studentUserId || !project.templateVersionId
    || input.projectId !== undefined && input.projectId !== project.id
    || !Number.isSafeInteger(input.planRevision) || input.planRevision !== plan.version
    || !plan.confirmedAt || (write ? plan.status !== 'active' : !['active', 'completed'].includes(plan.status))) {
    conflict('LEARNING_EVIDENCE_SCOPE_MISMATCH', '计划版本或项目范围已变化，请刷新后重试');
  }
  const teaching = await bindings.getFrozenTeachingBundle(project.id, project.templateVersionId);
  const profile = teaching.template.curriculum?.profiles.find((entry) => entry.id === teaching.scheduleProfileId);
  const session = bundle.sessions.find((entry) => entry.id === input.learningSessionId);
  const lesson = profile?.sessions.find((entry) => entry.sessionIndex === session?.lessonIndex);
  if (!profile || !session || !lesson || session.planId !== plan.id || session.id !== `${plan.id}:${lesson.id}`
    || teaching.templateVersionId !== project.templateVersionId || plan.templateVersion !== project.templateVersionId
    || bundle.sessions.length !== profile.sessions.length || plan.lessonCount !== profile.sessions.length
    || bundle.sessions.filter((entry) => entry.lessonIndex === lesson.sessionIndex).length !== 1) {
    conflict('LEARNING_EVIDENCE_SESSION_MISMATCH', '课时与冻结教学计划不一致');
  }
  const objectiveIds = lesson.objectiveIds.map((id) => `${plan.id}:${id}`);
  if (!objectiveIds.length || objectiveIds.some((id) => !bundle.objectives.some((objective) => objective.id === id && objective.planId === plan.id))
    || input.objectiveIds !== undefined && !sameIds(input.objectiveIds, objectiveIds)) {
    conflict('LEARNING_EVIDENCE_OBJECTIVE_MISMATCH', '证据目标不属于该课时');
  }
  const scope: LearningEvidenceScope = { projectId: project.id, planId: plan.id, planRevision: plan.version,
    learningSessionId: session.id, objectiveIds };
  if (write && profile.sessions.every(hasLearningSessionCompletion)) {
    const completed = new Set((await plans.listSessionCompletions(plan.id, plan.version)).map((entry) => entry.learningSessionId));
    const current = [...bundle.sessions].sort((left, right) => left.index - right.index).find((entry) => !completed.has(entry.id));
    if (current?.id !== session.id) conflict('LEARNING_SESSION_OUT_OF_ORDER', '请先完成当前课时，再提交后续课时的学习证据');
  }
  return { bundle, project, session, lesson, scope };
}

export async function requireLearningPracticeGate(
  mastery: MasteryDomainService, plans: LearningPlanStore, actor: CurrentUser,
  context: Awaited<ReturnType<typeof resolveLearningEvidenceContext>>,
): Promise<void> {
  if (context.lesson.phase !== 'guided_practice' && context.lesson.phase !== 'deliverable_review') return;
  const required = [...new Set(context.bundle.sessions.flatMap((session) => session.theoryObjectiveIds))];
  if (!required.length || !await mastery.checkRequiredObjectives(actor, context.project.studentId, context.scope.planId, required, plans)) {
    conflict('THEORY_MASTERED_REQUIRED', '需先取得当前有效的理论掌握证明');
  }
}

export function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && new Set(left).size === left.length && left.every((id) => right.includes(id));
}

export function conflict(code: string, message: string): never { throw new ConflictException({ code, message }); }
