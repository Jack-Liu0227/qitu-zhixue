import { ConflictException } from '@nestjs/common';
import { isObjectiveMastered } from '@qitu/ai-client';
import type { TutorProjectContext } from '@qitu/contracts';
import type { LearningPlanStore, LearningProjectRecord, ObjectiveRecord, SessionRecord } from '../learning-plan/learning-plan.store';
import type { CompiledTeachingRole, TeachingBundlePayload } from '../templates/teaching-bundle.types';

export interface TutorTeachingContext {
  bundle: TeachingBundlePayload;
  role: CompiledTeachingRole;
  session: SessionRecord;
  planId: string;
  planRevision: number;
  objective: ObjectiveRecord | null;
  lesson: NonNullable<TutorProjectContext['lesson']>;
  currentTask: TutorProjectContext['currentTask'];
}

function unavailable(code: string): never {
  throw new ConflictException({ code, message: '项目教学计划与冻结配置不一致，请联系教师或管理员。' });
}

/** Read-only projection of existing learning owners. Never completes sessions or grants a gate. */
export async function resolveTutorTeachingContext(
  store: LearningPlanStore,
  project: LearningProjectRecord,
  teaching: TeachingBundlePayload,
): Promise<TutorTeachingContext> {
  const plans = (await store.listPlansByStudent(project.studentId)).filter((plan) =>
    plan.projectId === project.id && (plan.status === 'active' || plan.status === 'completed'));
  if (plans.length !== 1) unavailable('PROJECT_TEACHING_PLAN_UNAVAILABLE');
  const plan = plans[0]!;
  const bundle = await store.findBundle(plan.id);
  const profile = teaching.template.curriculum?.profiles.find((entry) => entry.id === teaching.scheduleProfileId);
  if (!bundle || !profile || teaching.templateVersionId !== project.templateVersionId
    || bundle.plan.projectId !== project.id || bundle.plan.studentUserId !== project.studentId
    || bundle.plan.version !== plan.version || plan.templateVersion !== teaching.templateVersionId
    || !Number.isSafeInteger(plan.version) || plan.version < 1
    || plan.lessonCount !== profile.sessions.length || bundle.sessions.length !== profile.sessions.length) {
    unavailable('PROJECT_TEACHING_PLAN_MISMATCH');
  }
  const objectives = new Map(bundle.objectives.map((objective) => [objective.id, objective]));
  const sessions = [...bundle.sessions].sort((left, right) => left.index - right.index);
  const mapped = sessions.map((session) => {
    const frozen = profile.sessions.find((entry) => entry.sessionIndex === session.lessonIndex);
    if (!Number.isSafeInteger(session.index) || session.index < 0 || !Number.isSafeInteger(session.lessonIndex)
      || !frozen || session.planId !== plan.id || session.id !== `${plan.id}:${frozen.id}`
      || sessions.filter((entry) => entry.lessonIndex === session.lessonIndex).length !== 1) {
      unavailable('PROJECT_TEACHING_SESSION_INVALID');
    }
    const targets = frozen.objectiveIds.map((id) => objectives.get(`${plan.id}:${id}`));
    if (targets.some((target) => !target || target.planId !== plan.id)) unavailable('PROJECT_TEACHING_OBJECTIVE_INVALID');
    return { session, frozen, objectives: targets as ObjectiveRecord[] };
  });
  const awaiting = await store.findAwaitingQuestion(project.studentId, plan.id);
  let selected = awaiting ? mapped.find((entry) => entry.session.id === awaiting.sessionId) : undefined;
  let objective = awaiting ? objectives.get(awaiting.objectiveId) : undefined;
  if (awaiting && (!selected || !objective || awaiting.studentUserId !== project.studentId
    || awaiting.planId !== plan.id || ![...selected.session.theoryObjectiveIds, ...selected.session.practiceObjectiveIds,
      ...selected.objectives.map((entry) => entry.id)].includes(awaiting.objectiveId))) {
    unavailable('PROJECT_TEACHING_PENDING_SCOPE_INVALID');
  }
  if (!selected) {
    for (const entry of mapped) {
      for (const candidate of entry.objectives) {
        const mastery = await store.findMastery(project.studentId, candidate.id);
        if (!mastery || !isObjectiveMastered(candidate.type, {
          score: mastery.masteryBasisPoints / 10_000, qualitativeMastered: mastery.qualitativeMastered,
        })) { selected = entry; objective = candidate; break; }
      }
      if (selected) break;
    }
  }
  selected ??= mapped[mapped.length - 1];
  if (!selected) unavailable('PROJECT_TEACHING_SESSION_INVALID');
  const selectedIndex = selected.session.lessonIndex;
  const routes = teaching.sessionRoutes.filter((route) => route.sessionIndex === selectedIndex);
  const role = routes.length === 1 ? teaching.roles.find((entry) => entry.roleSlotId === routes[0]!.roleSlotId) : undefined;
  if (!role || !role.modelByPurpose.dialogue || !teaching.teamVersion.members.some((member) =>
    member.memberId === role.memberId && member.assistantId === role.assistantId)) unavailable('PROJECT_TEACHING_ROUTE_INVALID');
  const lesson = {
    lessonIndex: selected.session.lessonIndex, lessonCount: profile.sessions.length, title: selected.frozen.title,
    status: plan.status === 'completed' ? 'completed' as const : 'current' as const,
    checkpoint: selected.frozen.checkpoint?.requiredGate ?? null,
    planId: plan.id, planRevision: plan.version, learningSessionId: selected.session.id,
    roleSlotId: role.roleSlotId, assistantId: role.assistantId, objectiveId: objective?.id ?? null,
  };
  return {
    bundle: teaching, role, session: selected.session, planId: plan.id, planRevision: plan.version,
    objective: objective ?? null, lesson,
    currentTask: {
      id: objective?.id ?? selected.session.id, title: objective?.name ?? selected.frozen.title,
      detail: objective?.objective ?? selected.frozen.learningGoal ?? selected.frozen.title, isTodayFocus: true,
    },
  };
}
