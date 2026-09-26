'use client';

export type VoiceInputMode = 'text' | 'voice';

export interface VoiceToggleProps {
  mode: VoiceInputMode;
  onChange: (mode: VoiceInputMode) => void;
  /** True when the microphone must stay disabled (denied/unsupported/offline). */
  voiceDisabled?: boolean;
  disabledReason?: string;
}

/** Text/voice switch for the AI搭档 composer. Pure client UI preference. */
export function VoiceToggle({ mode, onChange, voiceDisabled = false, disabledReason }: VoiceToggleProps) {
  return (
    <div className="qitu-voice-toggle" role="group" aria-label="输入方式">
      <button
        type="button"
        className={mode === 'text' ? 'qitu-button is-active' : 'qitu-button'}
        aria-pressed={mode === 'text'}
        onClick={() => onChange('text')}
      >
        文字
      </button>
      <button
        type="button"
        className={mode === 'voice' ? 'qitu-button is-active' : 'qitu-button'}
        aria-pressed={mode === 'voice'}
        disabled={voiceDisabled}
        onClick={() => onChange('voice')}
      >
        语音
      </button>
      {voiceDisabled && disabledReason ? (
        <span className="qitu-voice-toggle-reason">{disabledReason}</span>
      ) : null}
    </div>
  );
}
