import type { LearningPlanStatus } from './learning-plan.js';
import type { ProjectStage } from './project.js';

export interface ReconcileProjectLearningRequest { planId: string; planRevision: number }
export interface ReconcileProjectLearningResponse {
  projectId: string;
  stage: ProjectStage;
  planStatus: LearningPlanStatus;
  currentSessionId: string | null;
  replayed: boolean;
}
