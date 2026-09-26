import type {
  CreateTutorSessionRequest,
  CreateTutorSessionResponse,
  CreateTutorTurnRequest,
  CreateTutorTurnResponse,
  GetTutorSessionResponse,
} from '@qitu/contracts';
import type { TutorSocket } from '../realtime/tutorRealtimeClient';
import { TutorDataError, type TutorDataSource } from './dataSource';
import { LiveTutorSocket } from './liveTutorSocket';
import { MockTutorDataSource } from './mockTutorDataSource';
import { MOCK_ACTIVE_PROJECT, MOCK_SESSION_ID } from './fixtures';

/**
 * The tutor data source the app actually runs on.
 *
 * WHAT IS REAL: the conversation. `GET /tutor/session` supplies the persisted
 * history and the journal cursor, and `POST /tutor/stream` streams every turn
 * as `tool_call → tool_result → delta → block → done`.
 *
 * WHAT IS STILL FIXTURE-BACKED: the left column's project context
 * (`getActiveProject` / `getProjectContext`). The M1 API does not expose
 * `/projects/active` or `/projects/:id` yet, and inventing a client-side guess
 * about a child's project would be worse than showing the documented demo
 * project. Those two methods therefore delegate to `MockTutorDataSource` and
 * are marked as the remaining Wave-4 gap. They are READ-ONLY projections: no
 * route here writes project stage, growth records, AI decisions or audit logs.
 */
export class TutorApiDataSource implements TutorDataSource {
  private readonly fixtures = new MockTutorDataSource();
  private readonly projectIdBySession = new Map<string, string>();
  private readonly sockets = new Map<string, LiveTutorSocket>();
  private readonly sessionCursor = new Map<string, number>();
  /** Sessions where the streaming API actually answered at least once. */
  private readonly everLive = new Set<string>();
  private liveUnreachable = false;
  private sessionCounter = 0;

  /** True once the streaming API proved unreachable and fixtures took over. */
  get usingFixtures(): boolean {
    return this.liveUnreachable;
  }

  async getActiveProject() {
    return this.fixtures.getActiveProject();
  }

  async getProjectContext(projectId: string) {
    return this.fixtures.getProjectContext(projectId);
  }

  async createSession(
    request: CreateTutorSessionRequest,
  ): Promise<CreateTutorSessionResponse> {
    if (this.liveUnreachable) return this.fixtures.createSession(request);
    const projectId = request.projectId ?? MOCK_ACTIVE_PROJECT.id;
    try {
      const session = await this.fetchSession(projectId);
      this.projectIdBySession.set(session.sessionId, projectId);
      return {
        sessionId: session.sessionId,
        projectId,
        createdAt: new Date().toISOString(),
        lastSeq: session.lastSeq,
      };
    } catch (error) {
      const failure = toTutorError(error);
      if (!isUnreachable(failure)) throw failure;
      // The API is down: keep the page usable on the documented demo fixtures
      // instead of trapping the student on an error screen.
      this.liveUnreachable = true;
      return this.fixtures.createSession(request);
    }
  }

  async getSession(sessionId: string): Promise<GetTutorSessionResponse> {
    const projectId = this.projectIdBySession.get(sessionId);
    if (this.liveUnreachable || projectId === undefined) {
      const fallback = await this.fixtures.getSession(sessionId);
      this.sessionCursor.set(fallback.sessionId, fallback.lastSeq);
      return fallback;
    }
    try {
      const session = await this.fetchSession(projectId);
      this.projectIdBySession.set(session.sessionId, projectId);
      this.sessionCursor.set(session.sessionId, session.lastSeq);
      return session;
    } catch (error) {
      const failure = toTutorError(error);
      if (!isUnreachable(failure)) throw failure;
      this.liveUnreachable = true;
      const fallback = await this.fixtures.getSession(MOCK_SESSION_ID);
      this.sessionCursor.set(fallback.sessionId, fallback.lastSeq);
      return fallback;
    }
  }

  async submitTurn(
    sessionId: string,
    request: CreateTutorTurnRequest,
  ): Promise<CreateTutorTurnResponse> {
    const socket = this.liveUnreachable ? undefined : this.sockets.get(sessionId);
    if (socket === undefined) return this.fixtures.submitTurn(sessionId, request);
    // The stream itself is opened by the socket; the ack only carries the
    // journal baseline so the UI can order the student's echo correctly.
    const baseline = socket.startTurn({
      content: request.content,
      pedagogicMove: request.pedagogicMove,
      optionLabel: request.optionLabel,
      idempotencyKey: request.idempotencyKey,
    });
    return {
      turnId: `live-${this.sessionCounter += 1}`,
      seq: baseline,
      accepted: true,
    };
  }

  async getSummary(sessionId: string) {
    return this.fixtures.getSummary(sessionId);
  }

  async submitFeedback(
    sessionId: string,
    request: Parameters<TutorDataSource['submitFeedback']>[1],
  ) {
    return this.fixtures.submitFeedback(sessionId, request);
  }

  createSocket(sessionId: string): TutorSocket {
    if (this.liveUnreachable) return this.fixtures.createSocket(sessionId);
    const existing = this.sockets.get(sessionId);
    if (existing !== undefined) return existing;
    const socket = new LiveTutorSocket(sessionId, {
      projectId: this.projectIdBySession.get(sessionId),
      initialSeq: this.sessionCursor.get(sessionId) ?? 0,
      onUnreachable: (error) => {
        // A stream failure has two very different causes and they must not be
        // collapsed:
        //
        // * TRANSPORT died (no HTTP status) on a session whose cursor is
        //   already past the fixture journal. Swapping in fixtures here would
        //   make every later fixture event look "already seen" to
        //   `TutorRealtimeClient` — the reply would be dropped and the thread
        //   would spin forever. Fixtures may therefore only take over for a
        //   session where the live API NEVER answered.
        // * The API answered with 4xx/5xx. That is a real answer (forbidden,
        //   expired session, server bug) and must stay visible; hiding it
        //   behind demo content would mask a permission failure.
        const transportDied = isUnreachable(error);
        if (transportDied && !this.everLive.has(sessionId)) {
          this.liveUnreachable = true;
        } else if (!transportDied) {
          // Only a server *reply* is worth a message; a dead transport already
          // surfaces as the offline banner + reconnect.
          socket.failStream(error);
        }
        // Detach either way: the client stops waiting, shows its state and
        // reconnects to this same instance (journal + cursor survive).
        socket.close();
      },
    });
    this.sockets.set(sessionId, socket);
    return socket;
  }

  private async fetchSession(projectId: string): Promise<GetTutorSessionResponse> {
    let response: Response;
    try {
      response = await fetch(
        `/api/v1/tutor/session?projectId=${encodeURIComponent(projectId)}`,
        { credentials: 'same-origin', headers: { accept: 'application/json' } },
      );
    } catch (error) {
      throw new TutorDataError(
        error instanceof Error ? error.message : '网络不可用',
        undefined,
        'NETWORK_OFFLINE',
      );
    }
    if (!response.ok) {
      throw new TutorDataError(
        `会话加载失败（${response.status}）`,
        response.status,
        `HTTP_${response.status}`,
      );
    }
    const body: unknown = await response.json();
    const data = unwrapData(body);
    if (!isTutorSessionResponse(data)) {
      throw new TutorDataError('会话数据格式不正确', response.status, 'BAD_SESSION_PAYLOAD');
    }
    this.everLive.add(data.sessionId);
    return data;
  }
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

function toTutorError(error: unknown): TutorDataError {
  if (error instanceof TutorDataError) return error;
  return new TutorDataError(
    error instanceof Error ? error.message : '发生未知错误',
    undefined,
    'NETWORK_OFFLINE',
  );
}

/** Only a transport failure justifies the fixture fallback, never a 4xx/5xx. */
function isUnreachable(error: TutorDataError): boolean {
  return error.code === 'NETWORK_OFFLINE' || error.status === undefined;
}
