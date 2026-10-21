export interface LearningSessionProgressItem {
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
