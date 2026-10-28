'use client';
import { useEffect, useState } from 'react';
import { SectionCard } from '@qitu/ui';
import { businessRequest } from '@qitu/api-client';
import type { CommerceAccount } from '@qitu/contracts';
export function SubscriptionUsage() {
  const [account, setAccount] = useState<CommerceAccount | null>(null),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setError('');
    void businessRequest<CommerceAccount>('student/subscription', { signal: abort.signal })
      .then((a) => {
        if (!abort.signal.aborted) setAccount(a);
      })
      .catch((e) => {
        if (!abort.signal.aborted) {
          setAccount(null);
          setError(e instanceof Error ? e.message : '权益读取失败');
        }
      });
    return () => abort.abort();
  }, [revision]);
  return (
    <SectionCard title="我的探究权益">
      <p>查看 AI 交互用量。已有作品和成长记录会继续保留；购买或续费请由家长在家长端操作。</p>
      {error && (
        <p role="alert">
          {error}{' '}
          <button className="qitu-button" onClick={() => setRevision((r) => r + 1)}>
            重新读取
          </button>
        </p>
      )}
      {!account && !error && <p role="status">正在读取权益…</p>}
      {account && !account.enabled && <p>订阅策略尚未开放，已有课程仍按原权益学习。</p>}
      {account?.enabled &&
        account.entitlements.map((e) => (
          <div
            key={e.id}
            style={{ padding: '14px 0', borderTop: '1px solid var(--qitu-border, #e2e8e5)' }}
          >
            <strong>{e.title}</strong>
            <p style={{ fontSize: 13 }}>
              {e.used} / {e.quota} 次 · {e.reserved ? `${e.reserved} 次处理中 · ` : ''}
              {new Date(e.resetsAt).toLocaleDateString('zh-CN')} 重置
            </p>
            <progress
              max={e.quota}
              value={e.used + e.reserved}
              aria-label={`${e.title}交互用量`}
              style={{ width: '100%', height: 7, accentColor: '#438471' }}
            />
          </div>
        ))}
    </SectionCard>
  );
}
