'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type ComposerMode = 'text' | 'voice';
type VoiceStatus = 'idle' | 'starting' | 'listening' | 'error';

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  [index: number]: { transcript: string };
}

interface SpeechRecognitionEventLike extends Event {
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}

interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const browserWindow = window as SpeechRecognitionWindow;
  return browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition ?? null;
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

/** The Tutor composer supports text entry and browser speech-to-text. */
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
  const [interimTranscript, setInterimTranscript] = useState('');
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const voiceBaseRef = useRef('');
  const finalTranscriptRef = useRef('');

  useEffect(() => {
    setVoiceSupported(getSpeechRecognitionConstructor() !== null);
  }, []);

  const stopListening = useCallback(() => {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      try {
        recognition.stop();
      } catch {
        recognition.abort();
      }
    }
    setVoiceStatus('idle');
    setInterimTranscript('');
  }, []);

  const startListening = useCallback(() => {
    if (disabled || submitting || offline) return;
    const Recognition = getSpeechRecognitionConstructor();
    if (!Recognition) {
      setVoiceError('当前浏览器不支持语音识别，请切换到文字输入。');
      setVoiceStatus('error');
      return;
    }

    stopListening();
    const recognition = new Recognition();
    voiceBaseRef.current = draft.trim();
    finalTranscriptRef.current = '';
    setVoiceError(null);
    setInterimTranscript('');
    setVoiceStatus('starting');
    recognition.lang = 'zh-CN';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => setVoiceStatus('listening');
    recognition.onresult = (event) => {
      const finalParts: string[] = [];
      const interimParts: string[] = [];
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript?.trim();
        if (!transcript) continue;
        (result.isFinal ? finalParts : interimParts).push(transcript);
      }
      finalTranscriptRef.current = finalParts.join(' ');
      setInterimTranscript(interimParts.join(' '));
      const nextDraft = [voiceBaseRef.current, finalTranscriptRef.current].filter(Boolean).join(' ');
      if (nextDraft.length > 0) onDraftChange(nextDraft);
    };
    recognition.onerror = (event) => {
      const message = event.error === 'not-allowed' || event.error === 'service-not-allowed'
        ? '浏览器没有授予麦克风权限，请允许后重试。'
        : event.error === 'network'
          ? '语音识别服务暂时不可用，请检查网络或改用文字输入。'
          : '语音识别没有完成，请重试或改用文字输入。';
      setVoiceError(message);
      setVoiceStatus('error');
      setInterimTranscript('');
      recognitionRef.current = null;
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setVoiceStatus((current) => current === 'error' ? current : 'idle');
      setInterimTranscript('');
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setVoiceStatus('error');
      setVoiceError('语音输入暂时无法启动，请重试或改用文字输入。');
    }
  }, [disabled, draft, offline, onDraftChange, stopListening, submitting]);

  useEffect(() => () => stopListening(), [stopListening]);

  useEffect(() => {
    if (offline && voiceStatus !== 'idle') stopListening();
  }, [offline, stopListening, voiceStatus]);

  const canSend = draft.trim().length > 0 && !submitting && !disabled && !offline;
  const isListening = voiceStatus === 'starting' || voiceStatus === 'listening';
  const voiceUnavailable = voiceSupported === false;

  const switchMode = () => {
    setVoiceError(null);
    setInterimTranscript('');
    if (mode === 'voice') {
      stopListening();
      setMode('text');
      return;
    }
    setMode('voice');
    startListening();
  };

  const submit = () => {
    stopListening();
    setMode('text');
    if (canSend) onSubmit();
  };

  return (
    <form
      className="qitu-composer"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {mode === 'text' ? (
        <textarea
          className="qitu-composer-input"
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          placeholder={offline ? '当前离线，先把想法写下来，重连后再发送。' : '说说你现在的想法…'}
          disabled={disabled}
          rows={2}
          aria-label="输入你的想法"
        />
      ) : (
        <div className="qitu-composer-voice-panel" aria-live="polite">
          <div className={`qitu-composer-voice-orb${isListening ? ' is-listening' : ''}`}>
            <MicIcon active={isListening} />
          </div>
          <div>
            <strong>{isListening ? '正在听你说' : '语音输入已开启'}</strong>
            <p>{interimTranscript || (voiceError ?? '点击麦克风开始，说完后识别结果会出现在输入框。')}</p>
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
          title={mode === 'voice' ? '切换为文字输入' : voiceUnavailable ? '当前浏览器不支持语音识别' : '切换为语音输入'}
        >
          {mode === 'voice' ? <KeyboardIcon /> : <MicIcon />}
          <span>{mode === 'voice' ? '打字' : '语音'}</span>
        </button>

        {mode === 'voice' ? (
          <button
            type="button"
            className={`qitu-composer-voice-button${isListening ? ' is-listening' : ''}`}
            onClick={isListening ? stopListening : startListening}
            disabled={disabled || submitting || offline || voiceUnavailable}
            aria-label={isListening ? '停止语音识别' : '开始语音识别'}
            title={isListening ? '停止语音识别' : '开始语音识别'}
          >
            <MicIcon active={isListening} />
            <span>{isListening ? '停止识别' : '开始说话'}</span>
          </button>
        ) : null}

        <button type="submit" className="qitu-button qitu-button-primary qitu-composer-submit" disabled={!canSend}>
          <SendIcon />
          <span>{submitting ? '发送中…' : offline ? '离线暂存' : '发送'}</span>
        </button>
      </div>

      {offline ? <p className="qitu-composer-hint">网络恢复后可以继续发送。</p> : null}
      {voiceUnavailable ? <p className="qitu-composer-hint">当前浏览器不支持语音识别，请使用文字输入。</p> : null}
      {voiceError && !voiceUnavailable ? <p className="qitu-composer-error" role="alert">{voiceError}</p> : null}
    </form>
  );
}
