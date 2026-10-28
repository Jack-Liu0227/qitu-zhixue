import type { LessonActivity } from './pbl-learning.js';

export interface LessonActivityProgress {
  activityId: string;
  kind: LessonActivity;
  guidance: string;
  minutes: number;
  evidence: 'session_response' | 'experiment_observation' | 'submitted_artifact' | 'mastery' | 'teaching_delivery';
  status: 'completed' | 'current' | 'locked';
  evidenceRefs: string[];
}
export interface LearningSessionProgressItem {
  activities?: LessonActivityProgress[];
  sessionId: string;
  lessonIndex: number;
  title: string;
  status: 'completed' | 'current' | 'locked';
  completedAt: string | null;
  canComplete: boolean;
  blockers: string[];
}
export interface LearningSessionProgressView {
  planId: string;
  projectId: string;
  planRevision: number;
  currentSessionId: string | null;
  completedCount: number;
  totalCount: number;
  contractReady: boolean;
  sessions: LearningSessionProgressItem[];
}
export interface CompleteLearningSessionRequest {
  projectId: string;
  planRevision: number;
  evidenceRefs: string[];
}
export interface CompleteLearningSessionResponse {
  completion: { sessionId: string; completedAt: string; evidenceRefs: string[] };
  progress: LearningSessionProgressView;
  replayed: boolean;
}
