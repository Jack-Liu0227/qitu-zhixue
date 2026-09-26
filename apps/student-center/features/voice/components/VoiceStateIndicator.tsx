'use client';

import type { CSSProperties } from 'react';
import { colors } from '@qitu/design-tokens';
import type { MicrophonePermission } from '../hooks/useVoiceSession';

export interface VoiceStateIndicatorProps {
  connection: 'online' | 'reconnecting' | 'offline';
  microphone: MicrophonePermission;
  /** Local VAD: currently capturing speech. */
  listening?: boolean;
  /** TTS audio is playing (audio payload is never stored). */
  speaking?: boolean;
}

function microphoneLabel(permission: MicrophonePermission): string {
  switch (permission) {
    case 'granted':
      return '麦克风已就绪';
    case 'denied':
      return '麦克风未授权';
    case 'unsupported':
      return '当前设备不支持麦克风';
    default:
      return '未检测麦克风';
  }
}

export function VoiceStateIndicator({
  connection,
  microphone,
  listening = false,
  speaking = false,
}: VoiceStateIndicatorProps) {
  const label = listening
    ? '正在聆听…'
    : speaking
      ? 'AI 正在说话…'
      : connection === 'online'
        ? '语音已连接'
        : connection === 'reconnecting'
          ? '正在重新连接…'
          : '网络断开，已切换为文字';

  const tone =
    listening || speaking
      ? colors.primary
      : connection === 'online'
        ? colors.completed
        : connection === 'reconnecting'
          ? colors.attention
          : colors.muted;

  const dotStyle: CSSProperties = { backgroundColor: tone };

  return (
    <div className="qitu-voice-state" role="status" aria-live="polite">
      <span className="qitu-voice-state-dot" style={dotStyle} aria-hidden="true" />
      <span className="qitu-voice-state-label">{label}</span>
      <span className="qitu-voice-state-mic">{microphoneLabel(microphone)}</span>
    </div>
  );
}
