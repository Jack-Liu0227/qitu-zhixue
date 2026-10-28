'use client';

import { useEffect, useState } from 'react';

export function MembershipRetry() {
  const [online, setOnline] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return (
    <>
      {!online && <p role="status">当前离线，恢复网络后可重新读取。</p>}
      <button
        className="home-btn home-btn--outline"
        type="button"
        disabled={!online || refreshing}
        onClick={() => {
          setRefreshing(true);
          window.location.reload();
        }}
      >
        {refreshing ? '正在重新读取…' : '重新读取方案'}
      </button>
    </>
  );
}
