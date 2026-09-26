'use client';

import { useState } from 'react';
import { VoiceToggle, type VoiceInputMode } from '../../voice';
import { VoiceHoldButton } from './VoiceHoldButton';

/**
 * Text composer. The draft lives in the parent's in-memory hook and is never
 * persisted. While offline the voice path is disabled and text remains the
 * degraded input; the send button is disabled during submission so a double
 * click cannot fire twice.
 */
export function Composer({
  draft,
  onDraftChange,
  offline,
  submitting,
  disabled,
  onSubmit,
  onAudio,
}: {
  draft: string;
  onDraftChange: (value: string) => void;
  offline: boolean;
  submitting: boolean;
  disabled: boolean;
  onSubmit: () => void;
  onAudio?: (audio: Blob) => void;
}) {
  const [mode, setMode] = useState<VoiceInputMode>('text');
  const canSend = mode === 'text' && draft.trim().length > 0 && !submitting && !disabled;
  return (
    <form
      className="qitu-composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSend) onSubmit();
      }}
    >
      <VoiceToggle
        mode={mode}
        onChange={setMode}
        voiceDisabled={offline || disabled}
        disabledReason={offline ? '断网时语音暂不可用' : undefined}
      />
      {mode === 'text' ? (
        <>
          <textarea
            className="qitu-composer-input"
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            placeholder={offline ? '当前离线，仍可以先把想法写下来，重连后再发送。' : '说说你现在的想法…'}
            disabled={disabled}
            rows={2}
            aria-label="输入你的想法"
          />
          <div className="qitu-composer-actions">
            <button type="submit" className="qitu-button qitu-button-primary" disabled={!canSend}>
              {submitting ? '发送中…' : offline ? '先存着' : '发送'}
            </button>
          </div>
        </>
      ) : (
        <div className="qitu-composer-voice">
          <VoiceHoldButton disabled={disabled || offline} onAudio={onAudio} />
          <p className="qitu-composer-hint">按住说话，松开结束。语音仅在本机处理，不会被保存。</p>
        </div>
      )}
      {offline ? (
        <p className="qitu-composer-hint">断网时语音暂不可用，文字会留在本机，重连后从最后一次序号继续。</p>
      ) : null}
    </form>
  );
}
