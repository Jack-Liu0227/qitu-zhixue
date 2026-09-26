'use client';

/**
 * Data/state hook for the 灵感空间「推荐项目」tab.
 *
 * Owns the five screen states: loading / empty / error / offline /
 * permission-denied. Components never call `fetch`; this hook only talks to
 * the injected `InspirationDataSource`. Nothing is persisted to `localStorage`
 * (minor-data minimization) — the offline cache is in-memory only.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '@qitu/api-client';

import type { InspirationDataSource } from '../data';
import type { InspirationTemplate } from '../types';

export type InspirationPageState =
  | 'loading'
  | 'ready'
  | 'empty'
  | 'error'
  | 'offline'
  | 'permission-denied';

interface QueryMeta {
  status: 'loading' | 'ready' | 'error' | 'denied' | 'offline';
  code: string | null;
}

type QueryOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; kind: 'denied' | 'offline' | 'error'; code: string | null };

async function runQuery<T>(run: () => Promise<T>): Promise<QueryOutcome<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (error) {
    const apiError = error instanceof ApiError ? error : null;
    const status = apiError?.status ?? 0;
    const code = apiError?.code ?? null;
    if (status === 403 || status === 401) {
      return {
        ok: false,
        kind: 'denied',
        code: code ?? (status === 401 ? 'UNAUTHENTICATED' : 'FORBIDDEN'),
      };
    }
    if (status === 0) {
      return { ok: false, kind: 'offline', code };
    }
    return { ok: false, kind: 'error', code: code ?? `HTTP_${status}` };
  }
}

export interface UseInspirationDataOptions {
  /** Called on a 401 so the shell/AuthGuard can redirect to login. */
  onUnauthenticated?: () => void;
}

export interface UseInspirationDataResult {
  state: InspirationPageState;
  offline: boolean;
  templates: InspirationTemplate[];
  errorCode: string | null;
  retrying: boolean;
  retry: () => void;
}

export function useInspirationData(
  dataSource: InspirationDataSource,
  options: UseInspirationDataOptions = {},
): UseInspirationDataResult {
  const [templates, setTemplates] = useState<InspirationTemplate[] | null>(null);
  const [query, setQuery] = useState<QueryMeta>({ status: 'loading', code: null });
  const [offline, setOffline] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const onUnauthenticatedRef = useRef(options.onUnauthenticated);
  onUnauthenticatedRef.current = options.onUnauthenticated;

  // In-memory cache for read-only offline rendering (never persisted).
  const cacheRef = useRef<InspirationTemplate[] | null>(null);

  const load = useCallback(async () => {
    setRetrying(true);
    setQuery({ status: 'loading', code: null });

    const outcome = await runQuery(() => dataSource.listTemplates());

    // 401 means the session expired. Follow the AuthGuard convention and send
    // the browser to login (/) rather than showing a permission-denied state.
    if (!outcome.ok && outcome.code === 'UNAUTHENTICATED') {
      setRetrying(false);
      if (onUnauthenticatedRef.current) onUnauthenticatedRef.current();
      else if (typeof window !== 'undefined') window.location.assign('/');
      return;
    }

    if (outcome.ok) {
      cacheRef.current = outcome.data;
      setTemplates(outcome.data);
      setQuery({ status: 'ready', code: null });
    } else {
      setQuery({ status: outcome.kind, code: outcome.code });
      if (outcome.kind === 'offline') setTemplates(cacheRef.current);
    }

    setRetrying(false);
  }, [dataSource]);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setOffline(true);
    }
    const handleOnline = () => {
      setOffline(false);
      setReloadToken((token) => token + 1);
    };
    const handleOffline = () => setOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const retry = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  const state = useMemo<InspirationPageState>(() => {
    if (offline) return 'offline';
    if (query.status === 'denied') return 'permission-denied';
    if (query.status === 'loading') return 'loading';
    if (query.status === 'error') return 'error';
    if (templates && templates.length === 0) return 'empty';
    return 'ready';
  }, [offline, query.status, templates]);

  return {
    state,
    offline,
    templates: templates ?? [],
    errorCode: query.code,
    retrying,
    retry,
  };
}
