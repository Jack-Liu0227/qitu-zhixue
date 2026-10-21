'use client';
import { useRef, useState } from 'react';
import { useTutorDataSource } from '../TutorDataSourceProvider';
import { createIdempotencyKey } from '../idempotency';

export function ProjectTeachingPlanRecovery({ projectId, onRecovered }: { projectId: string; onRecovered?: () => void }) {
  const data = useTutorDataSource();
  const key = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!data.recoverTeachingPlan) return null;
  const recover = async () => {
    if (busy || !data.recoverTeachingPlan) return;
    setBusy(true); setError('');
    try {
      key.current ??= createIdempotencyKey();
      await data.recoverTeachingPlan(projectId, key.current); onRecovered?.();
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : '恢复失败，请重试'); }
    finally { setBusy(false); }
  };
  return <div style={{ textAlign: 'center' }}>
    <p>导师配置已冻结，这个历史项目还缺少对应的课时计划。</p>
    <button type="button" className="qitu-button qitu-button-primary" disabled={busy} onClick={() => void recover()}>{busy ? '正在恢复…' : '恢复本项目课时计划'}</button>
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}
