import type {
  CreateTutorFeedbackRequest,
  CreateTutorFeedbackResponse,
  CreateTutorSessionRequest,
  CreateTutorSessionResponse,
  CreateTutorTurnRequest,
  CreateTutorTurnResponse,
  GetTutorSessionResponse,
  ProjectSummary,
  TutorSessionSummary,
} from '@qitu/contracts';
import type { TutorSocket } from '../realtime/tutorRealtimeClient';
import type { TutorProjectContext } from '../types';

/**
 * The ONE swappable data source for the tutor module.
 *
 * Every network read/write on the AI搭档 page goes through this interface; no
 * component calls `fetch` directly. Wave 4 (or the API team) repoints
 * `setTutorDataSource` at the real client without touching components. All
 * shapes are the shared `@qitu/contracts` types.
 */
export interface TutorDataSource {
  /** GET /students/me/active-project — `null` means no active project (empty state). */
  getActiveProject(): Promise<ProjectSummary | null>;
  /** GET /projects/:id + /stages + /tasks — left-column display projection. */
  getProjectContext(projectId: string): Promise<TutorProjectContext | null>;
  /** POST /tutor/sessions — idempotent session creation. */
  createSession(request: CreateTutorSessionRequest): Promise<CreateTutorSessionResponse>;
  /** GET /tutor/sessions/:id — initial turns + `lastSeq` cursor seed. */
  getSession(sessionId: string): Promise<GetTutorSessionResponse>;
  /** POST /tutor/sessions/:id/turns — idempotent turn submission. */
  submitTurn(
    sessionId: string,
    request: CreateTutorTurnRequest,
  ): Promise<CreateTutorTurnResponse>;
  /** GET /tutor/sessions/:id/summary — display-only ladder/stall status. */
  getSummary(sessionId: string): Promise<TutorSessionSummary>;
  /** POST /tutor/sessions/:id/feedback — idempotent feedback. */
  submitFeedback(
    sessionId: string,
    request: CreateTutorFeedbackRequest,
  ): Promise<CreateTutorFeedbackResponse>;
  /** Open the WS transport for `WS /tutor/sessions/:id/stream`. */
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
