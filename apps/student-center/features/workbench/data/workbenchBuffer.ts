import type { WorkbenchBuffer, WorkbenchContent, WorkbenchKind } from '../types/workbench';

const BUFFER_PREFIX = 'qitu.workbench.buffer';
const STASH_PREFIX = 'qitu.workbench.conflict-stash';

function bufferKey(projectId: string, kind: WorkbenchKind): string {
  return `${BUFFER_PREFIX}.${projectId}.${kind}`;
}

function stashKey(projectId: string, kind: WorkbenchKind): string {
  return `${STASH_PREFIX}.${projectId}.${kind}`;
}

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function safeParse<T>(raw: string | null): T | null {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Read the persistent draft buffer. Never throws. */
export function readWorkbenchBuffer<K extends WorkbenchKind>(
  projectId: string,
  kind: K,
): WorkbenchBuffer<K> | null {
  if (!canUseStorage()) return null;
  const parsed = safeParse<WorkbenchBuffer<K>>(window.localStorage.getItem(bufferKey(projectId, kind)));
  if (!parsed || parsed.projectId !== projectId || parsed.kind !== kind) return null;
  return parsed;
}

/**
 * Persist the draft buffer. Content is draft-only; callers must never put a
 * chat transcript into it.
 */
export function writeWorkbenchBuffer<K extends WorkbenchKind>(buffer: WorkbenchBuffer<K>): void {
  if (!canUseStorage()) return;
  window.localStorage.setItem(bufferKey(buffer.projectId, buffer.kind), JSON.stringify(buffer));
}

/** Clear the buffer only after a successful PATCH or an explicit conflict resolution. */
export function clearWorkbenchBuffer(projectId: string, kind: WorkbenchKind): void {
  if (!canUseStorage()) return;
  window.localStorage.removeItem(bufferKey(projectId, kind));
}

/**
 * Single-level stash of the *other* side of a conflict, kept for one session so
 * the student can manually recover it. Never silently dropped.
 */
export function writeConflictStash<K extends WorkbenchKind>(
  projectId: string,
  kind: K,
  content: WorkbenchContent,
): void {
  if (!canUseStorage()) return;
  window.localStorage.setItem(
    stashKey(projectId, kind),
    JSON.stringify({ projectId, kind, content, stashedAt: new Date().toISOString() }),
  );
}

export function readConflictStash<K extends WorkbenchKind>(
  projectId: string,
  kind: K,
): WorkbenchContent | null {
  if (!canUseStorage()) return null;
  const parsed = safeParse<{ content: WorkbenchContent }>(window.localStorage.getItem(stashKey(projectId, kind)));
  return parsed ? parsed.content : null;
}
