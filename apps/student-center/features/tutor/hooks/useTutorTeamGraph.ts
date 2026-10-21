'use client';

import { useEffect, useState } from 'react';
import type { TutorTeamGraph } from '@qitu/contracts';
import type { TutorDataSource } from '../data/dataSource';
import type { TutorLoadStatus, TutorViewError } from '../types';

export function useTutorTeamGraph({ source, projectId, explorationId, refreshKey, watch }: {
  source: TutorDataSource; projectId?: string; explorationId: string | null; refreshKey: number; watch: boolean;
}) {
  const [graph, setGraph] = useState<TutorTeamGraph | null>(null);
  const [status, setStatus] = useState<TutorLoadStatus>('empty');
  const [error, setError] = useState<TutorViewError | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setGraph(null); setError(null);
    if (!projectId && !explorationId) { setStatus('empty'); return; }
    setStatus('loading');
    const load = async () => {
      try {
        const value = projectId ? await source.getTeamGraph(projectId)
          : explorationId && source.getExplorationTeamGraph ? await source.getExplorationTeamGraph(explorationId)
          : null;
        if (cancelled) return;
        setGraph(value); setError(null); setStatus(value ? 'ready' : 'empty');
      } catch (cause) {
        if (cancelled) return;
        const detail = cause instanceof Error ? cause.message : '团队状态加载失败';
        setError({ message: detail, ...typeof cause === 'object' && cause !== null && 'status' in cause && typeof cause.status === 'number' ? { status:cause.status } : {} });
        setStatus('error');
      } finally {
        if (!cancelled && watch) timer = setTimeout(() => { void load(); }, 4000);
      }
    };
    void load();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [source, projectId, explorationId, refreshKey, watch, reload]);
  return { graph, status, error, retry: () => setReload(value => value + 1) };
}
