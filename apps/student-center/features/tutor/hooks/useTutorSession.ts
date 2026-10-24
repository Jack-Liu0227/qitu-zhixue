'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CreateTutorFeedbackRequest, RealtimeServerEvent, TutorExperimentActionRequest, TutorExperimentActionResponse, TutorHintLevel, TutorTurn } from '@qitu/contracts';
import { useTutorDataSource } from '../TutorDataSourceProvider';
import { createIdempotencyKey } from '../idempotency';
import { TutorRealtimeClient } from '../realtime/tutorRealtimeClient';
import { applyServerEventToTurns, createStudentEchoTurn, dropTurn } from '../state';
import type {
  TutorConnectionStatus,
  TutorLoadStatus,
  TutorProjectContext,
  TutorViewError,
} from '../types';
import { deriveGuidanceRun } from '../pedagogy';
import { TutorDataError } from '../data';

export interface TutorSessionApi {
  project: TutorProjectContext | null;
  projectStatus: TutorLoadStatus;
  projectError: TutorViewError | null;
  projectRefreshError: TutorViewError | null;
  refreshProjectContext: () => Promise<void>;
  sessionId: string | null;
  canStartExploration: boolean;
  explorationId: string | null;
  turns: TutorTurn[];
  sessionStatus: TutorLoadStatus;
  sessionError: TutorViewError | null;
  connection: TutorConnectionStatus;
  offline: boolean;
  permissionDenied: boolean;
  streaming: boolean;
  escalated: boolean;
  stallCount: number;
  lastHintLevel: TutorHintLevel | null;
  guidanceRun: number;
  submitting: boolean;
  submitError: TutorViewError | null;
  /** A turn that the stream reported as failed (server error / safety block). */
  streamNotice: TutorViewError | null;
  dismissStreamNotice: () => void;
  submitText: (content: string, idempotencyKey: string) => Promise<void>;
  answerQuiz: (quizId: string, selectedKeys: string[], idempotencyKey: string) => Promise<import('@qitu/contracts').AnswerInteractiveQuizResponse>;
  explainQuiz: (quizId: string) => Promise<void>;
  submitExperimentAction: (experimentId: string, request: TutorExperimentActionRequest) => Promise<TutorExperimentActionResponse>;
  submitFeedback: (request: CreateTutorFeedbackRequest) => Promise<void>;
  selectOption: (label: string) => Promise<void>;
  retryProject: () => void;
  retrySession: () => void;
  reconnect: () => void;
}

function toViewError(error: unknown): TutorViewError {
  if (error instanceof TutorDataError) {
    return { message: error.message, status: error.status, code: error.code };
  }
  if (error instanceof Error) return { message: error.message };
  return { message: '发生未知错误' };
}

/**
 * Owns the tutor session lifecycle: left-column context, initial turn history,
 * the WebSocket stream (monotonic seq + replay + reconnect) and idempotent
 * submissions.
 *
 * Nothing here writes project state, AI decisions, growth records or audit
 * events — it only reads server projections and asks the server for a move.
 */
export function useTutorSession(projectId?: string, explorationKey = 0, requestedExplorationId?: string): TutorSessionApi {
  const dataSource = useTutorDataSource();

  const [project, setProject] = useState<TutorProjectContext | null>(null);
  /**
   * 真实项目摘要；自由探索会话为 `null`。
   *
   * 服务端对探索会话仍会返回上下文（为了携带 `team` 身份），但其中
   * `project` 为 `null`。所以「是否有项目」一律看本值，不能看 `project === null`。
   */
  const activeProject = project?.project ?? null;
  const activeProjectId = activeProject?.id ?? null;
  const [projectStatus, setProjectStatus] = useState<TutorLoadStatus>('loading');
  const [projectError, setProjectError] = useState<TutorViewError | null>(null);
  const [projectReloadKey, setProjectReloadKey] = useState(0);
  const [projectRefreshError, setProjectRefreshError] = useState<TutorViewError | null>(null);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [explorationId, setExplorationId] = useState<string | null>(null);
  const [turns, setTurns] = useState<TutorTurn[]>([]);
  const [sessionStatus, setSessionStatus] = useState<TutorLoadStatus>('loading');
  const [sessionError, setSessionError] = useState<TutorViewError | null>(null);
  const [sessionReloadKey, setSessionReloadKey] = useState(0);

  const [connection, setConnection] = useState<TutorConnectionStatus>('idle');
  const [browserOffline, setBrowserOffline] = useState(false);
  const [transportOffline, setTransportOffline] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [escalated, setEscalated] = useState(false);
  const [stallCount, setStallCount] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<TutorViewError | null>(null);
  const [streamNotice, setStreamNotice] = useState<TutorViewError | null>(null);

  const realtimeRef = useRef<TutorRealtimeClient | null>(null);
  const lastSeqRef = useRef(0);
  const sessionKeyRef = useRef<string | null>(null);
  const projectLoadGenerationRef = useRef(0);
  const projectRefreshGenerationRef = useRef(0);
  const activeProjectIdRef = useRef(activeProjectId);
  activeProjectIdRef.current = activeProjectId;
  const inFlightRef = useRef<number | null>(null);
  const startingRef = useRef<number | null>(null);
  const loadedSourceRef = useRef(dataSource);
  const loadedEntryRef = useRef<string | null>(null);
  const activeSessionRef = useRef<string | null>(null);
  const connectionWaiterRef = useRef<{ sessionId: string; resolve: () => void; reject: (error: Error) => void } | null>(null);
  const entryKey = JSON.stringify([projectId ?? null, requestedExplorationId ?? null, explorationKey, projectReloadKey, sessionReloadKey]);
  const canStartExploration = !projectId && !requestedExplorationId && sessionId === null && projectStatus === 'empty';

  /** Local echo turns awaiting the server's own copy on the next session load. */
  const echoIdsRef = useRef<string[]>([]);

  /**
   * Discard local echoes. Called whenever the authoritative turn list is
   * (re)loaded from the server, which by then includes those very turns.
   */
  const clearEchoes = useCallback((loaded: readonly TutorTurn[]): TutorTurn[] => {
    if (echoIdsRef.current.length === 0) return [...loaded];
    const ids = echoIdsRef.current;
    echoIdsRef.current = [];
    return ids.reduce<TutorTurn[]>((accumulator, id) => dropTurn(accumulator, id), [...loaded]);
  }, []);

  // Refresh only the server projection. The session identity and turn history
  // remain intact; stale responses cannot overwrite a newer project or refresh.
  const refreshProjectContext = useCallback(async () => {
    if (activeProjectId === null || activeProjectIdRef.current !== activeProjectId) return;
    const scope = projectLoadGenerationRef.current;
    const generation = ++projectRefreshGenerationRef.current;
    const current = () => scope === projectLoadGenerationRef.current
      && generation === projectRefreshGenerationRef.current
      && activeProjectIdRef.current === activeProjectId;
    try {
      const context = await dataSource.getProjectContext(activeProjectId);
      if (!current()) return;
      if (context?.project?.id !== activeProjectId) {
        throw new TutorDataError('当前项目进度暂不可用，请重试刷新。', 409, 'PROJECT_CONTEXT_UNAVAILABLE');
      }
      setProject(context);
      setProjectRefreshError(null);
      setTransportOffline(false);
    } catch (error) {
      if (!current()) return;
      const viewError = toViewError(error);
      if (viewError.status === 403) setPermissionDenied(true);
      if (viewError.code === 'NETWORK_OFFLINE') setTransportOffline(true);
      setProjectRefreshError(viewError);
    }
  }, [activeProjectId, dataSource]);

  // The default route is a presentation surface. Only an explicit history/project
  // selection resumes a session; free exploration starts from submitText below.
  useEffect(() => {
    if (loadedSourceRef.current === dataSource && loadedEntryRef.current === entryKey && activeSessionRef.current !== null) {
      return () => { projectLoadGenerationRef.current += 1; };
    }
    const generation = ++projectLoadGenerationRef.current;
    const current = () => generation === projectLoadGenerationRef.current;
    loadedEntryRef.current = null;
    loadedSourceRef.current = dataSource;
    activeSessionRef.current = null;
    sessionKeyRef.current = null;
    lastSeqRef.current = 0;
    echoIdsRef.current = [];
    setPermissionDenied(false);
    setProject(null);
    setProjectError(null);
    setProjectRefreshError(null);
    setProjectStatus(projectId || requestedExplorationId ? 'loading' : 'empty');
    setSessionStatus(projectId || requestedExplorationId ? 'loading' : 'empty');
    setSessionError(null);
    setTurns([]);
    setSessionId(null);
    setExplorationId(null);
    setConnection('idle');
    setStreaming(false);
    setEscalated(false);
    setSubmitting(false);
    setTransportOffline(false);
    setSubmitError(null);
    setStreamNotice(null);

    const load = async () => {
      if (!projectId && !requestedExplorationId) return;
      try {
        const context = projectId ? await dataSource.getProjectContext(projectId)
          : await dataSource.getExplorationContext?.(requestedExplorationId!) ?? null;
        if (!current()) return;
        setProject(context);
        setProjectStatus(context?.project ? 'ready' : 'empty');
        if (projectId && !context?.project) { setSessionStatus('empty'); return; }
        sessionKeyRef.current ??= createIdempotencyKey();
        const created = await dataSource.createSession({
          ...(projectId ? { projectId } : { explorationId: requestedExplorationId }),
          source: projectId ? 'project' : 'exploration', idempotencyKey: sessionKeyRef.current,
        });
        if (!current()) return;
        const session = await dataSource.getSession(created.sessionId);
        if (!current()) return;
        loadedEntryRef.current = entryKey;
        activeSessionRef.current = session.sessionId;
        lastSeqRef.current = session.lastSeq;
        setSessionId(session.sessionId);
        setExplorationId(session.explorationId);
        setTurns(clearEchoes(session.turns));
        setSessionStatus('ready');
      } catch (error) {
        if (!current()) return;
        const viewError = toViewError(error);
        if (viewError.status === 403) setPermissionDenied(true);
        if (viewError.code === 'NETWORK_OFFLINE') setTransportOffline(true);
        setProjectError(viewError);
        setProjectStatus('error');
        setSessionError(viewError);
        setSessionStatus('error');
      }
    };
    void load();
    return () => {
      projectLoadGenerationRef.current += 1;
      connectionWaiterRef.current?.reject(new TutorDataError('会话入口已变化，请在当前对话重试。', undefined, 'SESSION_CHANGED'));
      connectionWaiterRef.current = null;
    };
  }, [dataSource, projectId, requestedExplorationId, entryKey, clearEchoes]);

  // Subscribe to the stream whenever a session exists.
  useEffect(() => {
    if (sessionId === null) return;
    let active = true;
    const client = new TutorRealtimeClient({
      sessionId,
      initialSeq: lastSeqRef.current,
      createSocket: (id) => dataSource.createSocket(id),
      onEvent: (event: RealtimeServerEvent) => {
        if (!active) return;
        lastSeqRef.current = Math.max(lastSeqRef.current, event.seq);
        setTurns((previous) => applyServerEventToTurns(previous, event));
        if (event.type === 'turn.done') {
          setStreaming(false);
          void refreshProjectContext();
        }
        if (event.type === 'escalation.notice') setEscalated(true);
        if (event.type === 'safety.block') {
          // The turn ended without a `turn.done`; waiting would spin forever.
          setStreaming(false);
          setStreamNotice({ message: event.message, code: event.code });
        }
      },
      onStatus: (status) => {
        if (!active) return;
        setConnection(status);
        const waiter = connectionWaiterRef.current;
        if (waiter?.sessionId === sessionId) {
          if (status === 'open') { waiter.resolve(); connectionWaiterRef.current = null; }
          if (status === 'offline') {
            waiter.reject(new TutorDataError('连接暂未就绪，请重试发送。', undefined, 'STREAM_NOT_READY'));
            connectionWaiterRef.current = null;
          }
        }
        // A transport failure must clear the streaming flag: the client will
        // never receive `turn.done`, and leaving it set would spin forever.
        if (status === 'offline') setStreaming(false);
      },
      onResyncRequired: () => setStreaming(true),
    });
    realtimeRef.current = client;
    client.connect();
    return () => {
      active = false;
      client.disconnect();
      if (realtimeRef.current === client) realtimeRef.current = null;
    };
  }, [dataSource, sessionId, refreshProjectContext]);

  // Browser connectivity (offline state is distinct from a server error).
  useEffect(() => {
    const update = () => {
      setBrowserOffline(typeof navigator !== 'undefined' && navigator.onLine === false);
    };
    update();
    globalThis.addEventListener?.('online', update);
    globalThis.addEventListener?.('offline', update);
    return () => {
      globalThis.removeEventListener?.('online', update);
      globalThis.removeEventListener?.('offline', update);
    };
  }, []);

  const runSubmission = useCallback(
    async (
      sessionIdValue: string,
      payload: {
        content?: string;
        optionLabel?: string;
        idempotencyKey: string;
        attachments?: {
          id: string;
          name: string;
          type: 'image' | 'file';
          url: string;
          sizeText?: string;
        }[];
      },
      onSuccess?: () => void,
    ) => {
      const generation = projectLoadGenerationRef.current;
      if (inFlightRef.current === generation) throw new TutorDataError('消息正在发送，请稍候。', undefined, 'SUBMISSION_PENDING');
      inFlightRef.current = generation;
      setSubmitting(true);
      setSubmitError(null);
      setStreamNotice(null);
      // Show immediate feedback while the POST opens the SSE stream. Without
      // this, a fresh conversation has a blank gap before the first event.
      setStreaming(true);
      try {
        const accepted = await dataSource.submitTurn(sessionIdValue, payload);
        if (generation !== projectLoadGenerationRef.current || activeSessionRef.current !== sessionIdValue) {
          throw new TutorDataError('会话入口已变化，请在当前对话重试。', undefined, 'SESSION_CHANGED');
        }
        lastSeqRef.current = Math.max(lastSeqRef.current, accepted.seq);
        setTransportOffline(false);
        // Echo the student's own sentence immediately. The stream only carries
        // the assistant's half of the turn, so without this the student stares
        // at an empty thread while the server reads the project context.
        const echoText = payload.content ?? payload.optionLabel ?? '';
        if (echoText.length > 0 || (payload.attachments && payload.attachments.length > 0)) {
          const echo = createStudentEchoTurn({
            turnId: `local-echo-${payload.idempotencyKey}`,
            baselineSeq: accepted.seq,
            text: echoText,
            attachments: payload.attachments,
          });
          echoIdsRef.current = [...echoIdsRef.current, echo.turnId];
          setTurns((previous) => [...previous, echo]);
        }
        onSuccess?.();
      } catch (error) {
        if (generation !== projectLoadGenerationRef.current) throw error;
        const viewError = toViewError(error);
        if (viewError.status === 409) {
          // Duplicate idempotency key → already accepted; never render twice.
          return;
        }
        setSubmitError(viewError);
        // A rejected submission never opened a stream, so the thread must not
        // keep waiting for one.
        setStreaming(false);
        throw error;
      } finally {
        if (inFlightRef.current === generation) inFlightRef.current = null;
        if (generation === projectLoadGenerationRef.current) setSubmitting(false);
      }
    },
    [dataSource],
  );

  const submitText = useCallback(
    async (
      content: string,
      idempotencyKey: string,
      attachments?: {
        id: string;
        name: string;
        type: 'image' | 'file';
        url: string;
        sizeText?: string;
      }[],
    ) => {
      if (browserOffline || typeof navigator !== 'undefined' && navigator.onLine === false) {
        throw new TutorDataError('网络已断开，请恢复连接后重试。', undefined, 'NETWORK_OFFLINE');
      }
      if (!content.trim() && sessionId === null) {
        throw new TutorDataError('请先输入一句话，再开始探索。', undefined, 'FIRST_MESSAGE_REQUIRED');
      }
      if (!content.trim() && !attachments?.length) return;
      const generation = projectLoadGenerationRef.current;
      if (startingRef.current === generation) throw new TutorDataError('第一句话正在发送，请稍候。', undefined, 'SUBMISSION_PENDING');
      const ensureCurrent = () => {
        if (generation !== projectLoadGenerationRef.current) throw new TutorDataError('会话入口已变化，请在当前对话重试。', undefined, 'SESSION_CHANGED');
      };
      let targetSessionId = sessionId;
      let targetExplorationId = explorationId;
      try {
        if (targetSessionId === null) {
          if (!canStartExploration) throw new TutorDataError('教学会话尚未就绪。', undefined, 'SESSION_NOT_READY');
          startingRef.current = generation;
          setSubmitting(true);
          setSubmitError(null);
          sessionKeyRef.current ??= createIdempotencyKey();
          const created = await dataSource.createSession({ source: 'exploration', idempotencyKey: sessionKeyRef.current });
          ensureCurrent();
          const loaded = await dataSource.getSession(created.sessionId);
          ensureCurrent();
          if (!loaded.explorationId) throw new TutorDataError('探索会话范围不正确。', undefined, 'BAD_SESSION_PAYLOAD');
          const context = await dataSource.getExplorationContext?.(loaded.explorationId) ?? null;
          ensureCurrent();
          targetSessionId = loaded.sessionId;
          targetExplorationId = loaded.explorationId;
          activeSessionRef.current = loaded.sessionId;
          lastSeqRef.current = loaded.lastSeq;
          // Wait for the real stream subscription before delivering the first message.
          let timeout: ReturnType<typeof setTimeout>;
          const connected = new Promise<void>((resolve, reject) => {
            timeout = setTimeout(() => reject(new TutorDataError('连接暂未就绪，请重试发送。', undefined, 'STREAM_NOT_READY')), 15000);
            connectionWaiterRef.current = { sessionId: loaded.sessionId, resolve, reject };
          });
          setProject(context);
          setSessionId(loaded.sessionId);
          setExplorationId(loaded.explorationId);
          setTurns(clearEchoes(loaded.turns));
          setSessionStatus('ready');
          try { await connected; } finally { clearTimeout(timeout!); connectionWaiterRef.current = null; }
          ensureCurrent();
        }
        await runSubmission(targetSessionId, { content, idempotencyKey, attachments });
        ensureCurrent();
        if (!projectId && targetExplorationId && !requestedExplorationId) {
          // Adopt the new URL without reloading the just-created session or interrupting its stream.
          loadedEntryRef.current = JSON.stringify([null, targetExplorationId, explorationKey, projectReloadKey, sessionReloadKey]);
          const url = new URL(window.location.href);
          url.searchParams.delete('new'); url.searchParams.delete('idle'); url.searchParams.delete('explorePrompt');
          url.searchParams.set('explorationId', targetExplorationId);
          window.history.replaceState(null, '', url);
        }
      } catch (error) {
        if (generation === projectLoadGenerationRef.current) {
          const viewError = toViewError(error);
          setSubmitError(viewError);
          if (viewError.status === 403) setPermissionDenied(true);
          setStreaming(false);
        }
        throw error;
      } finally {
        if (startingRef.current === generation) startingRef.current = null;
        if (generation === projectLoadGenerationRef.current) setSubmitting(false);
      }
    },
    [runSubmission, sessionId, explorationId, canStartExploration, browserOffline, dataSource, clearEchoes,
      projectId, requestedExplorationId, explorationKey, projectReloadKey, sessionReloadKey],
  );

  const selectOption = useCallback(
    async (label: string) => {
      if (sessionId === null) return;
      const key = createIdempotencyKey();
      await runSubmission(sessionId, { optionLabel: label, idempotencyKey: key });
    },
    [runSubmission, sessionId],
  );

  const answerQuiz = useCallback(
    async (quizId: string, selectedKeys: string[], idempotencyKey: string) => {
      if (sessionId === null) throw new TutorDataError('教学会话尚未连接', undefined, 'SESSION_NOT_READY');
      if (browserOffline || transportOffline) throw new TutorDataError('网络已断开，请恢复连接后重试', undefined, 'NETWORK_OFFLINE');
      const result = await dataSource.answerInteractiveQuiz(sessionId, quizId, { selectedKeys, idempotencyKey });
      await refreshProjectContext();
      return result;
    },
    [browserOffline, dataSource, sessionId, transportOffline, refreshProjectContext],
  );

  const explainQuiz = useCallback(
    async (quizId: string) => {
      if (sessionId === null) throw new TutorDataError('教学会话尚未连接', undefined, 'SESSION_NOT_READY');
      if (browserOffline || transportOffline) throw new TutorDataError('网络已断开，请恢复连接后重试', undefined, 'NETWORK_OFFLINE');
      await dataSource.requestQuizExplanation(sessionId, quizId);
    },
    [browserOffline, dataSource, sessionId, transportOffline],
  );

  const submitExperimentAction = useCallback(
    async (experimentId: string, request: TutorExperimentActionRequest) => {
      if (sessionId === null) throw new TutorDataError('教学会话尚未连接', undefined, 'SESSION_NOT_READY');
      if (browserOffline || transportOffline) throw new TutorDataError('网络已断开，请恢复连接后重试', undefined, 'NETWORK_OFFLINE');
      const result = await dataSource.submitExperimentAction(sessionId, experimentId, request);
      await refreshProjectContext();
      return result;
    },
    [browserOffline, dataSource, sessionId, transportOffline, refreshProjectContext],
  );

  const submitFeedback = useCallback(
    async (request: CreateTutorFeedbackRequest) => {
      if (sessionId === null) throw new TutorDataError('教学会话尚未连接', undefined, 'SESSION_NOT_READY');
      if (browserOffline || transportOffline) throw new TutorDataError('网络已断开，请恢复连接后重试', undefined, 'NETWORK_OFFLINE');
      await dataSource.submitFeedback(sessionId, request);
    },
    [browserOffline, dataSource, sessionId, transportOffline],
  );

  const lastHintLevel = useMemo<TutorHintLevel | null>(() => {
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      const turn = turns[index];
      if (turn !== undefined && turn.role === 'assistant' && turn.hintLevel !== null) {
        return turn.hintLevel;
      }
    }
    return null;
  }, [turns]);

  const guidanceRun = useMemo(() => deriveGuidanceRun(turns), [turns]);

  const retryProject = useCallback(() => setProjectReloadKey((key) => key + 1), []);
  const retrySession = useCallback(() => {
    // A retry supersedes whatever the failed step reported.
    setSubmitError(null);
    setStreamNotice(null);
    setSessionReloadKey((key) => key + 1);
  }, []);
  const reconnect = useCallback(() => realtimeRef.current?.connect(), []);
  const dismissStreamNotice = useCallback(() => setStreamNotice(null), []);

  return {
    project,
    projectStatus,
    projectError,
    projectRefreshError,
    refreshProjectContext,
    sessionId,
    canStartExploration,
    explorationId,
    turns,
    sessionStatus,
    sessionError,
    connection,
    offline: browserOffline || transportOffline || connection === 'offline',
    permissionDenied,
    streaming: streaming || sessionStatus === 'loading',
    escalated,
    stallCount,
    lastHintLevel,
    guidanceRun,
    submitting,
    submitError,
    streamNotice,
    dismissStreamNotice,
    submitText,
    answerQuiz,
    explainQuiz,
    submitExperimentAction,
    submitFeedback,
    selectOption,
    retryProject,
    retrySession,
    reconnect,
  };
}
