'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Press-and-hold voice capture shell (max 60s).
 *
 * SCOPE: this is the client shell only — audio is captured and handed to the
 * caller as an in-memory `Blob`. It is NEVER written to `localStorage`,
 * `sessionStorage`, IndexedDB or the Cache API: raw voice from a minor is
 * sensitive and may only be recovered from the server journal. The button is
 * disabled while offline, and text input remains available as the degraded path.
 *
 * A11Y: the control is focusable and hold-to-talk also works from the keyboard
 * (hold Space/Enter to record, release to send). Holding the key across a
 * tab-out cancels the capture instead of leaving the button stuck in recording.
 */
export function VoiceHoldButton({
  disabled,
  maxSeconds = 60,
  onAudio,
}: {
  disabled: boolean;
  maxSeconds?: number;
  onAudio?: (audio: Blob) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [focused, setFocused] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);
  // Set while a capture is abandoned (tab-out / Escape) so `onstop` discards it.
  const cancelledRef = useRef(false);
  // The keyboard key currently held down, so keyup only stops that capture.
  const heldKeyRef = useRef<string | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    clearTimer();
    const recorder = recorderRef.current;
    if (recorder !== null && recorder.state !== 'inactive') {
      recorder.stop();
    }
    recorderRef.current = null;
    setRecording(false);
  }, [clearTimer]);

  // Abandon an in-flight capture without emitting audio (tab-out / blur).
  const cancel = useCallback(() => {
    cancelledRef.current = true;
    clearTimer();
    const recorder = recorderRef.current;
    if (recorder !== null && recorder.state !== 'inactive') {
      recorder.stop();
    }
    recorderRef.current = null;
    setRecording(false);
  }, [clearTimer]);

  useEffect(() => () => stop(), [stop]);

  const start = useCallback(async () => {
    if (disabled || recording) return;
    if (typeof navigator === 'undefined' || navigator.mediaDevices === undefined) return;
    cancelledRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        // Audio Blob exists only in this closure; nothing is persisted.
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        chunksRef.current = [];
        stream.getTracks().forEach((track) => track.stop());
        if (cancelledRef.current) return;
        onAudio?.(blob);
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      setSeconds(0);
      startedAtRef.current = Date.now();
      timerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000);
        setSeconds(elapsed);
        if (elapsed >= maxSeconds) stop();
      }, 250);
    } catch {
      // Microphone denied/unavailable: fall back to text without surfacing an error.
      setRecording(false);
    }
  }, [disabled, maxSeconds, onAudio, recording, stop]);

  return (
    <button
      type="button"
      className={[
        'qitu-voice-button',
        recording ? 'is-recording' : null,
        focused ? 'is-focused' : null,
      ]
        .filter((name): name is string => name !== null)
        .join(' ')}
      disabled={disabled}
      aria-pressed={recording}
      onPointerDown={(event) => {
        event.preventDefault();
        void start();
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        heldKeyRef.current = null;
        if (recorderRef.current !== null) cancel();
      }}
      onKeyDown={(event) => {
        if (event.key !== ' ' && event.key !== 'Enter') return;
        // Space would scroll the page; Enter would re-trigger the button.
        event.preventDefault();
        if (event.repeat || heldKeyRef.current !== null) return;
        heldKeyRef.current = event.key;
        void start();
      }}
      onKeyUp={(event) => {
        if (event.key !== heldKeyRef.current) return;
        event.preventDefault();
        heldKeyRef.current = null;
        stop();
      }}
    >
      {recording ? `松开发送 · ${seconds}s` : '按住说话'}
    </button>
  );
}
