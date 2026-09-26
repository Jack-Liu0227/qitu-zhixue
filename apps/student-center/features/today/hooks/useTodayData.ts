'use client';

/**
 * Data/state hook for the 今天 page.
 *
 * Owns the five screen states: loading / empty / error / offline /
 * permission-denied. Components never call `fetch`; this hook only talks to
 * the injected `TodayDataSource`. Nothing is persisted to `localStorage`
 * (minor-data minimization) — the offline cache is in-memory only.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '@qitu/api-client';

import type { TodayDataSource } from '../data';
import type { ActiveProjectSummary, NotificationList, TodayView } from '../types';

export type TodayPageState =
  | 'loading'
  | 'ready'
  | 'empty'
  | 'error'
  | 'offline'
  | 'permission-denied';

export type TodayRegionState = 'loading' | 'ready' | 'error';

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
      return { ok: false, kind: 'denied', code: code ?? (status === 401 ? 'UNAUTHENTICATED' : 'FORBIDDEN') };
    }
    if (status === 0) {
      return { ok: false, kind: 'offline', code };
    }
    return { ok: false, kind: 'error', code: code ?? `HTTP_${status}` };
  }
}

const INITIAL_QUERY: QueryMeta = { status: 'loading', code: null };

export interface UseTodayDataOptions {
  /** Called on a 401 so the shell/AuthGuard can redirect to login. */
  onUnauthenticated?: () => void;
}

export interface UseTodayDataResult {
  state: TodayPageState;
  offline: boolean;
  view: TodayView | null;
  project: ActiveProjectSummary | null;
  notifications: NotificationList | null;
  projectState: TodayRegionState;
  errorCode: string | null;
  retrying: boolean;
  retry: () => void;
}

export function useTodayData(
  dataSource: TodayDataSource,
  options: UseTodayDataOptions = {},
): UseTodayDataResult {
  const [view, setView] = useState<TodayView | null>(null);
  const [project, setProject] = useState<ActiveProjectSummary | null>(null);
  const [notifications, setNotifications] = useState<NotificationList | null>(null);
  const [viewQuery, setViewQuery] = useState<QueryMeta>(INITIAL_QUERY);
  const [projectQuery, setProjectQuery] = useState<QueryMeta>(INITIAL_QUERY);
  const [offline, setOffline] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const onUnauthenticatedRef = useRef(options.onUnauthenticated);
  onUnauthenticatedRef.current = options.onUnauthenticated;

  // In-memory cache for read-only offline rendering (never persisted).
  const cacheRef = useRef<{
    view: TodayView | null;
    project: ActiveProjectSummary | null;
    notifications: NotificationList | null;
  }>({ view: null, project: null, notifications: null });

  const load = useCallback(async () => {
    setRetrying(true);
    setViewQuery(INITIAL_QUERY);
    setProjectQuery(INITIAL_QUERY);

    const [nextView, nextProject, nextNotifications] = await Promise.all([
      runQuery(() => dataSource.getToday()),
      runQuery(() => dataSource.getActiveProject()),
      runQuery(() => dataSource.getNotifications()),
    ]);

    // 401 means the session expired. Follow the AuthGuard convention and send
    // the browser to login (/) rather than showing a permission-denied state.
    const unauthenticated = [nextView, nextProject, nextNotifications].some(
      (outcome) => !outcome.ok && outcome.code === 'UNAUTHENTICATED',
    );
    if (unauthenticated) {
      setRetrying(false);
      if (onUnauthenticatedRef.current) onUnauthenticatedRef.current();
      else if (typeof window !== 'undefined') window.location.assign('/');
      return;
    }

    if (nextView.ok) {
      cacheRef.current.view = nextView.data;
      setView(nextView.data);
      setViewQuery({ status: 'ready', code: null });
    } else {
      setViewQuery({ status: nextView.kind, code: nextView.code });
      if (nextView.kind === 'offline') setView(cacheRef.current.view);
    }

    if (nextProject.ok) {
      cacheRef.current.project = nextProject.data;
      setProject(nextProject.data);
      setProjectQuery({ status: 'ready', code: null });
    } else {
      setProjectQuery({ status: nextProject.kind, code: nextProject.code });
      if (nextProject.kind === 'offline') setProject(cacheRef.current.project);
    }

    if (nextNotifications.ok) {
      cacheRef.current.notifications = nextNotifications.data;
      setNotifications(nextNotifications.data);
    } else if (nextNotifications.kind === 'offline') {
      setNotifications(cacheRef.current.notifications);
    }

    const wasOffline =
      (!nextView.ok && nextView.kind === 'offline') ||
      (!nextProject.ok && nextProject.kind === 'offline') ||
      (!nextNotifications.ok && nextNotifications.kind === 'offline');
    const navigatorOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
    setOffline(wasOffline || navigatorOffline);
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

  const state = useMemo<TodayPageState>(() => {
    if (offline) return 'offline';
    if (viewQuery.status === 'denied' || projectQuery.status === 'denied') return 'permission-denied';
    if (viewQuery.status === 'loading') return 'loading';
    if (viewQuery.status === 'error') return 'error';
    if (view && !view.hasActiveProject) return 'empty';
    return 'ready';
  }, [offline, viewQuery.status, projectQuery.status, view]);

  const projectState: TodayRegionState =
    projectQuery.status === 'ready' ? 'ready' : projectQuery.status === 'loading' ? 'loading' : 'error';

  return {
    state,
    offline,
    view,
    project,
    notifications,
    projectState,
    errorCode: viewQuery.code,
    retrying,
    retry,
  };
}
