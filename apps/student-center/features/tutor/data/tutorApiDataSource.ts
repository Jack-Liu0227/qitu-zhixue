import type {
  CreateTutorFeedbackRequest,
  CreateTutorFeedbackResponse,
  CreateTutorSessionRequest,
  CreateTutorSessionResponse,
  CreateTutorTurnRequest,
  CreateTutorTurnResponse,
  GetTutorSessionResponse,
  ProjectSummary,
  TutorProjectContext as SharedTutorProjectContext,
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
 * history and the journal cursor, and `POST /tutor/sessions/:id/stream` streams every turn
 * as `tool_call → tool_result → delta → block → done`.
 *
 * The project context is served by the same API projection used by the
 * student's project area. It is authorization-checked on the server, so this
 * source never falls back to a fixture or to the server's demo project.
 *
 * No route here writes project stage, growth records, AI decisions or audit
 * logs.
 */
export class TutorApiDataSource implements TutorDataSource {
  private readonly projectIdBySession = new Map<string, string | null>();
  private readonly explorationIdBySession = new Map<string, string | null>();
  private readonly sockets = new Map<string, LiveTutorSocket>();
  private readonly sessionCursor = new Map<string, number>();
  private sessionCounter = 0;

  async getActiveProject(): Promise<ProjectSummary | null> {
    const context = await this.fetchProjectContext();
    return context?.project ?? null;
  }

  async getProjectContext(projectId: string): Promise<TutorProjectContext | null> {
    return this.fetchProjectContext(projectId);
  }

  private async fetchProjectContext(projectId?: string): Promise<TutorProjectContext | null> {
    const query = projectId === undefined ? '' : `?projectId=${encodeURIComponent(projectId)}`;
    const response = await this.fetchJson(`/api/v1/tutor/project-context${query}`, '项目信息加载失败');
    const data = unwrapData(response);
    if (data === null) return null;
    if (!isTutorProjectContext(data)) {
      throw new TutorDataError('项目上下文格式不正确', undefined, 'BAD_PROJECT_CONTEXT_PAYLOAD');
    }
    return data;
  }

  async createSession(
    request: CreateTutorSessionRequest,
  ): Promise<CreateTutorSessionResponse> {
    const projectId = request.projectId;
    let explorationId = request.explorationId;
    if (request.source === 'exploration' && explorationId === undefined) {
      const payload = await this.fetchJson('/api/v1/explorations', '探索会话创建失败', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': request.idempotencyKey,
        },
        body: JSON.stringify({ source: 'free' }),
      });
      const data = unwrapData(payload);
      if (!isExplorationPayload(data)) {
        throw new TutorDataError('探索会话数据格式不正确', undefined, 'BAD_EXPLORATION_PAYLOAD');
      }
      explorationId = data.id;
    }
    const session = await this.fetchSession(projectId, explorationId);
    this.projectIdBySession.set(session.sessionId, projectId ?? null);
    this.explorationIdBySession.set(session.sessionId, explorationId ?? null);
    return {
      sessionId: session.sessionId,
      projectId: projectId ?? null,
      explorationId: explorationId ?? null,
      source: request.source,
      createdAt: new Date().toISOString(),
      lastSeq: session.lastSeq,
      context: {
        kind: request.source,
        label: request.source === 'exploration' ? '自由探索' : '项目学习',
        status: request.source === 'exploration' ? 'active' : 'confirmed',
        projectId: projectId ?? null,
      },
    };
  }

  async getSession(sessionId: string): Promise<GetTutorSessionResponse> {
    const projectId = this.projectIdBySession.get(sessionId);
    if (projectId === undefined) {
      throw new TutorDataError('会话不存在或已过期', 404, 'SESSION_NOT_FOUND');
    }
    const session = await this.fetchSession(
      projectId ?? undefined,
      this.explorationIdBySession.get(sessionId) ?? undefined,
    );
    this.projectIdBySession.set(session.sessionId, projectId);
    this.sessionCursor.set(session.sessionId, session.lastSeq);
    this.explorationIdBySession.set(session.sessionId, session.explorationId);
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
      projectId: this.projectIdBySession.get(sessionId) ?? undefined,
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

  private async fetchSession(projectId?: string, explorationId?: string): Promise<GetTutorSessionResponse> {
    const params = new URLSearchParams();
    if (projectId !== undefined) params.set('projectId', projectId);
    if (explorationId !== undefined) params.set('explorationId', explorationId);
    const query = params.toString();
    const body = await this.fetchJson(
      `/api/v1/tutor/session${query.length > 0 ? `?${query}` : ''}`,
      '会话加载失败',
    );
    const data = unwrapData(body);
    if (!isTutorSessionResponse(data)) {
      throw new TutorDataError('会话数据格式不正确', undefined, 'BAD_SESSION_PAYLOAD');
    }
    this.sessionCursor.set(data.sessionId, data.lastSeq);
    return data;
  }

  private async fetchJson(
    path: string,
    failureLabel = '请求失败',
    init: RequestInit = {},
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(path, {
        ...init,
        credentials: 'same-origin',
        headers: {
          accept: 'application/json',
          ...init.headers,
        },
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

function isExplorationPayload(value: unknown): value is { id: string } {
  return typeof value === 'object' && value !== null && typeof (value as { id?: unknown }).id === 'string';
}

function isTutorProjectContext(value: unknown): value is TutorProjectContext {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<SharedTutorProjectContext>;
  return (
    typeof candidate.project?.id === 'string' &&
    typeof candidate.project?.title === 'string' &&
    typeof candidate.project?.stage === 'string' &&
    typeof candidate.project?.progress === 'number' &&
    typeof candidate.progress?.currentStageIndex === 'number' &&
    typeof candidate.progress?.stageTotal === 'number' &&
    typeof candidate.progress?.progressPercent === 'number' &&
    Array.isArray(candidate.stages) &&
    (candidate.currentTask === null || typeof candidate.currentTask === 'object')
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
