'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  EmptyState,
  ErrorState,
  OfflineBanner,
  PermissionDenied,
  SectionCard,
  SkeletonBlock,
} from '@qitu/ui';
import { useVoice } from '../voice-context';
import type { VoiceHoldEndInfo } from './VoiceHoldButton';
import { EscalationNotice } from './EscalationNotice';
import { SafetyBlockNotice } from './SafetyBlockNotice';
import { VoiceHoldButton } from './VoiceHoldButton';
import { VoiceStateIndicator } from './VoiceStateIndicator';
import { VoiceToggle, type VoiceInputMode } from './VoiceToggle';
import { VoiceTranscript } from './VoiceTranscript';

export interface VoiceLivePanelProps {
  emptyTitle?: string;
  emptyDescription?: string;
  placeholder?: string;
  /** Called by the permission-denied fallback; host decides where to go. */
  onExit?: () => void;
  showVoiceToggle?: boolean;
}

/**
 * Host-agnostic voice surface for 灵感空间 and AI搭档.
 *
 * Covers the five shared states (loading / empty / error / offline /
 * permission-denied) plus the audio-permission-denied variant, and keeps a real
 * text fallback usable whenever voice fails.
 */
export function VoiceLivePanel({
  emptyTitle = '还没有开始对话',
  emptyDescription = '说说你现在在想什么，我会一步步陪你把它变成一个小项目。',
  placeholder = '也可以用文字说说你的想法…',
  onExit,
  showVoiceToggle = true,
}: VoiceLivePanelProps) {
  const voice = useVoice();
  const { status, error, state, microphone, textFallback, submitting } = voice;

  const [mode, setMode] = useState<VoiceInputMode>('voice');
  const [draft, setDraft] = useState('');
  const [listening, setListening] = useState(false);
  const activeTurnRef = useRef<string | null>(null);

  // Degradation ladder: never leave the student on a dead voice path.
  useEffect(() => {
    if (textFallback || microphone === 'denied' || microphone === 'unsupported') {
      setMode('text');
    }
  }, [textFallback, microphone]);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const text = draft.trim();
      if (text.length === 0) return;
      // Clear immediately; sendText keeps one idempotency key per submission and
      // is disabled while in flight, so a double click cannot create two turns.
      setDraft('');
      await voice.sendText(text);
    },
    [draft, voice],
  );

  const handleVoiceStart = useCallback(() => {
    const turnId = voice.beginVoiceTurn();
    activeTurnRef.current = turnId;
    setListening(turnId !== null);
  }, [voice]);

  const handleVoiceEnd = useCallback(
    async (info: VoiceHoldEndInfo) => {
      const turnId = activeTurnRef.current;
      activeTurnRef.current = null;
      setListening(false);
      if (turnId) voice.endVoiceTurn(turnId, info.durationMs, info.voiceActivityMs);
    },
    [voice],
  );

  const handleVoiceCancel = useCallback(() => {
    const turnId = activeTurnRef.current;
    activeTurnRef.current = null;
    setListening(false);
    if (turnId) voice.cancelTurn(turnId);
  }, [voice]);

  if (status === 'forbidden') {
    return (
      <PermissionDenied
        title="没有访问语音会话的权限"
        description="你暂时不能使用这个语音会话，请返回后重试。"
        onBack={onExit}
      />
    );
  }

  if (status === 'idle' || status === 'loading') {
    return (
      <SectionCard title="语音对话">
        <SkeletonBlock lines={4} />
      </SectionCard>
    );
  }

  const lastStudentTurnId = [...state.messages]
    .reverse()
    .find((message) => message.role === 'student')?.turnId;

  const voiceOk = microphone === 'granted';
  const isEmpty = state.messages.length === 0;

  return (
    <SectionCard title="语音对话">
      <VoiceStateIndicator
        connection={voice.connection}
        microphone={microphone}
        listening={listening}
        speaking={state.speakingTurnId !== null}
      />

      {textFallback ? (
        <OfflineBanner readOnly={false} onRetry={voice.reconnect} />
      ) : null}

      {state.safetyBlock ? (
        <SafetyBlockNotice
          code={state.safetyBlock.code}
          message={state.safetyBlock.message}
          onDismiss={voice.clearSafetyBlock}
        />
      ) : null}

      <EscalationNotice visible={state.escalatedTurnIds.length > 0} />

      {error ? (
        <ErrorState
          title="语音服务暂时不可用"
          description={`${error.message}——你可以继续用文字输入。`}
          errorCode={error.code}
          onRetry={voice.retry}
        />
      ) : null}

      {isEmpty ? (
        <EmptyState
          title={emptyTitle}
          description={emptyDescription}
          action={
            <span className="qitu-voice-empty-hint">按住下方按钮说话，或直接输入文字</span>
          }
        />
      ) : (
        <VoiceTranscript messages={state.messages} />
      )}

      {showVoiceToggle ? (
        <VoiceToggle
          mode={mode}
          onChange={setMode}
          voiceDisabled={!voiceOk || textFallback}
          disabledReason={
            textFallback
              ? '网络恢复后可使用语音'
              : microphone === 'denied' || microphone === 'unsupported'
                ? '需要麦克风权限'
                : undefined
          }
        />
      ) : null}

      {mode === 'voice' ? (
        voiceOk ? (
          <VoiceHoldButton
            permission={microphone}
            disabled={textFallback}
            onStart={handleVoiceStart}
            onEnd={handleVoiceEnd}
            onCancel={handleVoiceCancel}
          />
        ) : (
          <div className="qitu-voice-mic-gate">
            <p className="qitu-voice-mic-hint">
              {microphone === 'unsupported'
                ? '当前设备不支持麦克风，请用文字继续。'
                : '需要麦克风权限才能语音对话，你也可以直接用文字。'}
            </p>
            {microphone !== 'unsupported' ? (
              <button
                type="button"
                className="qitu-button qitu-button-primary"
                onClick={() => {
                  void voice.requestMicrophone();
                }}
              >
                开启麦克风
              </button>
            ) : null}
          </div>
        )
      ) : null}

      <form className="qitu-voice-composer" onSubmit={handleSubmit}>
        <label className="qitu-voice-composer-label" htmlFor="qitu-voice-draft">
          文字输入
        </label>
        <textarea
          id="qitu-voice-draft"
          className="qitu-voice-composer-input"
          value={draft}
          placeholder={placeholder}
          rows={2}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div className="qitu-voice-composer-actions">
          <button
            type="submit"
            className="qitu-button qitu-button-primary"
            disabled={submitting || draft.trim().length === 0}
          >
            {submitting ? '发送中…' : '发送'}
          </button>
          <button
            type="button"
            className="qitu-button qitu-button-ghost"
            disabled={!lastStudentTurnId}
            onClick={() => {
              if (lastStudentTurnId) voice.signalStall(lastStudentTurnId);
            }}
          >
            我卡住了
          </button>
        </div>
      </form>
    </SectionCard>
  );
}
