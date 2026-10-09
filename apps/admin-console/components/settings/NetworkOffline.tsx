'use client';

import { useEffect, useState } from 'react';

/**
 * 浏览器联网状态监听：把 `navigator.onLine` + online/offline 事件收敛成一个
 * 布尔值。设置页用它把「断网」与「服务端报错」区分开——断网时列表顶部出现
 * 常驻横幅，恢复联网后自动消失并触发重试。
 */
export function useBrowserOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine !== false,
  );

  useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  return online;
}

export interface NetworkOfflineBannerProps {
  online: boolean;
  onRetry?: () => void;
}

/** 「断网」可见状态条（区别于服务端 error 与 403 权限失败）。 */
export function NetworkOfflineBanner({ online, onRetry }: NetworkOfflineBannerProps) {
  if (online) return null;
  return (
    <div
      role="status"
      className="settings-offline-banner"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        border: '1px solid #fbbf24',
        background: '#fffbeb',
        borderRadius: 10,
        padding: '10px 14px',
        margin: '10px 0',
        fontSize: 13,
        color: '#92400e',
      }}
    >
      <span>📡 当前设备已断网：列表与表单数据暂不可刷新，恢复连接后将自动重试。</span>
      {onRetry ? (
        <button type="button" className="settings-pill-btn" onClick={onRetry}>
          重试
        </button>
      ) : null}
    </div>
  );
}
