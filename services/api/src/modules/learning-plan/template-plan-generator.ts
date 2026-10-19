import { parseProjectTemplateSpec, ProjectTemplateSpecError, type KnowledgeType, type PblTemplateObjective, type ProjectTemplateSpec, type SessionBlockKind } from '@qitu/contracts';
import type { GeneratedBlock, GeneratedPlan, GeneratePlanInput, PlanSessionCount } from './plan-generator';
import { PlanGenerationError } from './session-plan-validator';

const BLOCK_ORDER: readonly SessionBlockKind[] = ['review', 'theory', 'check', 'practice', 'reflect'];
const BLOCK_TITLES: Record<SessionBlockKind, string> = {
  review: '衔接回顾', theory: '概念探究', check: '理解检查', practice: '探究实践', reflect: '反思迁移',
};

function reject(path: string, message: string): never {
  throw new PlanGenerationError(message, [{ path, message }]);
}

function knowledgeType(objective: PblTemplateObjective): KnowledgeType {
  if (objective.knowledgeType !== undefined && objective.knowledgeType !== null) return objective.knowledgeType;
  if (objective.kind === 'reflection') return 'design';
  return objective.kind;
}

function readTemplate(input: unknown): ProjectTemplateSpec {
  try { return parseProjectTemplateSpec(input); }
  catch (error) {
    if (error instanceof ProjectTemplateSpecError) throw new PlanGenerationError('Invalid resolved teaching template', error.errors);
    throw error;
  }
}

/** Project the resolved immutable template, never a global optics constant. */
export function generatePlanFromTemplate(
  input: GeneratePlanInput,
  context: { templateVersion: string; templateSpec: unknown },
): GeneratedPlan {
  const spec = readTemplate(context.templateSpec);
  const profiles = spec.curriculum?.profiles;
  if (profiles === undefined) reject('curriculum.profiles', 'This template requires governed curriculum profiles');
  const candidates = profiles.filter((profile) => {
    const schedule = profile.schedule;
    return schedule.durationWeeks === input.weeks
      && (input.sessionCount === undefined || profile.sessions.length === input.sessionCount)
      && (input.schedule === undefined || (schedule.weeklyMinutes === input.schedule.weeklyMinutes
        && schedule.durationWeeks === input.schedule.durationWeeks
        && schedule.sessionsPerWeek === input.schedule.sessionsPerWeek && schedule.sessionMinutes === input.schedule.sessionMinutes));
  });
  const profile = candidates[0];
  if (profile === undefined || candidates.length !== 1) reject('schedule', 'Select exactly one approved template schedule profile');
  const count = profile.sessions.length;
  let sessionCount: PlanSessionCount;
  if (count === 4 || count === 8 || count === 16) sessionCount = count;
  else reject('sessions', 'Unsupported session count');
  const byId = new Map(spec.objectives.map((objective) => [objective.id, objective]));
  const gated = spec.phases.find((phase) => phase.phase === 'concept_mastery')?.objectiveIds;
  if (gated === undefined || gated.length === 0) reject('phases', 'The template must declare theory gate objectives');
  const moduleId = (week: number): string => `${profile.id}-week-${week}`;
  const modules = Array.from({ length: profile.schedule.durationWeeks }, (_, index) => {
    const week = index + 1;
    const sessions = profile.sessions.filter((session) => session.week === week);
    return { id: moduleId(week), name: `第${week}周 · ${sessions[0]?.title ?? spec.title}`, weekIndex: week,
      objective: sessions.map((session) => session.title).join('；'), ordinal: week };
  });
  const objectives = spec.objectives.map((objective, index) => {
    const session = profile.sessions.find((candidate) => candidate.objectiveIds.includes(objective.id));
    if (session === undefined) reject('objectives', `Objective ${objective.id} is not scheduled`);
    return { id: objective.id, moduleId: moduleId(session.week), name: objective.title,
      type: knowledgeType(objective), objective: objective.description, prerequisiteIds: [...objective.prerequisiteIds],
      ordinal: index + 1, conceptId: objective.conceptId };
  });
  const sessions = profile.sessions.map((session, index) => {
    const practice = session.phase === 'guided_practice';
    const prerequisites = [...new Set(session.objectiveIds.flatMap((id) => byId.get(id)?.prerequisiteIds ?? []))];
    const previous = profile.sessions[index - 1]?.objectiveIds ?? [];
    const blocks: GeneratedBlock[] = BLOCK_ORDER.filter((kind) => session.blocks[kind] > 0).map((kind) => {
      const guidance = [kind === 'theory' ? session.learningGoal : undefined, session.activityGuidance?.[kind]]
        .filter((text) => text !== undefined).join('\n');
      return {
        id: `${session.id}-${kind}`,
        title: BLOCK_TITLES[kind],
        kind,
        minutes: session.blocks[kind],
        ...(guidance.length === 0 ? {} : { guidance }),
        ...(kind === 'reflect' && session.evidenceRequirements !== undefined
          ? { evidenceRequirements: [...session.evidenceRequirements] } : {}),
        activity: kind === 'theory' ? 'learn' : kind === 'check' ? 'reflect' : kind,
        objectiveIds: [...(practice && (kind === 'review' || kind === 'theory' || kind === 'check')
          ? prerequisites : kind === 'review' ? previous : session.objectiveIds)],
        prerequisiteObjectiveIds: kind === 'practice' ? prerequisites : [],
      };
    });
    return { id: session.id, moduleId: moduleId(session.week), index, week: session.week, day: session.session,
      title: session.title, blocks, theoryObjectiveIds: session.phase === 'concept_mastery' ? [...session.objectiveIds]
        : practice ? [...gated] : [], practiceObjectiveIds: practice ? [...session.objectiveIds] : [], mode: 'study' as const };
  });
  return { templateVersion: context.templateVersion, weeks: profile.schedule.durationWeeks, sessionCount,
    minutesPerSession: profile.schedule.sessionMinutes, schedule: profile.schedule,
    title: `${input.interest} · ${spec.title}`, interest: input.interest,
    goal: input.goal?.trim() || spec.description, curriculumSlug: input.curriculumSlug,
    modules, objectives, sessions };
}
