import {
  parseProjectTemplateSpec,
  ProjectTemplateSpecError,
  type KnowledgeType,
  type PblTemplateObjective,
  type ProjectTemplateSpec,
  type SessionBlockKind,
} from '@qitu/contracts';
import type { GeneratedBlock, GeneratedPlan, GeneratePlanInput } from './plan-generator';
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
    if (error instanceof ProjectTemplateSpecError) {
      throw new PlanGenerationError('Invalid resolved teaching template', error.errors);
    }
    throw error;
  }
}

/** Project one frozen template session into one learning-plan lesson. */
export function generatePlanFromTemplate(
  input: GeneratePlanInput,
  context: { templateVersion: string; templateSpec: unknown },
): GeneratedPlan {
  const spec = readTemplate(context.templateSpec);
  const profiles = spec.curriculum?.profiles;
  if (profiles === undefined) reject('curriculum.profiles', 'This template requires governed curriculum profiles');

  const candidates = profiles.filter((profile) =>
    profile.schedule.lessonCount === input.lessonCount
      && profile.schedule.lessonMinutes === input.lessonMinutes
      && profile.sessions.length === input.lessonCount,
  );
  const profile = candidates[0];
  if (profile === undefined || candidates.length !== 1) {
    reject('lessonCount', 'Select exactly one approved lesson profile from the template');
  }
  if (input.sessionCount !== undefined && input.sessionCount !== profile.schedule.lessonCount) {
    reject('sessionCount', 'sessionCount must equal the selected profile lessonCount');
  }

  const byId = new Map(spec.objectives.map((objective) => [objective.id, objective]));
  const gated = spec.phases.find((phase) => phase.phase === 'concept_mastery')?.objectiveIds;
  if (gated === undefined || gated.length === 0) reject('phases', 'The template must declare theory gate objectives');

  const modules = profile.sessions.map((session, index) => ({
    id: `${profile.id}-lesson-${index + 1}`,
    name: `第 ${index + 1} 课时 · ${session.title}`,
    lessonIndex: index + 1,
    objective: session.title,
    ordinal: index + 1,
  }));
  const objectives = spec.objectives.map((objective, objectiveIndex) => {
    const sessionIdx = profile.sessions.findIndex((candidate) => candidate.objectiveIds.includes(objective.id));
    const session = profile.sessions[sessionIdx];
    if (sessionIdx < 0 || session === undefined) reject('objectives', `Objective ${objective.id} is not scheduled`);
    return {
      id: objective.id,
      moduleId: modules[sessionIdx]!.id,
      name: objective.title,
      type: knowledgeType(objective),
      objective: objective.description,
      prerequisiteIds: [...objective.prerequisiteIds],
      ordinal: objectiveIndex + 1,
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
    return {
      id: session.id,
      moduleId: modules[index]!.id,
      index,
      lessonIndex: index + 1,
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
    lessonCount: profile.schedule.lessonCount,
    lessonMinutes: profile.schedule.lessonMinutes,
    sessionCount: profile.schedule.lessonCount,
    minutesPerSession: profile.schedule.lessonMinutes,
    title: `${input.interest} - ${spec.title}`,
    interest: input.interest,
    goal: input.goal?.trim() || spec.description,
    curriculumSlug: input.curriculumSlug ?? spec.id,
    modules,
    objectives,
    sessions,
  };
}
