'use client';

import { createContext, useContext, type ReactNode } from 'react';
import {
  useVoiceSession,
  type UseVoiceSessionOptions,
  type VoiceSessionApi,
} from './hooks/useVoiceSession';

const VoiceContext = createContext<VoiceSessionApi | null>(null);

export interface VoiceProviderProps extends UseVoiceSessionOptions {
  children: ReactNode;
}

/**
 * Hosts share one voice session across the transcript, hold button and toggles:
 *
 *   <VoiceProvider sessionId={sessionId}><VoiceLivePanel /></VoiceProvider>
 */
export function VoiceProvider({ children, ...options }: VoiceProviderProps) {
  const api = useVoiceSession(options);
  return <VoiceContext.Provider value={api}>{children}</VoiceContext.Provider>;
}

export function useVoice(): VoiceSessionApi {
  const context = useContext(VoiceContext);
  if (!context) {
    throw new Error('useVoice must be used inside <VoiceProvider>');
  }
  return context;
}

/** Non-throwing variant for optional mounts. */
export function useOptionalVoice(): VoiceSessionApi | null {
  return useContext(VoiceContext);
}
