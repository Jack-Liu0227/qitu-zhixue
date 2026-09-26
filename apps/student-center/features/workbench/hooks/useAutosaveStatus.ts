'use client';

import { useCallback, useState } from 'react';
import type { AutosaveStatusValue } from '../types/workbench';

export interface AutosaveState {
  status: AutosaveStatusValue;
  /** Server `updatedAt` (UTC ISO8601) from the successful PATCH. */
  savedAt: string | null;
  /** Local time the draft was buffered while offline. */
  bufferedAt: string | null;
}

export interface AutosaveController extends AutosaveState {
  beginSave: () => void;
  markSaved: (savedAt: string) => void;
  markBuffered: (bufferedAt: string) => void;
  markConflict: () => void;
  reset: () => void;
}

const INITIAL: AutosaveState = { status: 'idle', savedAt: null, bufferedAt: null };

/**
 * The five-state autosave machine:
 * idle → saving → saved; saving failure → offline-buffering; saving 409 → conflict.
 */
export function useAutosaveStatus(): AutosaveController {
  const [state, setState] = useState<AutosaveState>(INITIAL);

  const beginSave = useCallback(() => {
    setState((prev) => ({ ...prev, status: 'saving' }));
  }, []);
  const markSaved = useCallback((savedAt: string) => {
    setState({ status: 'saved', savedAt, bufferedAt: null });
  }, []);
  const markBuffered = useCallback((bufferedAt: string) => {
    setState((prev) => ({ ...prev, status: 'offline-buffering', bufferedAt }));
  }, []);
  const markConflict = useCallback(() => {
    setState((prev) => ({ ...prev, status: 'conflict' }));
  }, []);
  const reset = useCallback(() => setState(INITIAL), []);

  return { ...state, beginSave, markSaved, markBuffered, markConflict, reset };
}

/** Format a server timestamp as local HH:mm for 「已自动保存 10:24」. */
export function formatHhMm(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}
