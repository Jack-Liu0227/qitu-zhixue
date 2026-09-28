import type { TutorHintLevel, TutorProjectContext as SharedTutorProjectContext } from '@qitu/contracts';

export type TutorCurrentTask = SharedTutorProjectContext['currentTask'];

/**
 * Left-column project context. This is the shared server projection; it is not
 * a second client-owned project model.
 */
export type TutorProjectContext = SharedTutorProjectContext;

export type TutorConnectionStatus = 'idle' | 'connecting' | 'open' | 'offline' | 'closed';

export type TutorLoadStatus = 'loading' | 'ready' | 'empty' | 'error';

export interface TutorViewError {
  message: string;
  /** HTTP status when known (403 → permission denied, 0/undefined → transport/offline). */
  status?: number;
  code?: string;
}

export interface TutorEscalationState {
  escalated: boolean;
  stallCount: number;
  lastHintLevel: TutorHintLevel | null;
}
