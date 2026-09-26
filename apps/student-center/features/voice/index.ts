// Voice / Live interaction — cross-cutting capability (no route, no nav item).
// Mounted inside 灵感空间 and AI搭档. See handoff for host requirements.

export { VoiceProvider, useVoice, useOptionalVoice } from './voice-context';
export type { VoiceProviderProps } from './voice-context';

export { useVoiceSession } from './hooks/useVoiceSession';
export type {
  MicrophonePermission,
  UseVoiceSessionOptions,
  VoiceConnectionStatus,
  VoiceSessionApi,
} from './hooks/useVoiceSession';

export { VoiceLivePanel } from './components/VoiceLivePanel';
export type { VoiceLivePanelProps } from './components/VoiceLivePanel';

export { VoiceHoldButton } from './components/VoiceHoldButton';
export type {
  VoiceChunk,
  VoiceHoldButtonProps,
  VoiceHoldEndInfo,
  VoiceHoldPhase,
} from './components/VoiceHoldButton';

export { VoiceTranscript } from './components/VoiceTranscript';
export type { VoiceTranscriptProps } from './components/VoiceTranscript';

export { VoiceStateIndicator } from './components/VoiceStateIndicator';
export type { VoiceStateIndicatorProps } from './components/VoiceStateIndicator';

export { VoiceToggle } from './components/VoiceToggle';
export type { VoiceInputMode, VoiceToggleProps } from './components/VoiceToggle';

export { SafetyBlockNotice } from './components/SafetyBlockNotice';
export type { SafetyBlockNoticeProps } from './components/SafetyBlockNotice';

export { EscalationNotice, ESCALATION_STUDENT_MESSAGE } from './components/EscalationNotice';
export type { EscalationNoticeProps } from './components/EscalationNotice';

export { applyServerEvent, createInitialVoiceState } from './realtime/reducer';
export type {
  VoiceIntentCandidate,
  VoiceSessionState,
  VoiceTranscriptMessage,
} from './realtime/reducer';

export {
  buildAudioChunk,
  buildAudioEnd,
  buildPing,
  buildStallSignal,
  buildSubscribe,
  buildTurnCancel,
  buildTurnStart,
} from './realtime/events';
export type {
  AudioChunkParams,
  AudioEndParams,
  StallSignalParams,
  TurnCancelParams,
  TurnStartParams,
} from './realtime/events';

export { VoiceSessionError, resetVoiceDataSourceMock, voiceDataSource } from './data';
export type {
  VoiceDataSource,
  VoiceSessionBootstrap,
  VoiceSessionErrorCode,
  VoiceSessionRequest,
  VoiceTextTurnAccepted,
  VoiceTextTurnRequest,
  VoiceTransport,
  VoiceTransportStatus,
} from './data';
