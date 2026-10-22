import type {
  KnowledgeType,
  LearningPlanBlockActivity,
  SessionBlockKind,
  SessionMode,
  ProjectTemplateSpec,
} from '@qitu/contracts';

export interface SessionPlanShape {
  templateVersion: string;
  lessonCount: number;
  lessonMinutes: 60 | 120;
  sessionCount: number;
  minutesPerSession: number;
  curriculumSlug?: string;
  title: string;
  interest: string;
  goal: string;
  modules: readonly PlanModuleShape[];
  objectives: readonly PlanObjectiveShape[];
  sessions: readonly PlanSessionShape[];
}

export interface PlanObjectiveShape {
  id: string;
  moduleId: string;
  name: string;
  type: KnowledgeType;
  objective: string;
  prerequisiteIds: readonly string[];
  ordinal: number;
}

export interface PlanModuleShape {
  id: string;
  name: string;
  lessonIndex: number;
  objective: string;
  ordinal: number;
}

export interface PlanBlockShape {
  id: string;
  title: string;
  minutes: number;
  activity: LearningPlanBlockActivity;
  kind: SessionBlockKind;
  objectiveIds: readonly string[];
  prerequisiteObjectiveIds: readonly string[];
}

export interface PlanSessionShape {
  id: string;
  moduleId: string;
  index: number;
  lessonIndex: number;
  title: string;
  blocks: readonly PlanBlockShape[];
  theoryObjectiveIds: readonly string[];
  practiceObjectiveIds: readonly string[];
  mode: SessionMode;
}

export interface PlanViolation {
  path: string;
  message: string;
}

export class PlanGenerationError extends Error {
  readonly code = 'LEARNING_PLAN_INVALID';
  constructor(message: string, readonly errors: readonly PlanViolation[] = []) {
    super(message);
    this.name = 'PlanGenerationError';
  }
}

export const PlanValidationError = PlanGenerationError;
export const MAX_OBJECTIVES_PER_SESSION = 4;
export const SESSION_COUNT_OPTIONS: readonly number[] = [4, 8, 16];

const KNOWLEDGE_TYPES: readonly KnowledgeType[] = ['memory', 'concept', 'procedure', 'design'];
const SESSION_BLOCK_KINDS: readonly SessionBlockKind[] = ['review', 'theory', 'check', 'practice', 'reflect'];
const GATED_THEORY_TYPES: readonly KnowledgeType[] = ['memory', 'procedure'];
const PRACTICE_PREREQUISITE_TYPES: readonly KnowledgeType[] = ['memory', 'concept', 'procedure'];
const REQUIRED_BLOCK_KINDS: readonly SessionBlockKind[] = ['review', 'theory', 'check', 'reflect'];
export const PLAN_BLOCK_ORDER: readonly SessionBlockKind[] = ['review', 'theory', 'check', 'practice', 'reflect'];

export function expectedSessionCount(plan: { lessonCount?: number; sessionCount?: number }): number {
  return typeof plan.lessonCount === 'number' ? plan.lessonCount
    : typeof plan.sessionCount === 'number' && Number.isInteger(plan.sessionCount) ? plan.sessionCount : 0;
}

export function findPrerequisiteCycle(
  objectives: readonly { id: string; prerequisiteIds: readonly string[] }[],
): string[] | null {
  const byId = new Map(objectives.map((objective) => [objective.id, objective]));
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const visit = (id: string): string[] | null => {
    const status = state.get(id) ?? 0;
    if (status === 1) {
      const start = stack.indexOf(id);
      return [...stack.slice(start >= 0 ? start : 0), id];
    }
    if (status === 2) return null;
    state.set(id, 1);
    stack.push(id);
    for (const prerequisite of byId.get(id)?.prerequisiteIds ?? []) {
      if (!byId.has(prerequisite)) continue;
      const cycle = visit(prerequisite);
      if (cycle !== null) return cycle;
    }
    stack.pop();
    state.set(id, 2);
    return null;
  };
  for (const objective of objectives) {
    const cycle = visit(objective.id);
    if (cycle !== null) return cycle;
  }
  return null;
}

export function validateGeneratedPlan(plan: SessionPlanShape, template?: ProjectTemplateSpec): void {
  const errors: PlanViolation[] = [];
  const frozenGateIds = template?.phases.find(phase => phase.phase === 'concept_mastery')?.objectiveIds;
  const expectedCount = expectedSessionCount(plan);
  if (!Number.isSafeInteger(plan.lessonCount) || plan.lessonCount < 1 || plan.lessonCount > 128) {
    errors.push({ path: 'lessonCount', message: 'lessonCount must be an integer between 1 and 128' });
  }
  if (plan.lessonMinutes !== 60 && plan.lessonMinutes !== 120) {
    errors.push({ path: 'lessonMinutes', message: 'lessonMinutes must be 60 or 120' });
  }
  if (plan.sessionCount !== plan.lessonCount) {
    errors.push({ path: 'sessionCount', message: 'sessionCount must equal lessonCount' });
  }
  if (plan.minutesPerSession !== plan.lessonMinutes) {
    errors.push({ path: 'minutesPerSession', message: 'minutesPerSession must equal lessonMinutes' });
  }
  if (plan.sessions.length !== expectedCount) {
    errors.push({ path: 'sessions', message: `plan must contain exactly ${expectedCount} lessons` });
  }
  if (plan.interest.trim().length < 1 || plan.interest.length > 60) {
    errors.push({ path: 'interest', message: 'interest length must be 1..60' });
  }
  if (plan.goal.length > 200) errors.push({ path: 'goal', message: 'goal cannot exceed 200 characters' });

  if (plan.modules.length !== plan.lessonCount) {
    errors.push({ path: 'modules', message: `plan must contain ${plan.lessonCount} lesson modules` });
  }
  const moduleIds = new Set<string>();
  const moduleOrder = new Set<number>();
  for (const module of plan.modules) {
    if (moduleIds.has(module.id)) errors.push({ path: `modules.${module.id}`, message: 'duplicate module id' });
    moduleIds.add(module.id);
    if (!Number.isInteger(module.ordinal) || module.ordinal < 1) {
      errors.push({ path: `modules.${module.id}.ordinal`, message: 'module ordinal must be positive' });
    }
    if (!Number.isInteger(module.lessonIndex) || module.lessonIndex < 1 || module.lessonIndex > plan.lessonCount) {
      errors.push({ path: `modules.${module.id}.lessonIndex`, message: 'lessonIndex is out of range' });
    }
    if (moduleOrder.has(module.lessonIndex)) {
      errors.push({ path: `modules.${module.id}.lessonIndex`, message: 'duplicate lessonIndex' });
    }
    moduleOrder.add(module.lessonIndex);
  }

  const objectiveById = new Map<string, PlanObjectiveShape>();
  for (const objective of plan.objectives) {
    if (objectiveById.has(objective.id)) errors.push({ path: `objectives.${objective.id}`, message: 'duplicate objective id' });
    if (!KNOWLEDGE_TYPES.includes(objective.type)) {
      errors.push({ path: `objectives.${objective.id}.type`, message: 'unknown objective type' });
    }
    if (!moduleIds.has(objective.moduleId)) {
      errors.push({ path: `objectives.${objective.id}.moduleId`, message: `unknown module ${objective.moduleId}` });
    }
    objectiveById.set(objective.id, objective);
  }
  for (const objective of plan.objectives) {
    for (const prerequisite of objective.prerequisiteIds) {
      if (!objectiveById.has(prerequisite)) {
        errors.push({ path: `objectives.${objective.id}.prerequisiteIds`, message: `unknown prerequisite ${prerequisite}` });
      }
    }
  }
  const cycle = findPrerequisiteCycle(plan.objectives);
  if (cycle !== null) errors.push({ path: 'objectives', message: `prerequisite cycle: ${cycle.join(' -> ')}` });

  const objectiveSessionIndex = new Map<string, number>();
  for (const session of plan.sessions) {
    for (const objectiveId of sessionObjectiveIds(session)) {
      if (!objectiveSessionIndex.has(objectiveId)) objectiveSessionIndex.set(objectiveId, session.index);
    }
  }

  for (const [position, session] of plan.sessions.entries()) {
    const path = `sessions.${session.id}`;
    if (!moduleIds.has(session.moduleId)) errors.push({ path: `${path}.moduleId`, message: 'unknown module' });
    if (session.index !== position) errors.push({ path: `${path}.index`, message: 'index must match plan order' });
    if (session.lessonIndex !== position + 1) {
      errors.push({ path: `${path}.lessonIndex`, message: 'lessonIndex must be contiguous one-based order' });
    }
    const module = plan.modules.find((candidate) => candidate.id === session.moduleId);
    if (module !== undefined && module.lessonIndex !== session.lessonIndex) {
      errors.push({ path: `${path}.moduleId`, message: 'session and module lessonIndex must match' });
    }
    const minutes = session.blocks.reduce((sum, block) => sum + block.minutes, 0);
    if (minutes !== plan.lessonMinutes) {
      errors.push({ path: `${path}.blocks`, message: `block minutes must total ${plan.lessonMinutes}; got ${minutes}` });
    }

    const kinds = session.blocks.map((block) => block.kind);
    for (const required of REQUIRED_BLOCK_KINDS) {
      if (!kinds.includes(required)) errors.push({ path, message: `missing required ${required} block` });
    }
    const hasPractice = kinds.includes('practice');
    if (session.practiceObjectiveIds.length > 0 && !hasPractice) {
      errors.push({ path, message: 'practice objectives require a practice block' });
    }
    if (session.practiceObjectiveIds.length === 0 && hasPractice) {
      errors.push({ path, message: 'practice block requires practice objectives' });
    }
    const present = kinds.filter((kind, index) => kinds.indexOf(kind) === index);
    const expectedOrder = PLAN_BLOCK_ORDER.filter((kind) => present.includes(kind));
    if (present.join(',') !== expectedOrder.join(',')) {
      errors.push({ path: `${path}.blocks`, message: `blocks must follow ${expectedOrder.join(' -> ')}` });
    }

    for (const block of session.blocks) {
      const blockPath = `${path}.blocks.${block.id}`;
      if (!Number.isSafeInteger(block.minutes) || block.minutes <= 0) {
        errors.push({ path: blockPath, message: 'block minutes must be a positive integer' });
      }
      if (!SESSION_BLOCK_KINDS.includes(block.kind)) errors.push({ path: blockPath, message: 'unknown block kind' });
      for (const objectiveId of block.objectiveIds) {
        if (!objectiveById.has(objectiveId)) errors.push({ path: blockPath, message: `unknown objective ${objectiveId}` });
      }
      for (const prerequisite of block.prerequisiteObjectiveIds) {
        if (!objectiveById.has(prerequisite)) errors.push({ path: blockPath, message: `unknown prerequisite ${prerequisite}` });
      }
      if (block.kind === 'practice' && block.prerequisiteObjectiveIds.length === 0) {
        errors.push({ path: blockPath, message: 'practice block must reference theory prerequisite' });
      }
    }

    for (const objectiveId of [...session.theoryObjectiveIds, ...session.practiceObjectiveIds]) {
      if (!objectiveById.has(objectiveId)) errors.push({ path, message: `unknown objective ${objectiveId}` });
    }
    for (const objectiveId of session.theoryObjectiveIds) {
      const objective = objectiveById.get(objectiveId);
      const acceptedTypes = template ? PRACTICE_PREREQUISITE_TYPES
        : plan.curriculumSlug === undefined ? ['memory', 'concept'] : GATED_THEORY_TYPES;
      if (template && !frozenGateIds?.includes(objectiveId)) {
        errors.push({ path, message: `theory gate objective ${objectiveId} is not declared by the frozen template` });
      }
      if (objective !== undefined && !acceptedTypes.includes(objective.type)) {
        errors.push({ path, message: `theory gate objective ${objectiveId} has an invalid type` });
      }
    }
    for (const objectiveId of session.practiceObjectiveIds) {
      const objective = objectiveById.get(objectiveId);
      if (objective === undefined) continue;
      const theoreticalPrerequisites = objective.prerequisiteIds.filter((id) => {
        const prerequisite = objectiveById.get(id);
        return prerequisite !== undefined && PRACTICE_PREREQUISITE_TYPES.includes(prerequisite.type);
      });
      const hasEarlierTheory = theoreticalPrerequisites.some(
        (id) => (objectiveSessionIndex.get(id) ?? Number.POSITIVE_INFINITY) <= session.index,
      );
      if (!hasEarlierTheory) errors.push({ path, message: `practice objective ${objectiveId} must depend on an earlier theory objective` });
    }
    if (session.practiceObjectiveIds.length > 0 && session.theoryObjectiveIds.length === 0) {
      errors.push({ path, message: `practice session ${session.id} must declare its theory gate objective` });
    }
    if (sessionTaughtObjectiveIds(session).length > MAX_OBJECTIVES_PER_SESSION) {
      errors.push({ path, message: `lesson may teach at most ${MAX_OBJECTIVES_PER_SESSION} objectives` });
    }
  }

  const referenced = new Set(plan.sessions.flatMap(sessionObjectiveIds));
  for (const objective of plan.objectives) {
    if (!referenced.has(objective.id)) errors.push({ path: `objectives.${objective.id}`, message: 'objective is not scheduled' });
  }
  if (plan.objectives.length === 0) errors.push({ path: 'objectives', message: 'plan must contain objectives' });
  if (errors.length > 0) {
    throw new PlanGenerationError(`Generated learning plan failed validation: ${errors[0]?.message ?? ''}`, errors);
  }
}

function sessionObjectiveIds(session: PlanSessionShape): string[] {
  return [...new Set([
    ...session.blocks.flatMap((block) => [...block.objectiveIds]),
    ...session.theoryObjectiveIds,
    ...session.practiceObjectiveIds,
  ])];
}

function sessionTaughtObjectiveIds(session: PlanSessionShape): string[] {
  return [...new Set([
    ...session.blocks.flatMap((block) => [...block.objectiveIds]),
    ...session.practiceObjectiveIds,
  ])];
}

export function blockShapesCoverSessionMinutes(
  sessionMinutes: number,
  totalSessions: number,
): { ordinal: number; total: number; kinds: string[] }[] {
  return Array.from({ length: totalSessions }, (_, ordinal) => {
    const scale = sessionMinutes / 60;
    const base = ordinal % 2 === 0
      ? [5, 25, 10, 12, 8]
      : [8, 15, 10, 20, 7];
    return {
      ordinal,
      total: base.reduce((sum, minutes) => sum + minutes, 0) * scale,
      kinds: [...PLAN_BLOCK_ORDER],
    };
  });
}
