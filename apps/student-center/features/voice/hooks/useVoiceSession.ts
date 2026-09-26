'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AudioCodec } from '@qitu/contracts';
import {
  VoiceSessionError,
  voiceDataSource as defaultVoiceDataSource,
  type VoiceDataSource,
  type VoiceTransport,
  type VoiceTransportStatus,
} from '../data';
import {
  buildAudioChunk,
  buildAudioEnd,
  buildStallSignal,
  buildSubscribe,
  buildTurnCancel,
  buildTurnStart,
} from '../realtime/events';
import {
  applyServerEvent,
  createInitialVoiceState,
  withOptimisticStudentTurn,
  type VoiceSessionState,
} from '../realtime/reducer';

export type VoiceConnectionStatus =
  | 'idle'
  | 'loading'
  | 'open'
  | 'reconnecting'
  | 'offline'
  | 'error'
  | 'forbidden';

export type MicrophonePermission = 'unknown' | 'granted' | 'denied' | 'unsupported';

export interface UseVoiceSessionOptions {
  /** Existing session to attach to; omit to start a fresh one. */
  sessionId?: string;
  autoConnect?: boolean;
  /** Swappable data source. Defaults to the mock voice data source. */
  dataSource?: VoiceDataSource;
  maxReconnectAttempts?: number;
}

export interface VoiceSessionApi {
  state: VoiceSessionState;
  status: VoiceConnectionStatus;
  connection: 'online' | 'reconnecting' | 'offline';
  error: { code: string; message: string } | null;
  microphone: MicrophonePermission;
  /** True whenever the realtime channel is not open: text input stays usable. */
  textFallback: boolean;
  submitting: boolean;
  connect: () => void;
  reconnect: () => void;
  retry: () => void;
  requestMicrophone: () => Promise<boolean>;
  sendText: (text: string) => Promise<void>;
  beginVoiceTurn: () => string | null;
  sendAudioChunk: (input: {
    turnId: string;
    seq: number;
    dataBase64: string;
    codec: AudioCodec;
  }) => void;
  endVoiceTurn: (turnId: string, durationMs: number, voiceActivityMs: number) => void;
  cancelTurn: (turnId: string) => void;
  signalStall: (turnId: string) => void;
  /** UI-only dismissal of the current safety notice. */
  clearSafetyBlock: () => void;
}

let localIdCounter = 0;

function createLocalId(prefix: string): string {
  localIdCounter += 1;
  const cryptoObject = typeof globalThis.crypto === 'undefined' ? undefined : globalThis.crypto;
  if (cryptoObject && typeof cryptoObject.randomUUID === 'function') {
    return `${prefix}_${cryptoObject.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${localIdCounter}`;
}

function toErrorState(caught: unknown): { code: string; message: string } {
  if (caught instanceof VoiceSessionError) return { code: caught.code, message: caught.message };
  if (caught instanceof Error) return { code: 'NETWORK', message: caught.message };
  return { code: 'NETWORK', message: '语音连接失败，请重试' };
}

export function useVoiceSession(options: UseVoiceSessionOptions = {}): VoiceSessionApi {
  const {
    sessionId,
    autoConnect = true,
    dataSource = defaultVoiceDataSource,
    maxReconnectAttempts = 3,
  } = options;

  const [state, setState] = useState<VoiceSessionState>(() =>
    createInitialVoiceState(sessionId ?? null),
  );
  const [status, setStatus] = useState<VoiceConnectionStatus>('idle');
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [microphone, setMicrophone] = useState<MicrophonePermission>('unknown');
  const [submitting, setSubmitting] = useState(false);

  const cursorRef = useRef(0);
  const sessionIdRef = useRef<string | null>(sessionId ?? null);
  const transportRef = useRef<VoiceTransport | null>(null);
  const unsubscribeEventRef = useRef<(() => void) | null>(null);
  const unsubscribeStatusRef = useRef<(() => void) | null>(null);
  const attemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submittingRef = useRef(false);
  const connectingRef = useRef(false);
  const mountedRef = useRef(false);
  const openTransportRef = useRef<(requestedSession: string | undefined, afterSeq: number) => void>(
    () => undefined,
  );

  useEffect(() => {
    cursorRef.current = state.cursor;
  }, [state.cursor]);

  const detach = useCallback(() => {
    if (unsubscribeEventRef.current) {
      unsubscribeEventRef.current();
      unsubscribeEventRef.current = null;
    }
    if (unsubscribeStatusRef.current) {
      unsubscribeStatusRef.current();
      unsubscribeStatusRef.current = null;
    }
    if (transportRef.current) {
      transportRef.current.close();
      transportRef.current = null;
    }
  }, []);

  const scheduleReconnect = useCallback(() => {
    if (!mountedRef.current) return;
    if (attemptsRef.current >= maxReconnectAttempts) {
      setStatus('offline');
      return;
    }
    attemptsRef.current += 1;
    setStatus('reconnecting');
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = setTimeout(
      () => {
        openTransportRef.current(sessionIdRef.current ?? undefined, cursorRef.current);
      },
      Math.min(1000 * attemptsRef.current, 4000),
    );
  }, [maxReconnectAttempts]);

  const openTransport = useCallback(
    async (requestedSession: string | undefined, afterSeq: number): Promise<void> => {
      if (connectingRef.current) return;
      connectingRef.current = true;
      try {
        const boot = await dataSource.openSession({ sessionId: requestedSession, afterSeq });
        if (!mountedRef.current) {
          boot.transport.close();
          return;
        }
        detach();
        sessionIdRef.current = boot.sessionId;
        setState((previous) => ({ ...previous, sessionId: boot.sessionId }));
        unsubscribeEventRef.current = boot.transport.onEvent((event) => {
          setState((previous) => applyServerEvent(previous, event));
        });
        unsubscribeStatusRef.current = boot.transport.onStatus((next: VoiceTransportStatus) => {
          if (next === 'closed' || next === 'error') scheduleReconnect();
        });
        transportRef.current = boot.transport;
        attemptsRef.current = 0;
        setStatus('open');
        setError(null);
        // Reconnect replay: the server returns every event with seq > afterSeq.
        boot.transport.send(buildSubscribe(boot.sessionId, afterSeq));
      } catch (caught) {
        if (!mountedRef.current) return;
        const next = toErrorState(caught);
        if (caught instanceof VoiceSessionError && caught.code === 'PERMISSION_DENIED') {
          setStatus('forbidden');
          setError(next);
          return;
        }
        if (attemptsRef.current > 0 || afterSeq > 0) {
          setStatus('reconnecting');
          scheduleReconnect();
          return;
        }
        setStatus('error');
        setError(next);
      } finally {
        connectingRef.current = false;
      }
    },
    [dataSource, detach, scheduleReconnect],
  );

  useEffect(() => {
    openTransportRef.current = (requestedSession, afterSeq) => {
      void openTransport(requestedSession, afterSeq);
    };
  }, [openTransport]);

  const connect = useCallback(() => {
    setStatus('loading');
    setError(null);
    void openTransport(sessionIdRef.current ?? undefined, cursorRef.current);
  }, [openTransport]);

  const reconnect = useCallback(() => {
    attemptsRef.current = 0;
    connect();
  }, [connect]);

  useEffect(() => {
    mountedRef.current = true;
    if (autoConnect) {
      setStatus('loading');
      void openTransport(sessionId, 0);
    }
    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      detach();
    };
    // Mount/unmount only: connect()/reconnect() drive later lifecycles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoConnect]);

  const requestMicrophone = useCallback(async (): Promise<boolean> => {
    if (
      typeof navigator === 'undefined' ||
      typeof navigator.mediaDevices?.getUserMedia !== 'function'
    ) {
      setMicrophone('unsupported');
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Permission probe only: stop every track immediately and never keep audio.
      for (const track of stream.getTracks()) track.stop();
      setMicrophone('granted');
      return true;
    } catch {
      setMicrophone('denied');
      return false;
    }
  }, []);

  const sendText = useCallback(
    async (raw: string): Promise<void> => {
      const text = raw.trim();
      const activeSession = sessionIdRef.current;
      if (text.length === 0 || !activeSession) return;
      // Double-click guard: one logical submission at a time.
      if (submittingRef.current) return;
      submittingRef.current = true;
      setSubmitting(true);
      const turnId = createLocalId('turn');
      const idempotencyKey = createLocalId('idem');
      setState((previous) =>
        withOptimisticStudentTurn(previous, { turnId, text, modality: 'text' }),
      );
      try {
        const transport = transportRef.current;
        if (transport && status === 'open') {
          transport.send(
            buildTurnStart({ sessionId: activeSession, turnId, modality: 'text', text, idempotencyKey }),
          );
        } else {
          // Degraded path: same session, idempotent REST fallback.
          const accepted = await dataSource.submitTextTurn({
            sessionId: activeSession,
            turnId,
            text,
            idempotencyKey,
          });
          setState((previous) => ({ ...previous, cursor: Math.max(previous.cursor, accepted.seq) }));
        }
      } catch (caught) {
        setError(toErrorState(caught));
      } finally {
        submittingRef.current = false;
        setSubmitting(false);
      }
    },
    [dataSource, status],
  );

  const beginVoiceTurn = useCallback((): string | null => {
    const activeSession = sessionIdRef.current;
    const transport = transportRef.current;
    if (!activeSession || !transport) return null;
    const turnId = createLocalId('turn');
    transport.send(
      buildTurnStart({
        sessionId: activeSession,
        turnId,
        modality: 'voice',
        idempotencyKey: createLocalId('idem'),
      }),
    );
    return turnId;
  }, []);

  const sendAudioChunk = useCallback(
    (input: { turnId: string; seq: number; dataBase64: string; codec: AudioCodec }) => {
      const activeSession = sessionIdRef.current;
      const transport = transportRef.current;
      if (!activeSession || !transport) return;
      transport.send(buildAudioChunk({ sessionId: activeSession, ...input }));
    },
    [],
  );

  const endVoiceTurn = useCallback(
    (turnId: string, durationMs: number, voiceActivityMs: number) => {
      const activeSession = sessionIdRef.current;
      const transport = transportRef.current;
      if (!activeSession || !transport) return;
      transport.send(
        buildAudioEnd({ sessionId: activeSession, turnId, durationMs, voiceActivityMs }),
      );
    },
    [],
  );

  const cancelTurn = useCallback((turnId: string) => {
    const activeSession = sessionIdRef.current;
    const transport = transportRef.current;
    if (!activeSession || !transport) return;
    transport.send(buildTurnCancel({ sessionId: activeSession, turnId, reason: 'user' }));
  }, []);

  const signalStall = useCallback((turnId: string) => {
    const activeSession = sessionIdRef.current;
    const transport = transportRef.current;
    if (!activeSession || !transport) return;
    transport.send(
      buildStallSignal({
        sessionId: activeSession,
        turnId,
        idempotencyKey: createLocalId('idem'),
      }),
    );
  }, []);

  const clearSafetyBlock = useCallback(() => {
    setState((previous) => ({ ...previous, safetyBlock: null }));
  }, []);

  const connection: 'online' | 'reconnecting' | 'offline' =
    status === 'open' ? 'online' : status === 'reconnecting' ? 'reconnecting' : 'offline';

  return useMemo<VoiceSessionApi>(
    () => ({
      state,
      status,
      connection,
      error,
      microphone,
      textFallback: status !== 'open',
      submitting,
      connect,
      reconnect,
      retry: connect,
      requestMicrophone,
      sendText,
      beginVoiceTurn,
      sendAudioChunk,
      endVoiceTurn,
      cancelTurn,
      signalStall,
      clearSafetyBlock,
    }),
    [
      state,
      status,
      connection,
      error,
      microphone,
      submitting,
      connect,
      reconnect,
      requestMicrophone,
      sendText,
      beginVoiceTurn,
      sendAudioChunk,
      endVoiceTurn,
      cancelTurn,
      signalStall,
      clearSafetyBlock,
    ],
  );
}
