'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  RealtimeServerEvent,
  TutorHintLevel,
  TutorTurn,
} from '@qitu/contracts';
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
  sessionId: string | null;
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
export function useTutorSession(projectId?: string): TutorSessionApi {
  const dataSource = useTutorDataSource();

  const [project, setProject] = useState<TutorProjectContext | null>(null);
  const [projectStatus, setProjectStatus] = useState<TutorLoadStatus>('loading');
  const [projectError, setProjectError] = useState<TutorViewError | null>(null);
  const [projectReloadKey, setProjectReloadKey] = useState(0);

  const [sessionId, setSessionId] = useState<string | null>(null);
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
  const inFlightRef = useRef(false);
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
    return ids.reduce<TutorTurn[]>((accumulator, id) => dropTurn(accumulator, id), [
      ...loaded,
    ]);
  }, []);

  // Load the active project (or the routed project) context.
  useEffect(() => {
    let cancelled = false;
    setPermissionDenied(false);
    setProjectStatus('loading');
    setProjectError(null);
    // A new project needs a fresh, idempotent session-creation key.
    sessionKeyRef.current = null;

    const load = async () => {
      try {
        if (projectId !== undefined) {
          const context = await dataSource.getProjectContext(projectId);
          if (cancelled) return;
          setProject(context);
          setProjectStatus(context === null ? 'empty' : 'ready');
          return;
        }
        const active = await dataSource.getActiveProject();
        if (cancelled) return;
        if (active === null) {
          setProject(null);
          setProjectStatus('empty');
          return;
        }
        const context = await dataSource.getProjectContext(active.id);
        if (cancelled) return;
        setProject(context);
        setProjectStatus(context === null ? 'empty' : 'ready');
      } catch (error) {
        if (cancelled) return;
        const viewError = toViewError(error);
        if (viewError.status === 403) setPermissionDenied(true);
        if (viewError.code === 'NETWORK_OFFLINE') setTransportOffline(true);
        setProjectError(viewError);
        setProjectStatus('error');
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [dataSource, projectId, projectReloadKey]);

  // Create (idempotently) and load the tutor session for the resolved project.
  useEffect(() => {
    if (
      projectStatus === 'loading' ||
      projectStatus === 'error' ||
      (project === null && projectId !== undefined)
    ) {
      // No session without a ready project. The left context panel owns the
      // project's loading/empty/error surface; mirror that state into the
      // conversation area so it never lies: a failed project load is an error
      // (retryable), not an empty thread inviting the student to chat.
      const sessionState: TutorLoadStatus =
        projectStatus === 'loading' ? 'loading' : projectStatus === 'error' ? 'error' : 'empty';
      setSessionStatus(sessionState);
      setSessionError(projectStatus === 'error' ? projectError : null);
      setTurns([]);
      setSessionId(null);
      return;
    }
    let cancelled = false;
    setPermissionDenied(false);
    setSessionStatus('loading');
    setSessionError(null);
    setTurns([]);
    setSessionId(null);

    const load = async () => {
      try {
        sessionKeyRef.current ??= createIdempotencyKey();
        const created = await dataSource.createSession({
          ...(project === null ? {} : { projectId: project.project.id }),
          source: project === null ? 'exploration' : 'project',
          idempotencyKey: sessionKeyRef.current,
        });
        const session = await dataSource.getSession(created.sessionId);
        if (cancelled) return;
        lastSeqRef.current = session.lastSeq;
        setTransportOffline(false);
        setSessionId(session.sessionId);
        setTurns(clearEchoes(session.turns));
        setSessionStatus('ready');
      } catch (error) {
        if (cancelled) return;
        const viewError = toViewError(error);
        if (viewError.status === 403) setPermissionDenied(true);
        if (viewError.code === 'NETWORK_OFFLINE') setTransportOffline(true);
        setSessionError(viewError);
        setSessionStatus('error');
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [dataSource, project, projectStatus, projectError, sessionReloadKey, clearEchoes]);

  // Subscribe to the stream whenever a session exists.
  useEffect(() => {
    if (sessionId === null) return;
    const client = new TutorRealtimeClient({
      sessionId,
      initialSeq: lastSeqRef.current,
      createSocket: (id) => dataSource.createSocket(id),
      onEvent: (event: RealtimeServerEvent) => {
        lastSeqRef.current = Math.max(lastSeqRef.current, event.seq);
        setTurns((previous) => applyServerEventToTurns(previous, event));
        if (event.type === 'turn.done') setStreaming(false);
        if (event.type === 'escalation.notice') setEscalated(true);
        if (event.type === 'safety.block') {
          // The turn ended without a `turn.done`; waiting would spin forever.
          setStreaming(false);
          setStreamNotice({ message: event.message, code: event.code });
        }
      },
      onStatus: (status) => {
        setConnection(status);
        // A transport failure must clear the streaming flag: the client will
        // never receive `turn.done`, and leaving it set would spin forever.
        if (status === 'offline') setStreaming(false);
      },
      onResyncRequired: () => setStreaming(true),
    });
    realtimeRef.current = client;
    client.connect();
    return () => {
      client.disconnect();
      realtimeRef.current = null;
    };
  }, [dataSource, sessionId]);

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
      },
      onSuccess?: () => void,
    ) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setSubmitting(true);
      setSubmitError(null);
      setStreamNotice(null);
      try {
        const accepted = await dataSource.submitTurn(sessionIdValue, payload);
        lastSeqRef.current = Math.max(lastSeqRef.current, accepted.seq);
        setTransportOffline(false);
        setStreaming(true);
        // Echo the student's own sentence immediately. The stream only carries
        // the assistant's half of the turn, so without this the student stares
        // at an empty thread while the server reads the project context.
        const echoText = payload.content ?? payload.optionLabel ?? '';
        if (echoText.length > 0) {
          const echo = createStudentEchoTurn({
            turnId: `local-echo-${payload.idempotencyKey}`,
            baselineSeq: accepted.seq,
            text: echoText,
          });
          echoIdsRef.current = [...echoIdsRef.current, echo.turnId];
          setTurns((previous) => [...previous, echo]);
        }
        onSuccess?.();
      } catch (error) {
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
        inFlightRef.current = false;
        setSubmitting(false);
      }
    },
    [dataSource],
  );

  const submitText = useCallback(
    async (content: string, idempotencyKey: string) => {
      if (sessionId === null) return;
      await runSubmission(sessionId, { content, idempotencyKey });
    },
    [runSubmission, sessionId],
  );

  const selectOption = useCallback(
    async (label: string) => {
      if (sessionId === null) return;
      const key = createIdempotencyKey();
      await runSubmission(sessionId, { optionLabel: label, idempotencyKey: key });
    },
    [runSubmission, sessionId],
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
    sessionId,
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
    selectOption,
    retryProject,
    retrySession,
    reconnect,
  };
}
