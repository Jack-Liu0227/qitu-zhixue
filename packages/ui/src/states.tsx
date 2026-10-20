import type { CSSProperties, ReactNode } from 'react';
import { VisualAsset } from './visual-assets';

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
      <div className="qitu-state-illustration">{illustration ?? <VisualAsset assetId="empty-explore-v1" size={104} />}</div>
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

/** Only an explicit buffered queue may promise synchronization. */
export function OfflineBanner({
  readOnly,
  bufferedCount,
  onRetry,
  message,
}: {
  readOnly: boolean;
  bufferedCount?: number;
  onRetry?: () => void;
  message?: string;
}) {
  const countText =
    bufferedCount !== undefined && bufferedCount > 0 ? `（${bufferedCount} 项待同步）` : '';
  return (
    <div className="qitu-offline-banner" role="status">
      <span className="qitu-offline-dot" aria-hidden="true" />
      <span className="qitu-offline-text">
        {message ?? (bufferedCount !== undefined && bufferedCount > 0
          ? `当前处于离线状态，本机队列${countText}将在网络恢复后尝试同步。`
          : readOnly ? '当前处于离线状态，展示的内容可能不是最新数据。恢复网络后请重新加载。'
            : '当前处于离线状态，操作尚未提交到服务器。请恢复网络后重试。')}
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
