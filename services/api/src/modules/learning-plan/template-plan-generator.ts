import {
  parseProjectTemplateSpec,
  ProjectTemplateSpecError,
  type KnowledgeType,
  type LearningPlanWeeks,
  type PblSchedule,
  type PblTemplateObjective,
  type ProjectTemplateSpec,
  type SessionBlockKind,
} from '@qitu/contracts';
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
    if ('lessonCount' in schedule) {
      // Lesson-first profiles never derive a calendar duration. A caller must
      // select the profile by its explicit lesson count and duration.
      const legacyProjection = input.lessonCount === undefined && input.weeks !== undefined
        && input.weeks === Math.ceil(schedule.lessonCount / 2);
      return (input.weeks === undefined || legacyProjection)
        && input.schedule === undefined
        && (input.lessonCount === undefined || input.lessonCount === schedule.lessonCount)
        && (input.lessonMinutes === undefined || input.lessonMinutes === schedule.lessonMinutes)
        && (input.sessionCount === undefined || input.sessionCount === schedule.lessonCount);
    }
    return input.weeks !== undefined
      && schedule.durationWeeks === input.weeks
      && (input.sessionCount === undefined || profile.sessions.length === input.sessionCount)
      && (input.schedule === undefined || (schedule.weeklyMinutes === input.schedule.weeklyMinutes
        && schedule.durationWeeks === input.schedule.durationWeeks
        && schedule.sessionsPerWeek === input.schedule.sessionsPerWeek
        && schedule.sessionMinutes === input.schedule.sessionMinutes));
  });
  const profile = candidates[0];
  if (profile === undefined || candidates.length !== 1) {
    reject('schedule', 'Select exactly one approved template schedule profile');
  }

  const count = profile.sessions.length;
  let sessionCount: PlanSessionCount;
  if (count === 4 || count === 8 || count === 16) sessionCount = count;
  else reject('sessions', 'Unsupported session count');
  const lessonOnly = 'lessonCount' in profile.schedule && input.lessonCount !== undefined;
  let minutesPerSession = 60;
  let legacyWeeks: LearningPlanWeeks = (count === 16 ? 8 : 4) as LearningPlanWeeks;
  let legacySchedule: PblSchedule | undefined;
  if ('lessonCount' in profile.schedule) {
    minutesPerSession = profile.schedule.lessonMinutes;
  } else {
    minutesPerSession = profile.schedule.sessionMinutes;
    legacyWeeks = profile.schedule.durationWeeks;
    legacySchedule = profile.schedule;
  }

  const byId = new Map(spec.objectives.map((objective) => [objective.id, objective]));
  const gated = spec.phases.find((phase) => phase.phase === 'concept_mastery')?.objectiveIds;
  if (gated === undefined || gated.length === 0) reject('phases', 'The template must declare theory gate objectives');

  const moduleId = (index: number): string => `${profile.id}-${lessonOnly ? 'lesson' : 'week'}-${index}`;
  const modules = lessonOnly
    ? profile.sessions.map((session, index) => ({
      id: moduleId(index + 1),
      name: `Lesson ${index + 1}: ${session.title}`,
      lessonIndex: index + 1,
      weekIndex: Math.ceil((index + 1) / 2),
      objective: session.title,
      ordinal: index + 1,
    }))
    : Array.from({ length: legacyWeeks ?? 0 }, (_, index) => {
      const week = index + 1;
      const sessions = profile.sessions.filter((session) => (session.week ?? Math.ceil(session.sessionIndex / 2)) === week);
      return {
        id: moduleId(week),
        name: `Week ${week}: ${sessions[0]?.title ?? spec.title}`,
        weekIndex: week,
        objective: sessions.map((session) => session.title).join('; '),
        ordinal: week,
      };
    });

  const objectives = spec.objectives.map((objective, index) => {
    const sessionIdx = profile.sessions.findIndex((candidate) => candidate.objectiveIds.includes(objective.id));
    const session = profile.sessions[sessionIdx];
    if (sessionIdx === -1 || session === undefined) reject('objectives', `Objective ${objective.id} is not scheduled`);
    const week = session.week ?? Math.ceil(session.sessionIndex / 2);
    const placement = lessonOnly ? session.sessionIndex : week;
    if (placement === undefined) reject('objectives', `Objective ${objective.id} has no placement`);
    return {
      id: objective.id,
      moduleId: moduleId(placement),
      name: objective.title,
      type: knowledgeType(objective),
      objective: objective.description,
      prerequisiteIds: [...objective.prerequisiteIds],
      ordinal: index + 1,
      conceptId: objective.conceptId,
    };
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
    const week = session.week ?? Math.ceil((index + 1) / 2);
    const day = session.session ?? ((index % 2) + 1);
    const placement = lessonOnly ? session.sessionIndex : week;
    if (placement === undefined) reject('sessions', `Session ${session.id} has no placement`);
    return {
      id: session.id,
      moduleId: moduleId(placement),
      index,
      lessonIndex: session.sessionIndex,
      week,
      day,
      title: session.title,
      blocks,
      theoryObjectiveIds: session.phase === 'concept_mastery' ? [...session.objectiveIds]
        : practice ? [...gated] : [],
      practiceObjectiveIds: practice ? [...session.objectiveIds] : [],
      mode: 'study' as const,
    };
  });

  return {
    templateVersion: context.templateVersion,
    lessonCount: count,
    lessonMinutes: minutesPerSession as 60 | 120,
    weeks: legacyWeeks,
    sessionCount,
    minutesPerSession,
    ...(legacySchedule === undefined ? {} : { schedule: legacySchedule }),
    title: `${input.interest} - ${spec.title}`,
    interest: input.interest,
    goal: input.goal?.trim() || spec.description,
    curriculumSlug: input.curriculumSlug,
    modules,
    objectives,
    sessions,
  } as GeneratedPlan;
}
