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
import {
  MOCK_ACTIVE_PROJECT,
  MOCK_PROJECT_CONTEXT,
  MOCK_PROJECT_ID,
  MOCK_SESSION,
  MOCK_SESSION_ID,
  MOCK_STREAM_EVENTS,
  MOCK_SUMMARY,
} from './fixtures';
import { MockTutorSocket } from './mockTutorSocket';
import type { TutorProjectContext } from '../types';
import { HINT_LEVEL_MIN } from '../pedagogy';

/**
 * Scenario knobs so QA can walk every one of the five screen states without a
 * backend. These are test affordances on the mock only; the real data source
 * has no such switches.
 */
export interface MockTutorScenario {
  noProject?: boolean;
  permissionDenied?: boolean;
  sessionError?: boolean;
  forceOffline?: boolean;
}

/**
 * This mock is disposable and is available for explicit tests/QA through
 * `setTutorDataSource`.
 */
export class MockTutorDataSource implements TutorDataSource {
  private scenario: MockTutorScenario;
  private readonly latencyMs: number;
  private readonly turnKeys = new Map<string, CreateTutorTurnResponse>();
  private readonly feedbackKeys = new Set<string>();
  private readonly sockets = new Map<string, MockTutorSocket>();
  /** Continues after the replayable fixture events so seq stays monotonic. */
  private nextSeq = maxSeq(MOCK_STREAM_EVENTS) + 1;

  constructor(scenario: MockTutorScenario = {}, latencyMs = 120) {
    this.scenario = scenario;
    this.latencyMs = latencyMs;
  }

  /** QA-only: flip a scenario without rebuilding the data source. */
  setScenario(scenario: MockTutorScenario): void {
    this.scenario = scenario;
  }

  async getActiveProject(): Promise<ProjectSummary | null> {
    await this.delay();
    if (this.scenario.permissionDenied) {
      throw new TutorDataError('没有访问权限', 403, 'FORBIDDEN');
    }
    if (this.scenario.noProject) return null;
    return MOCK_ACTIVE_PROJECT;
  }

  async getProjectContext(projectId: string): Promise<TutorProjectContext | null> {
    await this.delay();
    this.assertReadable();
    if (projectId !== MOCK_PROJECT_ID) return null;
    return MOCK_PROJECT_CONTEXT;
  }

  async createSession(request: CreateTutorSessionRequest): Promise<CreateTutorSessionResponse> {
    await this.delay();
    this.assertReadable();
    return {
      sessionId: MOCK_SESSION_ID,
      projectId: request.projectId ?? null,
      explorationId: request.explorationId ?? null,
      source: request.source,
      createdAt: new Date().toISOString(),
      lastSeq: MOCK_SESSION.lastSeq,
      context: {
        kind: request.source,
        label: request.source === 'exploration' ? '自由探索' : '项目学习',
        status: request.source === 'exploration' ? 'active' : 'confirmed',
        projectId: request.projectId ?? null,
      },
    };
  }

  async getSession(sessionId: string): Promise<GetTutorSessionResponse> {
    await this.delay();
    this.assertReadable();
    if (this.scenario.sessionError) {
      throw new TutorDataError('会话加载失败，请稍后重试', 500, 'SESSION_LOAD_FAILED');
    }
    if (sessionId !== MOCK_SESSION_ID) {
      throw new TutorDataError('会话不存在', 404, 'SESSION_NOT_FOUND');
    }
    return MOCK_SESSION;
  }

  async submitTurn(
    sessionId: string,
    request: CreateTutorTurnRequest,
  ): Promise<CreateTutorTurnResponse> {
    await this.delay();
    this.assertReadable();
    const existing = this.turnKeys.get(request.idempotencyKey);
    if (existing !== undefined) {
      // Same key → the server would answer 409; the client must not re-render.
      throw new TutorDataError('重复提交', 409, 'IDEMPOTENCY_CONFLICT');
    }
    const turnId = `turn-local-${this.nextSeq}`;
    const baseSeq = this.nextSeq - 1;
    const blockSeq = this.nextSeq;
    const doneSeq = this.nextSeq + 1;
    this.nextSeq += 2;
    // `seq` is the journal BASELINE this turn starts from; the first streamed
    // event carries `seq + 1`. The caller uses the baseline to order the
    // student's own echo before the assistant's reply.
    const response: CreateTutorTurnResponse = { turnId, seq: baseSeq, accepted: true };
    this.turnKeys.set(request.idempotencyKey, response);
    this.pushStreamedTurn(
      sessionId,
      turnId,
      blockSeq,
      doneSeq,
      request.pedagogicMove !== undefined,
    );
    return response;
  }

  async getSummary(_sessionId: string): Promise<TutorSessionSummary> {
    await this.delay();
    this.assertReadable();
    return MOCK_SUMMARY;
  }

  async submitFeedback(
    _sessionId: string,
    request: CreateTutorFeedbackRequest,
  ): Promise<CreateTutorFeedbackResponse> {
    await this.delay();
    this.assertReadable();
    if (this.feedbackKeys.has(request.idempotencyKey)) {
      throw new TutorDataError('重复提交', 409, 'IDEMPOTENCY_CONFLICT');
    }
    this.feedbackKeys.add(request.idempotencyKey);
    return { accepted: true };
  }

  createSocket(sessionId: string): TutorSocket {
    const socket = new MockTutorSocket();
    // Replace any previous connection for this session, mirroring a reconnect.
    this.sockets.set(sessionId, socket);
    return socket;
  }

  /** Resolve a previously recorded idempotency key (used by hook tests). */
  lookupTurnKey(idempotencyKey: string): CreateTutorTurnResponse | undefined {
    return this.turnKeys.get(idempotencyKey);
  }

  /** Stream a follow-up block + completion over the live mock socket. */
  private pushStreamedTurn(
    sessionId: string,
    turnId: string,
    blockSeq: number,
    doneSeq: number,
    isCapability: boolean,
  ): void {
    const socket = this.sockets.get(sessionId);
    if (socket === undefined) return;
    const timestamp = new Date().toISOString();
    socket.push({
      type: 'tutor.block',
      sessionId,
      turnId,
      seq: blockSeq,
      timestamp,
      block: isCapability
        ? { kind: 'hint', level: HINT_LEVEL_MIN, text: '先想一想：这一步最关键的线索是什么？' }
        : { kind: 'text', text: '我收到了，我们一起把这一步想清楚。' },
    });
    socket.push({
      type: 'turn.done',
      sessionId,
      turnId,
      seq: doneSeq,
      timestamp,
      turnSummary: { hintLevel: isCapability ? HINT_LEVEL_MIN : null, stage: 'theory_learning' },
    });
  }

  private assertReadable(): void {
    if (this.scenario.permissionDenied) {
      throw new TutorDataError('没有访问权限', 403, 'FORBIDDEN');
    }
    if (this.scenario.forceOffline) {
      throw new TutorDataError('网络不可用', undefined, 'NETWORK_OFFLINE');
    }
  }

  private delay(): Promise<void> {
    return new Promise((resolve) => {
      globalThis.setTimeout(resolve, this.latencyMs);
    });
  }
}

function maxSeq(events: ReadonlyArray<{ seq: number }>): number {
  return events.reduce((max, event) => (event.seq > max ? event.seq : max), 0);
}
