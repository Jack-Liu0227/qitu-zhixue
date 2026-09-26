'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clearWorkbenchBuffer,
  readWorkbenchBuffer,
  writeConflictStash,
  writeWorkbenchBuffer,
} from '../data/workbenchBuffer';
import type { WorkbenchDataSource } from '../data/workbenchDataSource';
import {
  WorkbenchConflictError,
  mergeFlowContents,
  type AutosaveStatusValue,
  type ConflictChoice,
  type WorkbenchConflict,
  type WorkbenchContent,
  type WorkbenchDraft,
  type WorkbenchKind,
} from '../types/workbench';

export const AUTOSAVE_DEBOUNCE_MS = 1500;

const KINDS: readonly WorkbenchKind[] = ['flow', 'code', 'sim', 'test'];

interface KindState {
  draft: WorkbenchDraft | null;
  content: WorkbenchContent | null;
  dirty: boolean;
  status: AutosaveStatusValue;
  savedAt: string | null;
  bufferedAt: string | null;
  loading: boolean;
  error: string | null;
  permissionDenied: boolean;
  conflict: WorkbenchConflict | null;
}

function freshKindState(): KindState {
  return {
    draft: null,
    content: null,
    dirty: false,
    status: 'idle',
    savedAt: null,
    bufferedAt: null,
    loading: false,
    error: null,
    permissionDenied: false,
    conflict: null,
  };
}

function emptyStateMap(): Record<WorkbenchKind, KindState> {
  return { flow: freshKindState(), code: freshKindState(), sim: freshKindState(), test: freshKindState() };
}

function emptyTimerMap(): Partial<Record<WorkbenchKind, ReturnType<typeof setTimeout> | null>> {
  return { flow: null, code: null, sim: null, test: null };
}

function isForbidden(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message;
  return message.includes('FORBIDDEN') || message.includes('UNAUTHORIZED') || message.includes('403') || message.includes('401');
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'UNKNOWN_ERROR';
}

export interface WorkbenchDraftController {
  activeKind: WorkbenchKind;
  setActiveKind: (kind: WorkbenchKind) => void;
  content: WorkbenchContent | null;
  revision: number;
  dirty: boolean;
  status: AutosaveStatusValue;
  savedAt: string | null;
  bufferedAt: string | null;
  loading: boolean;
  error: string | null;
  permissionDenied: boolean;
  conflict: WorkbenchConflict | null;
  updateContent: (next: WorkbenchContent) => void;
  /** Force an immediate save (「保存成果」flushes first). Returns the revision to use next. */
  flush: () => Promise<number>;
  reload: () => void;
  resolveConflict: (choice: ConflictChoice) => Promise<void>;
}

/**
 * Owns the workbench draft state machine: load, per-kind buffers, debounced
 * autosave with `If-Match`, the 409 three-way recovery, and offline reconcile.
 */
export function useWorkbenchDraft(args: {
  projectId: string;
  dataSource: WorkbenchDataSource;
  initialDraft: WorkbenchDraft;
  online: boolean;
}): WorkbenchDraftController {
  const { projectId, dataSource, initialDraft, online } = args;

  const [states, setStates] = useState<Record<WorkbenchKind, KindState>>(() => {
    const map = emptyStateMap();
    map[initialDraft.kind] = {
      ...freshKindState(),
      draft: initialDraft,
      content: initialDraft.content,
      status: 'idle',
    };
    return map;
  });
  const [activeKind, setActiveKind] = useState<WorkbenchKind>(initialDraft.kind);

  const statesRef = useRef(states);
  const onlineRef = useRef(online);
  const activeKindRef = useRef(activeKind);
  const loadedRef = useRef<Set<WorkbenchKind>>(new Set([initialDraft.kind]));
  const timersRef = useRef<Partial<Record<WorkbenchKind, ReturnType<typeof setTimeout> | null>>>(emptyTimerMap());

  useEffect(() => {
    statesRef.current = states;
  }, [states]);
  useEffect(() => {
    onlineRef.current = online;
  }, [online]);
  useEffect(() => {
    activeKindRef.current = activeKind;
  }, [activeKind]);

  const setKindState = useCallback(
    (kind: WorkbenchKind, patch: (prev: KindState) => Partial<KindState>) => {
      setStates((prev) => ({ ...prev, [kind]: { ...prev[kind], ...patch(prev[kind]) } }));
    },
    [],
  );

  // Per-kind debounce timers: each kind's autosave is isolated so switching
  // kinds within the debounce window cannot cancel the other's pending save.
  const clearTimer = useCallback((kind: WorkbenchKind) => {
    const timer = timersRef.current[kind];
    if (timer) clearTimeout(timer);
    timersRef.current[kind] = null;
  }, []);

  const bufferDraft = useCallback(
    (kind: WorkbenchKind, content: WorkbenchContent, baseRevision: number, dirty: boolean) => {
      const bufferedAt = new Date().toISOString();
      writeWorkbenchBuffer({ projectId, kind, baseRevision, content, dirty, savedAt: bufferedAt });
      return bufferedAt;
    },
    [projectId],
  );

  const save = useCallback(
    async (kind: WorkbenchKind, content: WorkbenchContent, baseRevision: number): Promise<number> => {
      if (!onlineRef.current) {
        const bufferedAt = bufferDraft(kind, content, baseRevision, true);
        setKindState(kind, () => ({ status: 'offline-buffering', dirty: true, bufferedAt }));
        return baseRevision;
      }
      setKindState(kind, () => ({ status: 'saving', error: null }));
      try {
        const updated = await dataSource.patchDraft(projectId, kind, baseRevision, content);
        clearWorkbenchBuffer(projectId, kind);
        setKindState(kind, () => ({
          draft: updated,
          content: updated.content,
          dirty: false,
          status: 'saved',
          savedAt: updated.updatedAt,
          bufferedAt: null,
          conflict: null,
        }));
        return updated.revision;
      } catch (error) {
        if (error instanceof WorkbenchConflictError) {
          const details = error.details;
          setKindState(kind, () => ({
            status: 'conflict',
            conflict: {
              kind,
              localContent: content,
              serverRevision: details.currentRevision,
              serverContent: details.content as WorkbenchContent,
              serverUpdatedAt: null,
              details,
            },
          }));
          return baseRevision;
        }
        const bufferedAt = bufferDraft(kind, content, baseRevision, true);
        setKindState(kind, () => ({ status: 'offline-buffering', dirty: true, bufferedAt }));
        return baseRevision;
      }
    },
    [bufferDraft, dataSource, projectId, setKindState],
  );

  const reconcile = useCallback(
    async (kind: WorkbenchKind) => {
      const state = statesRef.current[kind];
      const buffer = readWorkbenchBuffer(projectId, kind);
      const content = buffer?.content ?? state.content;
      if (!content) return;
      const baseRevision = buffer?.baseRevision ?? state.draft?.revision ?? 0;
      try {
        const server = await dataSource.getDraft(projectId, kind);
        if (server.revision === baseRevision) {
          await save(kind, content, baseRevision);
        } else {
          setKindState(kind, () => ({
            status: 'conflict',
            conflict: {
              kind,
              localContent: content,
              serverRevision: server.revision,
              serverContent: server.content,
              serverUpdatedAt: server.updatedAt,
              details: { currentRevision: server.revision, content: server.content },
            },
          }));
        }
      } catch {
        const bufferedAt = bufferDraft(kind, content, baseRevision, true);
        setKindState(kind, () => ({ status: 'offline-buffering', dirty: true, bufferedAt }));
      }
    },
    [bufferDraft, dataSource, projectId, save, setKindState],
  );

  const loadKind = useCallback(
    async (kind: WorkbenchKind) => {
      setKindState(kind, () => ({ loading: true, error: null, permissionDenied: false }));
      const buffer = readWorkbenchBuffer(projectId, kind);
      if (!onlineRef.current && buffer) {
        setKindState(kind, () => ({
          draft: { projectId, kind, revision: buffer.baseRevision, content: buffer.content, updatedAt: buffer.savedAt },
          content: buffer.content,
          dirty: buffer.dirty,
          status: 'offline-buffering',
          bufferedAt: buffer.savedAt,
          loading: false,
        }));
        return;
      }
      try {
        const draft = await dataSource.getDraft(projectId, kind);
        if (buffer && buffer.dirty) {
          setKindState(kind, () => ({
            draft,
            content: buffer.content,
            dirty: true,
            status: onlineRef.current ? 'saving' : 'offline-buffering',
            bufferedAt: buffer.savedAt,
            loading: false,
          }));
          if (onlineRef.current) void reconcile(kind);
          return;
        }
        setKindState(kind, () => ({
          draft,
          content: draft.content,
          dirty: false,
          status: 'idle',
          savedAt: null,
          bufferedAt: null,
          loading: false,
          error: null,
          conflict: null,
          permissionDenied: false,
        }));
      } catch (error) {
        if (isForbidden(error)) {
          setKindState(kind, () => ({ loading: false, permissionDenied: true }));
        } else {
          setKindState(kind, () => ({ loading: false, error: messageOf(error) }));
        }
      }
    },
    [dataSource, projectId, reconcile, setKindState],
  );

  // Lazy-load a kind the first time it becomes active.
  useEffect(() => {
    if (!loadedRef.current.has(activeKind)) {
      loadedRef.current.add(activeKind);
      void loadKind(activeKind);
    }
  }, [activeKind, loadKind]);

  // The route seeds the initial kind from a server-side read model, and
  // `loadedRef` is pre-seeded so that kind is never refetched. But a buffered
  // offline edit must still win on mount — otherwise the user's unsaved work
  // is silently replaced (spec §5「绝不丢草稿」).
  useEffect(() => {
    const kind = initialDraft.kind;
    const buffer = readWorkbenchBuffer(projectId, kind);
    if (!buffer || !buffer.dirty) return;
    setKindState(kind, () => ({
      draft: { projectId, kind, revision: buffer.baseRevision, content: buffer.content, updatedAt: buffer.savedAt },
      content: buffer.content,
      dirty: true,
      status: onlineRef.current ? 'saving' : 'offline-buffering',
      bufferedAt: buffer.savedAt,
      loading: false,
    }));
    if (onlineRef.current) void reconcile(kind);
  }, [projectId, initialDraft.kind, reconcile, setKindState]);

  const scheduleSave = useCallback(
    (kind: WorkbenchKind) => {
      clearTimer(kind);
      timersRef.current[kind] = setTimeout(() => {
        timersRef.current[kind] = null;
        const state = statesRef.current[kind];
        if (!state.content) return;
        void save(kind, state.content, state.draft?.revision ?? 0);
      }, AUTOSAVE_DEBOUNCE_MS);
    },
    [clearTimer, save],
  );

  const updateContent = useCallback(
    (next: WorkbenchContent) => {
      const kind = activeKindRef.current;
      setKindState(kind, () => ({ content: next, dirty: true, status: 'saving' }));
      scheduleSave(kind);
    },
    [scheduleSave, setKindState],
  );

  // Connectivity transitions: on offline, freeze + persist; on reconnect, reconcile.
  useEffect(() => {
    if (!online) {
      for (const kind of KINDS) clearTimer(kind);
      for (const kind of KINDS) {
        const state = statesRef.current[kind];
        if (state.dirty && state.content) {
          const bufferedAt = bufferDraft(kind, state.content, state.draft?.revision ?? 0, true);
          setKindState(kind, () => ({ status: 'offline-buffering', bufferedAt }));
        }
      }
      return;
    }
    for (const kind of KINDS) {
      const state = statesRef.current[kind];
      if (state.dirty) void reconcile(kind);
    }
  }, [online, bufferDraft, reconcile, setKindState, clearTimer]);

  // Flush synchronously to the localStorage buffer on unload/hide. An awaited
  // network save cannot survive page unload, so we persist the buffered copy
  // instead; the next mount's loadKind reconciles it (revision match → save,
  // mismatch → conflict).
  useEffect(() => {
    const flushDirtyKinds = () => {
      for (const kind of KINDS) {
        const state = statesRef.current[kind];
        if (state.dirty && state.content) {
          bufferDraft(kind, state.content, state.draft?.revision ?? 0, true);
          clearTimer(kind);
        }
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushDirtyKinds();
    };
    window.addEventListener('pagehide', flushDirtyKinds);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', flushDirtyKinds);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [bufferDraft, clearTimer]);

  const flush = useCallback(async (): Promise<number> => {
    const kind = activeKindRef.current;
    const state = statesRef.current[kind];
    if (!state.content) return state.draft?.revision ?? 0;
    clearTimer(kind);
    return save(kind, state.content, state.draft?.revision ?? 0);
  }, [clearTimer, save]);

  const reload = useCallback(() => {
    loadedRef.current.delete(activeKindRef.current);
    void loadKind(activeKindRef.current);
  }, [loadKind]);

  const resolveConflict = useCallback(
    async (choice: ConflictChoice) => {
      const kind = activeKindRef.current;
      const state = statesRef.current[kind];
      const conflict = state.conflict;
      if (!conflict) return;
      const localContent = state.content ?? conflict.localContent;

      if (choice === 'use-server') {
        writeConflictStash(projectId, kind, localContent);
        clearWorkbenchBuffer(projectId, kind);
        setKindState(kind, () => ({
          draft: { projectId, kind, revision: conflict.serverRevision, content: conflict.serverContent, updatedAt: conflict.serverUpdatedAt ?? new Date().toISOString() },
          content: conflict.serverContent,
          dirty: false,
          status: 'idle',
          savedAt: null,
          bufferedAt: null,
          conflict: null,
        }));
        return;
      }

      const merged =
        choice === 'merge' && kind === 'flow' && 'nodes' in localContent && 'nodes' in conflict.serverContent
          ? mergeFlowContents(localContent, conflict.serverContent)
          : localContent;

      setKindState(kind, () => ({ status: 'saving' }));
      try {
        const updated = await dataSource.patchDraft(projectId, kind, conflict.serverRevision, merged);
        writeConflictStash(projectId, kind, conflict.serverContent);
        clearWorkbenchBuffer(projectId, kind);
        setKindState(kind, () => ({
          draft: updated,
          content: updated.content,
          dirty: false,
          status: 'saved',
          savedAt: updated.updatedAt,
          bufferedAt: null,
          conflict: null,
        }));
      } catch (error) {
        if (error instanceof WorkbenchConflictError) {
          const details = error.details;
          setKindState(kind, () => ({
            status: 'conflict',
            conflict: {
              kind,
              localContent: merged,
              serverRevision: details.currentRevision,
              serverContent: details.content as WorkbenchContent,
              serverUpdatedAt: null,
              details,
            },
          }));
          return;
        }
        const bufferedAt = bufferDraft(kind, merged, conflict.serverRevision, true);
        setKindState(kind, () => ({ status: 'offline-buffering', dirty: true, bufferedAt }));
      }
    },
    [bufferDraft, dataSource, projectId, setKindState],
  );

  const current = states[activeKind];

  return {
    activeKind,
    setActiveKind,
    content: current.content,
    revision: current.draft?.revision ?? 0,
    dirty: current.dirty,
    status: current.status,
    savedAt: current.savedAt,
    bufferedAt: current.bufferedAt,
    loading: current.loading,
    error: current.error,
    permissionDenied: current.permissionDenied,
    conflict: current.conflict,
    updateContent,
    flush,
    reload,
    resolveConflict,
  };
}
