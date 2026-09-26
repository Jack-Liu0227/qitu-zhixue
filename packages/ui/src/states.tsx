import type { CSSProperties, ReactNode } from 'react';

export function EmptyState({
  title,
  description,
  illustration,
  action,
}: {
  title: string;
  description?: string;
  illustration?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="qitu-state qitu-empty-state">
      {illustration ? <div className="qitu-state-illustration">{illustration}</div> : null}
      <h3 className="qitu-state-title">{title}</h3>
      {description ? <p className="qitu-state-description">{description}</p> : null}
      {action ? <div className="qitu-state-action">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = '出错了',
  description,
  errorCode,
  onRetry,
  retrying = false,
}: {
  title?: string;
  description?: string;
  errorCode?: string;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  return (
    <div className="qitu-state qitu-error-state" role="alert">
      <h3 className="qitu-state-title">{title}</h3>
      {description ? <p className="qitu-state-description">{description}</p> : null}
      {errorCode ? <code className="qitu-error-code">{errorCode}</code> : null}
      {onRetry ? (
        <button type="button" className="qitu-button qitu-button-primary" onClick={onRetry} disabled={retrying}>
          {retrying ? '重试中…' : '重试'}
        </button>
      ) : null}
    </div>
  );
}

/**
 * 离线横幅：明确告知用户当前编辑不会被保存到服务端，
 * 而是暂存在本机，待网络恢复后再自动同步。
 */
export function OfflineBanner({
  readOnly,
  bufferedCount,
  onRetry,
}: {
  readOnly: boolean;
  bufferedCount?: number;
  onRetry?: () => void;
}) {
  const countText =
    bufferedCount !== undefined && bufferedCount > 0 ? `（${bufferedCount} 项待同步）` : '';
  return (
    <div className="qitu-offline-banner" role="status">
      <span className="qitu-offline-dot" aria-hidden="true" />
      <span className="qitu-offline-text">
        {readOnly
          ? `当前处于离线状态，编辑不会被保存，已暂存在本机${countText}。`
          : `当前处于离线状态，部分操作已暂存在本机${countText}。`}
        网络恢复后将自动同步。
      </span>
      {onRetry ? (
        <button type="button" className="qitu-button qitu-button-ghost" onClick={onRetry}>
          重试连接
        </button>
      ) : null}
    </div>
  );
}

export function SkeletonBlock({
  lines = 3,
  height = 16,
  width = '100%',
}: {
  lines?: number;
  height?: number;
  width?: string | number;
}) {
  const lineStyle = { width, height } as CSSProperties;
  return (
    <div className="qitu-skeleton" aria-hidden="true">
      {Array.from({ length: lines }).map((_, index) => (
        <div key={index} className="qitu-skeleton-line" style={lineStyle} />
      ))}
    </div>
  );
}

export function PermissionDenied({
  title = '没有访问权限',
  description,
  onBack,
}: {
  title?: string;
  description?: string;
  onBack?: () => void;
}) {
  return (
    <div className="qitu-state qitu-permission-denied" role="alert">
      <h3 className="qitu-state-title">{title}</h3>
      {description ? <p className="qitu-state-description">{description}</p> : null}
      {onBack ? (
        <button type="button" className="qitu-button qitu-button-ghost" onClick={onBack}>
          返回
        </button>
      ) : null}
    </div>
  );
}
