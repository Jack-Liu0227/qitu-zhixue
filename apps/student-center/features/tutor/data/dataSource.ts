import type {
  ConfirmIntentResponse,
  CreateTutorFeedbackRequest,
  CreateTutorFeedbackResponse,
  CreateTutorSessionRequest,
  CreateTutorSessionResponse,
  CreateTutorTurnRequest,
  CreateTutorTurnResponse,
  AnswerInteractiveQuizRequest,
  AnswerInteractiveQuizResponse,
  TutorExperimentActionRequest,
  TutorExperimentActionResponse,
  GetTutorSessionResponse,
  ProjectSummary,
  TutorSessionSummary,
  TutorTeamGraph,
} from '@qitu/contracts';
import type { TutorSocket } from '../realtime/tutorRealtimeClient';
import type { TutorProjectContext } from '../types';

/**
 * The ONE swappable data source for the tutor module.
 *
 * Every network read/write on the AI搭档 page goes through this interface; no
 * component calls `fetch` directly. The API-backed implementation is the
 * default; tests and QA can inject `MockTutorDataSource` through the provider.
 */
export interface TutorDataSource {
  confirmExploration?(explorationId: string, draft: { goal: string; interest: string; templateVersionId?: string }, idempotencyKey: string): Promise<ConfirmIntentResponse>;
  /** GET /students/me/active-project — `null` means no active project (empty state). */
  getActiveProject(): Promise<ProjectSummary | null>;
  listProjects(): Promise<ProjectSummary[]>;
  /** GET /projects/:id + /stages + /tasks — left-column display projection. */
  getProjectContext(projectId: string): Promise<TutorProjectContext | null>;
  /** GET /tutor/team-graph?projectId=... — server-filtered agent projection. */
  getTeamGraph(projectId: string): Promise<TutorTeamGraph | null>;
  /** POST /tutor/sessions — idempotent session creation. */
  createSession(request: CreateTutorSessionRequest): Promise<CreateTutorSessionResponse>;
  /** GET /tutor/session — initial turns + `lastSeq` cursor seed. */
  getSession(sessionId: string): Promise<GetTutorSessionResponse>;
  /** POST /tutor/sessions/:id/turns — idempotent turn submission. */
  submitTurn(
    sessionId: string,
    request: CreateTutorTurnRequest,
  ): Promise<CreateTutorTurnResponse>;
  /** POST /tutor/sessions/:id/interactive/:quizId/answer — server-owned grading. */
  answerInteractiveQuiz(
    sessionId: string,
    quizId: string,
    request: AnswerInteractiveQuizRequest,
  ): Promise<AnswerInteractiveQuizResponse>;
  /** Explicit explain action; the server decides whether to reveal an explanation. */
  requestQuizExplanation(sessionId: string, quizId: string): Promise<void>;
  /** POST /tutor/sessions/:id/interactive/experiments/:experimentId/action. */
  submitExperimentAction(
    sessionId: string,
    experimentId: string,
    request: TutorExperimentActionRequest,
  ): Promise<TutorExperimentActionResponse>;
  /** GET /tutor/sessions/:id/summary — display-only ladder/stall status. */
  getSummary(sessionId: string): Promise<TutorSessionSummary>;
  /** POST /tutor/sessions/:id/feedback — idempotent feedback. */
  submitFeedback(
    sessionId: string,
    request: CreateTutorFeedbackRequest,
  ): Promise<CreateTutorFeedbackResponse>;
  /** POST /tutor/sessions/:id/stream — SSE turn transport. */
  createSocket(sessionId: string): TutorSocket;
}

/**
 * Thrown by a data source for transport/HTTP failures so the UI can map status
 * codes to the correct state (403 → permission denied, everything else → error).
 */
export class TutorDataError extends Error {
  readonly status?: number;
  readonly code?: string;

  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = 'TutorDataError';
    this.status = status;
    this.code = code;
  }
}
