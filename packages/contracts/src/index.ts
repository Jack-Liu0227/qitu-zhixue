export type Role = 'student' | 'parent' | 'teacher' | 'admin' | 'support';

export type ProjectStage =
  | 'exploration'
  | 'intent_confirmed'
  | 'theory_learning'
  | 'theory_check'
  | 'practice_ready'
  | 'practice_building'
  | 'artifact_review'
  | 'reflection'
  | 'published'
  | 'completed';

export interface HealthResponse {
  service: string;
  status: 'ok';
  version: string;
}

export interface ProjectSummary {
  id: string;
  title: string;
  stage: ProjectStage;
  progress: number;
}
