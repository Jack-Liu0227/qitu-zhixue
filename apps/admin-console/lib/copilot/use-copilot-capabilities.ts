'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AdminCopilotCapabilities } from '@qitu/contracts';
import { fetchCopilotCapabilities } from '../api/copilot';
import { AdminApiError } from '../api/types';

export function useCopilotCapabilities() {
  const [data, setData] = useState<AdminCopilotCapabilities | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);
    setData(null);
    fetchCopilotCapabilities().then(result => {
      if (!current) return;
      if (result.readiness !== 'ready' || result.operations.length === 0) {
        throw new Error('管家操作目录尚未就绪，请检查已发布技能与后台配置。');
      }
      setData(result);
    }).catch(reason => {
      if (!current) return;
      setError(reason instanceof AdminApiError ? `${reason.code}：${reason.message}`
        : reason instanceof Error ? reason.message : '管家操作目录读取失败');
    }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [revision]);

  useEffect(() => {
    window.addEventListener('online', refresh);
    return () => window.removeEventListener('online', refresh);
  }, [refresh]);

  return { data, loading, error, refresh, ready: !loading && error === null && data !== null };
}
