'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { AudioCodec } from '@qitu/contracts';

/** Local recording phase. Mirrors the visible states of the control. */
export type VoiceHoldPhase = 'idle' | 'recording' | 'sending' | 'error';

export interface VoiceChunk {
  seq: number;
  dataBase64: string;
  codec: AudioCodec;
}

export interface VoiceHoldEndInfo {
  durationMs: number;
  voiceActivityMs: number;
}

export interface VoiceHoldButtonProps {
  disabled?: boolean;
  /** Hard stop, default 60s. */
  maxMs?: number;
  permission?: 'unknown' | 'granted' | 'denied' | 'unsupported';
  onStart?: () => void;
  /**
   * Optional real audio frames. The mock/typed transport path never captures
   * audio; a future real recorder can stream frames here.
   */
  onAudioChunk?: (chunk: VoiceChunk) => void;
  onEnd: (info: VoiceHoldEndInfo) => void | Promise<void>;
  onCancel?: (reason: 'user' | 'interrupt') => void;
  label?: string;
}

/**
 * Module-local hold-to-talk control.
 *
 * Not exported by `@qitu/ui` yet, so it lives here with press-and-hold
 * semantics, keyboard support (Space/Enter hold, Escape cancel) and visible
 * recording / sending / error states. Emits `audio.end` with a duration only —
 * it never keeps an audio buffer.
 */
export function VoiceHoldButton({
  disabled = false,
  maxMs = 60000,
  permission = 'granted',
  onStart,
  onEnd,
  onCancel,
  label = '按住说话',
}: VoiceHoldButtonProps) {
  const [phase, setPhase] = useState<VoiceHoldPhase>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);

  const holdingRef = useRef(false);
  const startTimeRef = useRef(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const clearTimers = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (autoStopRef.current) {
      clearTimeout(autoStopRef.current);
      autoStopRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimers();
    };
  }, [clearTimers]);

  const permissionBlocked = permission === 'denied' || permission === 'unsupported';
  const unavailable = disabled || permissionBlocked;
  const recording = phase === 'recording';

  const finish = useCallback(
    async (reason: 'release' | 'auto' | 'cancel') => {
      if (!holdingRef.current) return;
      holdingRef.current = false;
      clearTimers();
      const durationMs = Math.max(0, Date.now() - startTimeRef.current);
      if (reason === 'cancel') {
        setElapsedMs(0);
        setPhase('idle');
        onCancel?.('user');
        return;
      }
      setPhase('sending');
      try {
        await onEnd({ durationMs, voiceActivityMs: durationMs });
        if (mountedRef.current) setPhase('idle');
      } catch {
        if (mountedRef.current) setPhase('error');
      } finally {
        if (mountedRef.current) setElapsedMs(0);
      }
    },
    [clearTimers, onCancel, onEnd],
  );

  const finishRef = useRef(finish);
  useEffect(() => {
    finishRef.current = finish;
  }, [finish]);

  const start = useCallback(() => {
    if (unavailable || holdingRef.current) return;
    if (permission !== 'granted') return;
    holdingRef.current = true;
    startTimeRef.current = Date.now();
    setElapsedMs(0);
    setPhase('recording');
    onStart?.();
    tickRef.current = setInterval(() => {
      setElapsedMs(Date.now() - startTimeRef.current);
    }, 200);
    autoStopRef.current = setTimeout(() => {
      void finishRef.current('auto');
    }, maxMs);
  }, [maxMs, onStart, permission, unavailable]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === 'Escape' && holdingRef.current) {
        event.preventDefault();
        void finishRef.current('cancel');
        return;
      }
      if (event.key === ' ' || event.key === 'Enter') {
        if (event.repeat) return;
        event.preventDefault();
        start();
      }
    },
    [start],
  );

  const handleKeyUp = useCallback((event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      void finishRef.current('release');
    }
  }, []);

  const seconds = Math.floor(elapsedMs / 1000);
  const phaseLabel = recording
    ? `正在录音 ${seconds}s`
    : phase === 'sending'
      ? '发送中…'
      : phase === 'error'
        ? '发送失败，请重试'
        : permissionBlocked
          ? '需要麦克风权限'
          : label;

  return (
    <button
      type="button"
      className={`qitu-voice-hold is-${phase}`}
      aria-pressed={recording}
      aria-label={phaseLabel}
      disabled={unavailable}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        start();
      }}
      onPointerUp={(event) => {
        event.currentTarget.releasePointerCapture(event.pointerId);
        void finishRef.current('release');
      }}
      onPointerCancel={() => {
        void finishRef.current('cancel');
      }}
      onContextMenu={(event) => {
        event.preventDefault();
      }}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
    >
      <span className="qitu-voice-hold-dot" aria-hidden="true" />
      <span className="qitu-voice-hold-label">{phaseLabel}</span>
    </button>
  );
}
