'use client';

import { AdminApiError, AdminOfflineError, AdminPermissionError } from '../../lib/api/types';

/**
 * 写操作 / 加载失败的可见错误面板。
 *
 * 设计原则（评审硬要求）：
 * - 服务端校验失败（空 PATCH、`leaderAssistantId` 不在成员里、
 *   `theoryMasteredGate=false` 等）必须原样显示**错误码 + 提示 + 字段级错误**，
 *   不允许吞掉或替换成笼统文案。
 * - 403 一律按服务端结果渲染（前端不做对象级权限的最终判断）。
 * - 断网与后端业务失败分开呈现。
 */
export function describeAdminError(error: unknown): {
  kind: 'offline' | 'permission' | 'server' | 'unknown';
  title: string;
  message: string;
} {
  if (error instanceof AdminOfflineError) {
    return { kind: 'offline', title: '网络不可用', message: error.message };
  }
  if (error instanceof AdminPermissionError) {
    return { kind: 'permission', title: '权限不足（服务端判定）', message: error.message };
  }
  if (error instanceof AdminApiError) {
    return {
      kind: 'server',
      title: `服务端校验失败（HTTP ${error.status}）`,
      message: error.message,
    };
  }
  return {
    kind: 'unknown',
    title: '操作失败',
    message: error instanceof Error ? error.message : '发生了未知错误，请稍后重试',
  };
}

export interface WriteErrorPanelProps {
  error: unknown;
  /** 提供时在面板内给出可见的重试入口（重试用同一幂等键，见页面层）。 */
  onRetry?: () => void;
}

export function WriteErrorPanel({ error, onRetry }: WriteErrorPanelProps) {
  if (error === null || error === undefined) return null;

  const described = describeAdminError(error);
  const serverError = error instanceof AdminApiError ? error : null;
  const permissionError = error instanceof AdminPermissionError;

  return (
    <div
      role="alert"
      className="settings-write-error-panel"
      style={{
        border: `1px solid ${permissionError ? '#f59e0b' : '#fca5a5'}`,
        background: permissionError ? '#fffbeb' : '#fef2f2',
        borderRadius: 10,
        padding: '10px 14px',
        margin: '10px 0',
        fontSize: 13,
        color: '#7f1d1d',
        lineHeight: 1.6,
      }}
    >
      <strong style={{ display: 'block', marginBottom: 2 }}>{described.title}</strong>
      <span>{described.message}</span>
      {serverError !== null && (
        <>
          <div style={{ marginTop: 6 }}>
            错误码：<code style={{ fontFamily: 'monospace', fontWeight: 700 }}>{serverError.code}</code>
          </div>
          {serverError.fieldErrors.length > 0 && (
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {serverError.fieldErrors.map((fieldError, index) => (
                <li key={`${fieldError.path ?? 'field'}-${index}`}>
                  {fieldError.path ? <code>{fieldError.path}</code> : null}
                  {fieldError.path ? '：' : ''}
                  {fieldError.message}
                </li>
              ))}
            </ul>
          )}
          {serverError.traceId !== null && (
            <div style={{ marginTop: 4, color: '#9b2c2c', fontSize: 12 }}>
              追踪 id（报障时请提供）：<code>{serverError.traceId}</code>
            </div>
          )}
        </>
      )}
      {onRetry !== undefined && (
        <div style={{ marginTop: 8 }}>
          <button type="button" className="settings-pill-btn" onClick={onRetry}>
            重试
          </button>
        </div>
      )}
    </div>
  );
}
