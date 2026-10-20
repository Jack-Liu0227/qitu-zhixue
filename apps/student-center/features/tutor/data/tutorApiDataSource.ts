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
  TutorProjectContext as SharedTutorProjectContext,
  TutorSessionSummary,
  TutorTeamGraph,
  TutorTeamAgent,
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
  async confirmExploration(explorationId: string, draft: { goal: string; interest: string; templateVersionId?: string }, idempotencyKey: string): Promise<ConfirmIntentResponse> {
    const goal = draft.goal.trim();
    const interest = draft.interest.trim();
    if (!goal || goal.length > 120 || !interest || interest.length > 24) {
      throw new TutorDataError('请填写 120 字以内的学习目标和 24 字以内的兴趣方向', 400, 'INTENT_DRAFT_INCOMPLETE');
    }
    const current = unwrapData(await this.fetchJson(`/api/v1/explorations/${encodeURIComponent(explorationId)}`, '探索状态读取失败'));
    if (!isExplorationPayload(current)) throw new TutorDataError('探索状态格式不正确');
    // A lost confirmation response must be retryable without patching a confirmed exploration.
    if (!('status' in current) || current.status !== 'confirmed') {
      await this.fetchJson(`/api/v1/explorations/${encodeURIComponent(explorationId)}`, '学习目标保存失败', {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ goalUser: goal, coreInterests: [interest] }),
      });
    }
    const payload = await this.fetchJson(`/api/v1/explorations/${encodeURIComponent(explorationId)}/confirm-intent`, '学习意图确认失败', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
      body: JSON.stringify({ templateVersionId: draft.templateVersionId }),
    });
    const result = unwrapData(payload) as ConfirmIntentResponse | null;
    if (!result?.project?.id) throw new TutorDataError('确认响应缺少项目', undefined, 'BAD_CONFIRMATION_PAYLOAD');
    return result;
  }
  private readonly projectIdBySession = new Map<string, string | null>();
  private readonly explorationIdBySession = new Map<string, string | null>();
  private readonly sessionContextById = new Map<string, { projectId?: string; explorationId?: string }>();
  private readonly sockets = new Map<string, LiveTutorSocket>();
  private readonly sessionCursor = new Map<string, number>();
  private sessionCounter = 0;

  async getActiveProject(): Promise<ProjectSummary | null> {
    const context = await this.fetchProjectContext();
    return context?.project ?? null;
  }

  async listProjects(): Promise<ProjectSummary[]> {
    const response = await this.fetchJson('/api/v1/projects', '项目列表加载失败');
    const data = unwrapData(response);
    if (!Array.isArray(data)) throw new TutorDataError('项目列表格式不正确', undefined, 'BAD_PROJECT_LIST_PAYLOAD');
    const projects = data.flatMap((item): ProjectSummary[] => {
      if (typeof item !== 'object' || item === null) return [];
      const candidate = item as Record<string, unknown>;
      if (typeof candidate.id !== 'string' || typeof candidate.title !== 'string' ||
          typeof candidate.status !== 'string' || typeof candidate.progressPercent !== 'number') return [];
      return [{ id: candidate.id, title: candidate.title, stage: candidate.status as ProjectSummary['stage'], progress: candidate.progressPercent }];
    });
    const countsBody = unwrapData(await this.fetchJson(`/api/v1/tutor/session-counts?projectIds=${projects.map((project) => encodeURIComponent(project.id)).join(',')}`, '会话消息数加载失败'));
    const counts = countsBody !== null && typeof countsBody === 'object' ? countsBody as Record<string, unknown> : {};
    return projects.map((project) => ({ ...project, turnCount: typeof counts[project.id] === 'number' ? Number(counts[project.id]) : 0 }));
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

  async getTeamGraph(projectId: string): Promise<TutorTeamGraph | null> {
    const response = await this.fetchJson(
      `/api/v1/tutor/team-graph?projectId=${encodeURIComponent(projectId)}`,
      '团队智能体加载失败',
    );
    const data = unwrapData(response);
    if (data === null) return null;
    if (!isTutorTeamGraph(data)) {
      throw new TutorDataError('团队智能体数据格式不正确', undefined, 'BAD_TEAM_GRAPH_PAYLOAD');
    }
    return normalizeTutorTeamGraph(data);
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
    let projectId = this.projectIdBySession.get(sessionId);
    let explorationId = this.explorationIdBySession.get(sessionId) ?? undefined;
    const context = this.sessionContextById.get(sessionId);
    if (projectId === undefined && context !== undefined) projectId = context.projectId ?? null;
    // Recover the durable session directly after a route transition or
    // data-source remount. This endpoint re-checks student ownership on the
    // server, so the browser never has to infer project context from an ID.
    if (projectId === undefined) {
      const body = await this.fetchJson(
        `/api/v1/tutor/sessions/${encodeURIComponent(sessionId)}`,
        '会话加载失败',
      );
      const data = unwrapData(body);
      if (!isTutorSessionResponse(data)) {
        throw new TutorDataError('会话数据格式不正确', undefined, 'BAD_SESSION_PAYLOAD');
      }
      this.sessionCursor.set(data.sessionId, data.lastSeq);
      this.projectIdBySession.set(data.sessionId, data.projectId);
      this.explorationIdBySession.set(data.sessionId, data.explorationId);
      this.sessionContextById.set(data.sessionId, {
        ...(data.projectId ? { projectId: data.projectId } : {}),
        ...(data.explorationId ? { explorationId: data.explorationId } : {}),
      });
      return data;
    }
    const session = await this.fetchSession(projectId ?? undefined, explorationId);
    this.projectIdBySession.set(session.sessionId, projectId);
    this.sessionCursor.set(session.sessionId, session.lastSeq);
    this.explorationIdBySession.set(session.sessionId, session.explorationId);
    this.sessionContextById.set(session.sessionId, {
      ...(session.projectId ? { projectId: session.projectId } : {}),
      ...(session.explorationId ? { explorationId: session.explorationId } : {}),
    });
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

  async answerInteractiveQuiz(
    sessionId: string,
    quizId: string,
    request: AnswerInteractiveQuizRequest,
  ): Promise<AnswerInteractiveQuizResponse> {
    const payload = await this.fetchJson(
      `/api/v1/tutor/sessions/${encodeURIComponent(sessionId)}/interactive/${encodeURIComponent(quizId)}/answer`,
      '答案提交失败',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': request.idempotencyKey },
        body: JSON.stringify({ selectedKeys: request.selectedKeys, idempotencyKey: request.idempotencyKey }),
      },
    );
    const data = unwrapData(payload);
    if (!isAnswerInteractiveQuizResponse(data, quizId)) {
      throw new TutorDataError('判分响应格式不正确', undefined, 'BAD_QUIZ_ANSWER_PAYLOAD');
    }
    return data;
  }

  async requestQuizExplanation(sessionId: string, quizId: string): Promise<void> {
    const key = `quiz-explain-${sessionId}-${quizId}`;
    await this.submitTurn(sessionId, {
      content: `请解释题目 ${quizId} 的这个概念`,
      pedagogicMove: 'explain',
      idempotencyKey: key,
    });
  }

  async submitExperimentAction(
    sessionId: string,
    experimentId: string,
    request: TutorExperimentActionRequest,
  ): Promise<TutorExperimentActionResponse> {
    const payload = await this.fetchJson(
      `/api/v1/tutor/sessions/${encodeURIComponent(sessionId)}/interactive/experiments/${encodeURIComponent(experimentId)}/action`,
      'Experiment action submission failed',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': request.idempotencyKey },
        body: JSON.stringify(request),
      },
    );
    const data = unwrapData(payload);
    if (!isTutorExperimentActionResponse(data, experimentId, request.action)
      || (request.action === 'record_observation' && (data.observationReceipt?.sessionId !== sessionId
        || data.observationReceipt?.runActionId !== (request.payload as { runActionId?: unknown })?.runActionId))) {
      throw new TutorDataError('Invalid experiment action response', undefined, 'BAD_EXPERIMENT_ACTION_PAYLOAD');
    }
    return data;
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
    sessionId: string,
    request: CreateTutorFeedbackRequest,
  ): Promise<CreateTutorFeedbackResponse> {
    const payload = await this.fetchJson(
      `/api/v1/tutor/sessions/${encodeURIComponent(sessionId)}/feedback`,
      'Feedback submission failed',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': request.idempotencyKey },
        body: JSON.stringify(request),
      },
    );
    const data = unwrapData(payload);
    if (typeof data !== 'object' || data === null || (data as { accepted?: unknown }).accepted !== true) {
      throw new TutorDataError('Invalid feedback response', undefined, 'BAD_FEEDBACK_PAYLOAD');
    }
    return data as CreateTutorFeedbackResponse;
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
    this.sessionContextById.set(data.sessionId, {
      ...(data.projectId ? { projectId: data.projectId } : {}),
      ...(data.explorationId ? { explorationId: data.explorationId } : {}),
    });
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
      const payload: unknown = await response.json().catch(() => null);
      const problem = payload !== null && typeof payload === 'object' ? payload as Record<string, unknown> : {};
      throw new TutorDataError(
        typeof problem.detail === 'string' ? problem.detail : `${failureLabel}（${response.status}）`,
        response.status,
        typeof problem.code === 'string' ? problem.code : `HTTP_${response.status}`,
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
    (candidate.project === null ||
      (typeof candidate.project?.id === 'string' &&
        typeof candidate.project?.title === 'string' &&
        typeof candidate.project?.stage === 'string' &&
        typeof candidate.project?.progress === 'number')) &&
    typeof candidate.progress?.currentStageIndex === 'number' &&
    typeof candidate.progress?.stageTotal === 'number' &&
    typeof candidate.progress?.progressPercent === 'number' &&
    Array.isArray(candidate.stages) &&
    (candidate.currentTask === null || typeof candidate.currentTask === 'object') &&
    (candidate.team === undefined || isTutorTeamIdentity(candidate.team)) &&
    (candidate.phases === undefined || Array.isArray(candidate.phases))
  );
}

function isTutorTeamIdentity(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.teamId === null || typeof candidate.teamId === 'string') &&
    (candidate.teamName === null || typeof candidate.teamName === 'string') &&
    typeof candidate.assistantId === 'string' &&
    typeof candidate.assistantName === 'string'
  );
}

function isTutorExperimentActionResponse(
  value: unknown,
  experimentId: string,
  action: TutorExperimentActionRequest['action'],
): value is TutorExperimentActionResponse {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<TutorExperimentActionResponse>;
  if (action === 'record_observation') {
    const receipt = candidate.observationReceipt;
    if (!receipt || receipt.experimentId !== experimentId || receipt.provenance !== 'simulated_observation'
      || typeof receipt.observationId !== 'string' || !receipt.observationId
      || receipt.evidenceRef !== `experiment_observation:${receipt.observationId}`
      || typeof receipt.runActionId !== 'string' || !receipt.runActionId
      || typeof receipt.planId !== 'string' || !receipt.planId || !Number.isSafeInteger(receipt.planRevision)
      || typeof receipt.savedAt !== 'string' || !Number.isFinite(Date.parse(receipt.savedAt))) return false;
  }
  return candidate.accepted === true
    && candidate.experimentId === experimentId
    && candidate.action === action
    && typeof candidate.actionId === 'string' && candidate.actionId.length > 0;
}

function isTutorTeamGraph(value: unknown): value is TutorTeamGraph {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<TutorTeamGraph>;
  return (
    typeof candidate.team === 'object' && candidate.team !== null &&
    isTutorTeamIdentity(candidate.team) &&
    (candidate.runId === null || typeof candidate.runId === 'string') &&
    Array.isArray(candidate.agents)
  );
}



function normalizeTutorTeamGraph(graph: TutorTeamGraph): TutorTeamGraph {
  const agents = graph.agents.map((raw, index) => {
    const agent = raw as Partial<TutorTeamAgent>;
    return {
      slotId: typeof agent.slotId === 'string' && agent.slotId.length > 0 ? agent.slotId : 'slot-' + index,
      assistantId: typeof agent.assistantId === 'string' ? agent.assistantId : 'assistant-' + index,
      name: typeof agent.name === 'string' && agent.name.length > 0 ? agent.name : '未命名智能体',
      role: typeof agent.role === 'string' ? agent.role : '导师',
      roleLabel: typeof agent.roleLabel === 'string' || agent.roleLabel === null ? agent.roleLabel : null,
      avatar: typeof agent.avatar === 'string' || agent.avatar === null ? agent.avatar : null,
      color: typeof agent.color === 'string' || agent.color === null ? agent.color : null,
      status: isTutorTeamAgentStatus(agent.status) ? agent.status : 'offline',
      currentTaskSummary: typeof agent.currentTaskSummary === 'string' || agent.currentTaskSummary === null ? agent.currentTaskSummary : null,
      pblPhase: typeof agent.pblPhase === 'string' || agent.pblPhase === null ? agent.pblPhase : null,
      messages: Array.isArray(agent.messages) ? agent.messages.filter(isTutorTeamAgentMessage) : [],
      toolCalls: Array.isArray(agent.toolCalls) ? agent.toolCalls.filter(isTutorTeamAgentToolCall) : [],
    };
  });
  return { ...graph, agents };
}

function isTutorTeamAgentStatus(value: unknown): value is TutorTeamAgent['status'] {
  return value === 'ready' || value === 'running' || value === 'waiting' || value === 'failed' || value === 'offline';
}

function isTutorTeamAgentMessage(value: unknown): value is TutorTeamAgent['messages'][number] {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return typeof item.messageId === 'string' && typeof item.summary === 'string' &&
    (item.direction === 'inbound' || item.direction === 'outbound') && typeof item.createdAt === 'string';
}

function isTutorTeamAgentToolCall(value: unknown): value is TutorTeamAgent['toolCalls'][number] {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return typeof item.callId === 'string' && typeof item.name === 'string' &&
    typeof item.label === 'string' && isTutorToolCallStatus(item.status) &&
    typeof item.startedAt === 'string';
}

function isTutorToolCallStatus(value: unknown): boolean {
  return value === 'running' || value === 'done' || value === 'error';
}
function unwrapData(body: unknown): unknown {
  if (typeof body === 'object' && body !== null && 'data' in body) {
    return (body as { data: unknown }).data;
  }
  return body;
}

function isAnswerInteractiveQuizResponse(value: unknown, quizId: string): value is AnswerInteractiveQuizResponse {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<AnswerInteractiveQuizResponse>;
  return (
    candidate.quizId === quizId &&
    typeof candidate.correct === 'boolean' &&
    typeof candidate.attempts === 'number' &&
    typeof candidate.hintLevel === 'number' &&
    (candidate.explanation === null || typeof candidate.explanation === 'string') &&
    (candidate.correctKeys === null || Array.isArray(candidate.correctKeys)) &&
    Array.isArray(candidate.conceptDeltas) &&
    candidate.conceptDeltas.every((delta) => (
      typeof delta === 'object' && delta !== null &&
      typeof delta.conceptId === 'string' &&
      typeof delta.before === 'number' && typeof delta.after === 'number' &&
      typeof delta.mastered === 'boolean'
    )) &&
    (candidate.nextGuidance === undefined || candidate.nextGuidance === null || typeof candidate.nextGuidance === 'string') &&
    typeof candidate.replayed === 'boolean'
  );
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
