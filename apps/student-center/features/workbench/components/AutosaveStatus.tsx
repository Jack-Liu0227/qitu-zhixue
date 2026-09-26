'use client';

import { formatHhMm } from '../hooks/useAutosaveStatus';
import type { AutosaveStatusValue } from '../types/workbench';

export interface AutosaveStatusProps {
  status: AutosaveStatusValue;
  /** Server `updatedAt` from the last successful PATCH. */
  savedAt: string | null;
  /** Local time the draft was buffered while offline. */
  bufferedAt?: string | null;
  onRetry?: () => void;
}

/** Renders the autosave five-state indicator from real state, never a constant. */
export function AutosaveStatus({ status, savedAt, bufferedAt, onRetry }: AutosaveStatusProps) {
  if (status === 'saving') {
    return <span className="qitu-autosave is-saving">正在保存…</span>;
  }
  if (status === 'saved') {
    const time = formatHhMm(savedAt);
    return <span className="qitu-autosave is-saved">{time ? `已自动保存 ${time}` : '已自动保存'}</span>;
  }
  if (status === 'offline-buffering') {
    const time = formatHhMm(bufferedAt ?? null);
    return (
      <span className="qitu-autosave is-offline">
        {time ? `离线中 · 已缓存到本机 ${time}` : '离线中 · 草稿已缓存到本机'}
      </span>
    );
  }
  if (status === 'conflict') {
    return (
      <span className="qitu-autosave is-conflict">
        检测到冲突，待处理
        {onRetry ? (
          <button type="button" className="qitu-button qitu-button-ghost" onClick={onRetry}>
            查看
          </button>
        ) : null}
      </span>
    );
  }
  return <span className="qitu-autosave is-idle">暂无保存</span>;
}
