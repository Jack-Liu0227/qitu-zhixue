import type { LessonActivity, PblTemplateSession } from './pbl-learning.js';

/** Server projection of one actual frozen lesson. It grants no execution authority. */
export interface TutorLessonProgram {
  templateVersionId: string;
  planId: string;
  planRevision: number;
  learningSessionId: string;
  lessonIndex: number;
  title: string;
  learningGoal: string;
  objectiveIds: readonly string[];
  activities: readonly { kind: LessonActivity; minutes: number; guidance: string }[];
  evidenceRequirements: readonly string[];
  completion: PblTemplateSession['completionSpec'] | null;
  checkpoint: string | null;
}
