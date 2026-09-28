export type LearningPlanWeeks = 4 | 8;

export interface LearningPlanBlock {
  id: string;
  title: string;
  minutes: number;
  objectiveIds: readonly string[];
  activity: 'explore' | 'learn' | 'practice' | 'reflect' | 'review';
  prerequisiteObjectiveIds: readonly string[];
}

export interface LearningPlanSession {
  id: string;
  week: number;
  day: number;
  title: string;
  blocks: readonly LearningPlanBlock[];
}

export interface LearningPlanDraft {
  templateVersion: string;
  weeks: LearningPlanWeeks;
  title: string;
  interest: string;
  sessions: readonly LearningPlanSession[];
}

export interface LearningPlanValidationError {
  path: string;
  message: string;
}

export interface LearningPlanValidationResult {
  ok: boolean;
  errors: readonly LearningPlanValidationError[];
}

/**
 * Validate untrusted model output before it can become a confirmed plan.
 * This function deliberately reports errors instead of silently repairing the
 * model response.
 */
export function validateLearningPlanDraft(draft: LearningPlanDraft): LearningPlanValidationResult {
  const errors: LearningPlanValidationError[] = [];
  if (draft.weeks !== 4 && draft.weeks !== 8) {
    errors.push({ path: 'weeks', message: 'weeks must be 4 or 8' });
  }
  if (draft.sessions.length !== draft.weeks * 5) {
    errors.push({ path: 'sessions', message: 'each plan must contain five learning sessions per week' });
  }

  const objectiveIds = new Set<string>();
  const completed = new Set<string>();
  for (const [sessionIndex, session] of draft.sessions.entries()) {
    if (session.week < 1 || session.week > draft.weeks) {
      errors.push({ path: `sessions[${sessionIndex}].week`, message: 'session week is outside the plan range' });
    }
    const minutes = session.blocks.reduce((sum, block) => sum + block.minutes, 0);
    if (minutes !== 60) {
      errors.push({ path: `sessions[${sessionIndex}].blocks`, message: 'session blocks must total exactly 60 minutes' });
    }
    const sessionObjectives = new Set<string>();
    for (const [blockIndex, block] of session.blocks.entries()) {
      if (block.minutes <= 0) {
        errors.push({ path: `sessions[${sessionIndex}].blocks[${blockIndex}].minutes`, message: 'block minutes must be positive' });
      }
      for (const objectiveId of block.objectiveIds) {
        objectiveIds.add(objectiveId);
        sessionObjectives.add(objectiveId);
      }
      for (const prerequisite of block.prerequisiteObjectiveIds) {
        if (!completed.has(prerequisite)) {
          errors.push({
            path: `sessions[${sessionIndex}].blocks[${blockIndex}].prerequisiteObjectiveIds`,
            message: `prerequisite ${prerequisite} is not mastered before this session`,
          });
        }
      }
      if (block.activity === 'practice' && block.prerequisiteObjectiveIds.length === 0) {
        errors.push({
          path: `sessions[${sessionIndex}].blocks[${blockIndex}].prerequisiteObjectiveIds`,
          message: 'practice blocks need a theory prerequisite',
        });
      }
    }
    if (sessionObjectives.size > 4) {
      errors.push({ path: `sessions[${sessionIndex}]`, message: 'a session may contain at most four objectives' });
    }
    for (const objectiveId of sessionObjectives) completed.add(objectiveId);
  }

  if (objectiveIds.size === 0) {
    errors.push({ path: 'sessions', message: 'a plan must contain at least one objective' });
  }
  return { ok: errors.length === 0, errors };
}
