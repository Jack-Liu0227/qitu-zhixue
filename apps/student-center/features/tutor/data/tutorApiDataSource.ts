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
import { TutorDataError, type TutorDataSource } from './dataSource';
import { LiveTutorSocket } from './liveTutorSocket';
import type { TutorProjectContext } from '../types';

/**
 * The tutor data source the app actually runs on.
 *
 * WHAT IS REAL: the conversation. `GET /tutor/session` supplies the persisted
 * history and the journal cursor, and `POST /tutor/stream` streams every turn
 * as `tool_call → tool_result → delta → block → done`.
 *
 * WHAT IS NOT WIRED YET: the left column's project context
 * (`getActiveProject` / `getProjectContext`). The student API does not expose a
 * project read projection yet. This source therefore reports that projection as
 * UNAVAILABLE — it never substitutes a demo project or a demo session, because
 * a student must never mistake invented content for their own learning record.
 *
 * Same rule for the session: if the API is unreachable the error is surfaced
 * (the hook turns `NETWORK_OFFLINE` into the offline banner and a retry), it is
 * NOT swallowed by falling back to fixtures. Deterministic fixtures remain
 * available through `MockTutorDataSource` for explicit tests/QA.
 *
 * No route here writes project stage, growth records, AI decisions or audit
 * logs.
 */
export class TutorApiDataSource implements TutorDataSource {
  private readonly projectIdBySession = new Map<string, string>();
  private readonly sockets = new Map<string, LiveTutorSocket>();
  private readonly sessionCursor = new Map<string, number>();
  private sessionCounter = 0;

  /**
   * No project read projection is exposed to this app yet. Reporting it as
   * unavailable is the only honest answer: returning a fixture project would
   * present invented content as the student's own.
   */
  async getActiveProject(): Promise<ProjectSummary | null> {
    throw projectContextUnavailable();
  }

  async getProjectContext(projectId: string): Promise<TutorProjectContext | null> {
    void projectId;
    throw projectContextUnavailable();
  }

  async createSession(
    request: CreateTutorSessionRequest,
  ): Promise<CreateTutorSessionResponse> {
    const projectId = request.projectId;
    if (projectId === undefined) {
      // Never bind a session to the server's demo project implicitly.
      throw new TutorDataError('还没有进行中的项目', undefined, 'NO_ACTIVE_PROJECT');
    }
    const session = await this.fetchSession(projectId);
    this.projectIdBySession.set(session.sessionId, projectId);
    return {
      sessionId: session.sessionId,
      projectId,
      createdAt: new Date().toISOString(),
      lastSeq: session.lastSeq,
    };
  }

  async getSession(sessionId: string): Promise<GetTutorSessionResponse> {
    const projectId = this.projectIdBySession.get(sessionId);
    if (projectId === undefined) {
      throw new TutorDataError('会话不存在或已过期', 404, 'SESSION_NOT_FOUND');
    }
    const session = await this.fetchSession(projectId);
    this.projectIdBySession.set(session.sessionId, projectId);
    this.sessionCursor.set(session.sessionId, session.lastSeq);
    return session;
  }

  async submitTurn(
    sessionId: string,
    request: CreateTutorTurnRequest,
  ): Promise<CreateTutorTurnResponse> {
    const socket = this.sockets.get(sessionId);
    if (socket === undefined) {
      // The stream socket is created by the session hook; reaching a submit
      // before it exists is a transient state the student can retry, not a
      // reason to fabricate a reply.
      throw new TutorDataError('连接还没有准备好，请重试。', undefined, 'STREAM_NOT_READY');
    }
    // The stream itself is opened by the socket; the ack only carries the
    // journal baseline so the UI can order the student's echo correctly.
    const baseline = socket.startTurn({
      content: request.content,
      pedagogicMove: request.pedagogicMove,
      optionLabel: request.optionLabel,
      idempotencyKey: request.idempotencyKey,
    });
    return {
      turnId: `live-${(this.sessionCounter += 1)}`,
      seq: baseline,
      accepted: true,
    };
  }

  async getSummary(sessionId: string): Promise<TutorSessionSummary> {
    const response = await this.fetchJson(
      `/api/v1/tutor/sessions/${encodeURIComponent(sessionId)}/summary`,
    );
    const data = unwrapData(response);
    if (!isTutorSessionSummary(data)) {
      throw new TutorDataError('会话摘要格式不正确', undefined, 'BAD_SUMMARY_PAYLOAD');
    }
    return data;
  }

  async submitFeedback(
    _sessionId: string,
    _request: CreateTutorFeedbackRequest,
  ): Promise<CreateTutorFeedbackResponse> {
    // No feedback write endpoint is exposed to the student app yet. Fail loud
    // rather than pretending the feedback was recorded server-side.
    throw new TutorDataError('反馈暂时无法提交，请稍后重试。', undefined, 'FEEDBACK_UNAVAILABLE');
  }

  createSocket(sessionId: string): TutorSocket {
    const existing = this.sockets.get(sessionId);
    if (existing !== undefined) return existing;
    const socket = new LiveTutorSocket(sessionId, {
      projectId: this.projectIdBySession.get(sessionId),
      initialSeq: this.sessionCursor.get(sessionId) ?? 0,
      onUnreachable: (error) => {
        // Surface the failure on the thread (the student sees a retry) and
        // detach so the realtime client can reconnect to this same instance.
        // The journal and cursor survive, so nothing is lost or duplicated.
        socket.failStream(error);
        socket.close();
      },
    });
    this.sockets.set(sessionId, socket);
    return socket;
  }

  private async fetchSession(projectId: string): Promise<GetTutorSessionResponse> {
    const body = await this.fetchJson(
      `/api/v1/tutor/session?projectId=${encodeURIComponent(projectId)}`,
      '会话加载失败',
    );
    const data = unwrapData(body);
    if (!isTutorSessionResponse(data)) {
      throw new TutorDataError('会话数据格式不正确', undefined, 'BAD_SESSION_PAYLOAD');
    }
    this.sessionCursor.set(data.sessionId, data.lastSeq);
    return data;
  }

  private async fetchJson(path: string, failureLabel = '请求失败'): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(path, {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      });
    } catch (error) {
      throw new TutorDataError(
        error instanceof Error ? error.message : '网络不可用',
        undefined,
        'NETWORK_OFFLINE',
      );
    }
    if (!response.ok) {
      throw new TutorDataError(
        `${failureLabel}（${response.status}）`,
        response.status,
        `HTTP_${response.status}`,
      );
    }
    return response.json();
  }
}

function projectContextUnavailable(): TutorDataError {
  return new TutorDataError(
    '项目信息暂时无法加载，请稍后重试。',
    undefined,
    'PROJECT_CONTEXT_UNAVAILABLE',
  );
}

function unwrapData(body: unknown): unknown {
  if (typeof body === 'object' && body !== null && 'data' in body) {
    return (body as { data: unknown }).data;
  }
  return body;
}

function isTutorSessionResponse(value: unknown): value is GetTutorSessionResponse {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { sessionId?: unknown; turns?: unknown; lastSeq?: unknown };
  return (
    typeof candidate.sessionId === 'string' &&
    Array.isArray(candidate.turns) &&
    typeof candidate.lastSeq === 'number'
  );
}

function isTutorSessionSummary(value: unknown): value is TutorSessionSummary {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as {
    summary?: unknown;
    lastHintLevel?: unknown;
    stallCount?: unknown;
    escalated?: unknown;
  };
  return (
    typeof candidate.summary === 'string' &&
    (candidate.lastHintLevel === null || typeof candidate.lastHintLevel === 'number') &&
    typeof candidate.stallCount === 'number' &&
    typeof candidate.escalated === 'boolean'
  );
}
