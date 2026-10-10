'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type ComposerMode = 'text' | 'voice';
type VoiceStatus = 'idle' | 'starting' | 'recording' | 'transcribing' | 'error';
type VoiceSelection = { providerId: string; modelId: string };
type VoiceCapability = VoiceSelection & { operations?: string[] };

function getRecorderMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return 'audio/webm';
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
  if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm';
  return '';
}

function MicIcon({ active = false }: { active?: boolean }) {
  return (
    <svg aria-hidden="true" className="qitu-composer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="8" y="3" width="8" height="12" rx="4" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" />
      {active ? <circle cx="12" cy="9" r="1.4" fill="currentColor" stroke="none" /> : null}
    </svg>
  );
}

function KeyboardIcon() {
  return (
    <svg aria-hidden="true" className="qitu-composer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M6 10h.01M9 10h.01M12 10h.01M15 10h.01M18 10h.01M7 14h10" strokeLinecap="round" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg aria-hidden="true" className="qitu-composer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="m4 4 16 8-16 8 3-8-3-8Z" strokeLinejoin="round" />
      <path d="M7 12h13" />
    </svg>
  );
}

function createIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `voice-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

interface PcmAudioPayload {
  codec: 'pcm_s16le';
  mimeType: 'audio/pcm';
  sampleRateHz: 16000;
  channels: 1;
  dataBase64: string;
}

/** Qwen Realtime accepts raw 16 kHz mono PCM, while MediaRecorder emits WebM/Opus. */
async function blobToPcm16(blob: Blob): Promise<PcmAudioPayload> {
  const AudioContextConstructor = window.AudioContext
    ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) throw new Error('VOICE_AUDIO_CONVERSION_UNSUPPORTED');
  const context = new AudioContextConstructor();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    const frameCount = Math.max(1, Math.ceil(decoded.duration * 16_000));
    const offline = new OfflineAudioContext(1, frameCount, 16_000);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    const samples = rendered.getChannelData(0);
    const pcm = new Int16Array(samples.length);
    for (let index = 0; index < samples.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
      pcm[index] = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
    }
    const bytes = new Uint8Array(pcm.buffer);
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return {
      codec: 'pcm_s16le',
      mimeType: 'audio/pcm',
      sampleRateHz: 16_000,
      channels: 1,
      dataBase64: btoa(binary),
    };
  } finally {
    await context.close().catch(() => undefined);
  }
}

/** Tutor voice input uses the server Qwen gateway and never stores raw audio in browser storage. */
export function Composer({
  draft,
  onDraftChange,
  offline,
  submitting,
  disabled,
  onSubmit,
}: {
  draft: string;
  onDraftChange: (value: string) => void;
  offline: boolean;
  submitting: boolean;
  disabled: boolean;
  onSubmit: () => void;
}) {
  const [mode, setMode] = useState<ComposerMode>('text');
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('idle');
  const [voiceSupported, setVoiceSupported] = useState<boolean | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceModel, setVoiceModel] = useState<VoiceSelection | null>(null);
  const [interimTranscript, setInterimTranscript] = useState('');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const voiceBaseRef = useRef('');

  useEffect(() => {
    const recorderReady = typeof window !== 'undefined'
      && typeof MediaRecorder !== 'undefined'
      && typeof navigator.mediaDevices?.getUserMedia === 'function'
      && getRecorderMimeType().length > 0;
    setVoiceSupported(recorderReady);
    if (!recorderReady) return;
    let disposed = false;
    void fetch('/api/v1/voice/capabilities', { credentials: 'same-origin', cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('VOICE_CAPABILITIES_UNAVAILABLE');
        return response.json() as Promise<{
          data?: { defaultModel?: VoiceSelection | null; models?: VoiceCapability[] };
        }>;
      })
      .then((payload) => {
        if (disposed) return;
        // Voice input requires a model that explicitly supports transcription;
        // a synthesis-only realtime model must not enable the recorder.
        const transcriptionModel = payload.data?.models?.find((model) =>
          Array.isArray(model.operations) && model.operations.includes('transcribe'),
        );
        setVoiceModel(transcriptionModel
          ? { providerId: transcriptionModel.providerId, modelId: transcriptionModel.modelId }
          : null);
      })
      .catch(() => {
        if (!disposed) setVoiceModel(null);
      });
    return () => {
      disposed = true;
    };
  }, []);

  const releaseStream = useCallback(() => {
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
  }, []);

  const stopListening = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder === null) {
      releaseStream();
      setVoiceStatus('idle');
      setInterimTranscript('');
      return;
    }
    recorderRef.current = null;
    if (recorder.state !== 'inactive') recorder.stop();
  }, [releaseStream]);

  const transcribe = useCallback(async (blob: Blob) => {
    if (voiceModel === null) throw new Error('VOICE_MODEL_UNAVAILABLE');
    const audio = await blobToPcm16(blob);
    const response = await fetch('/api/v1/voice/transcriptions', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'idempotency-key': createIdempotencyKey() },
      body: JSON.stringify({
        requestId: createIdempotencyKey(),
        model: voiceModel,
        audio,
        language: 'zh-CN',
      }),
    });
    if (!response.ok) throw new Error('VOICE_TRANSCRIPTION_FAILED');
    const payload = await response.json() as { data?: { transcript?: unknown } };
    const transcript = typeof payload.data?.transcript === 'string' ? payload.data.transcript.trim() : '';
    if (!transcript) throw new Error('VOICE_TRANSCRIPTION_EMPTY');
    onDraftChange([voiceBaseRef.current, transcript].filter(Boolean).join(' '));
  }, [onDraftChange, voiceModel]);

  const startListening = useCallback(async () => {
    if (disabled || submitting || offline || voiceModel === null) return;
    if (typeof navigator.mediaDevices?.getUserMedia !== 'function' || typeof MediaRecorder === 'undefined') {
      setVoiceError('当前设备不支持录音，请改用文字输入');
      setVoiceStatus('error');
      return;
    }
    setVoiceError(null);
    setInterimTranscript('');
    voiceBaseRef.current = draft.trim();
    setVoiceStatus('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getRecorderMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      streamRef.current = stream;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        releaseStream();
        setVoiceStatus('error');
        setVoiceError('录音暂时不可用，请重试或改用文字输入');
      };
      recorder.onstop = () => {
        releaseStream();
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        chunksRef.current = [];
        setVoiceStatus('transcribing');
        setInterimTranscript('正在转换语音…');
        void transcribe(blob)
          .then(() => {
            setVoiceError(null);
            setVoiceStatus('idle');
            setInterimTranscript('');
          })
          .catch(() => {
            setVoiceStatus('error');
            setInterimTranscript('');
            setVoiceError('语音转换失败，请重试或改用文字输入');
          });
      };
      recorder.start();
      recorderRef.current = recorder;
      setVoiceStatus('recording');
    } catch {
      releaseStream();
      setVoiceStatus('error');
      setVoiceError('无法访问麦克风，请允许权限后重试');
    }
  }, [disabled, draft, offline, releaseStream, submitting, transcribe, voiceModel]);

  useEffect(() => () => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    releaseStream();
  }, [releaseStream]);

  useEffect(() => {
    if (offline && voiceStatus !== 'idle') stopListening();
  }, [offline, stopListening, voiceStatus]);

  const isRecording = voiceStatus === 'starting' || voiceStatus === 'recording';
  const voiceUnavailable = voiceSupported === false || voiceModel === null;
  const canSend = draft.trim().length > 0 && !submitting && !disabled && !offline;

  const switchMode = () => {
    setVoiceError(null);
    setInterimTranscript('');
    if (mode === 'voice') {
      stopListening();
      setMode('text');
      return;
    }
    setMode('voice');
    void startListening();
  };

  const submit = () => {
    stopListening();
    setMode('text');
    if (canSend) onSubmit();
  };

  return (
    <form className="qitu-composer" onSubmit={(event) => { event.preventDefault(); submit(); }}>
      {mode === 'text' ? (
        <textarea
          className="qitu-composer-input"
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          placeholder={offline ? '当前离线，先把想法写下来，重连后再发送' : '说说你现在的想法'}
          disabled={disabled}
          rows={2}
          aria-label="输入你的想法"
        />
      ) : (
        <div className="qitu-composer-voice-panel" aria-live="polite">
          <div className={`qitu-composer-voice-orb${isRecording ? ' is-listening' : ''}`}><MicIcon active={isRecording} /></div>
          <div>
            <strong>{isRecording ? '正在录音' : voiceStatus === 'transcribing' ? '正在转换语音' : '语音输入已开启'}</strong>
            <p>{interimTranscript || (voiceError ?? '点击麦克风开始，说完后停止录音')}</p>
          </div>
        </div>
      )}

      <div className="qitu-composer-actions">
        <button
          type="button"
          className={`qitu-composer-mode${mode === 'voice' ? ' is-active' : ''}`}
          onClick={switchMode}
          disabled={disabled || (mode === 'text' && (offline || voiceUnavailable))}
          aria-pressed={mode === 'voice'}
          aria-label={mode === 'voice' ? '切换为文字输入' : '切换为语音输入'}
          title={voiceUnavailable ? '当前没有可用的语音转写模型' : mode === 'voice' ? '切换为文字输入' : '切换为语音输入'}
        >
          {mode === 'voice' ? <KeyboardIcon /> : <MicIcon />}
          <span>{mode === 'voice' ? '打字' : '语音'}</span>
        </button>

        {mode === 'voice' ? (
          <button
            type="button"
            className={`qitu-composer-voice-button${isRecording ? ' is-listening' : ''}`}
            onClick={isRecording ? stopListening : () => void startListening()}
            disabled={disabled || submitting || offline || voiceUnavailable || voiceStatus === 'transcribing'}
            aria-label={isRecording ? '停止录音' : '开始录音'}
            title={isRecording ? '停止录音' : '开始录音'}
          >
            <MicIcon active={isRecording} />
            <span>{isRecording ? '停止录音' : '开始说话'}</span>
          </button>
        ) : null}

        <button type="submit" className="qitu-button qitu-button-primary qitu-composer-submit" disabled={!canSend}>
          <SendIcon />
          <span>{submitting ? '发送中' : offline ? '离线暂存' : '发送'}</span>
        </button>
      </div>

      {offline ? <p className="qitu-composer-hint">网络恢复后可以继续发送</p> : null}
      {voiceUnavailable ? <p className="qitu-composer-hint">当前没有可用的服务器语音模型，请使用文字输入</p> : null}
      {voiceError && !voiceUnavailable ? <p className="qitu-composer-error" role="alert">{voiceError}</p> : null}
    </form>
  );
}
