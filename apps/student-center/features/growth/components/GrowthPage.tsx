'use client';

import { OfflineBanner } from '@qitu/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { growthDataSource, type GrowthDataSource } from '../data';
import { GrowthOfflineError, GrowthPermissionError } from '../data/growthDataSource';
import {
  createDefaultGrowthQuery,
  type StudentGrowthEntry,
  type StudentGrowthFilterType,
  type StudentGrowthPageData,
  type StudentGrowthQuery,
} from '../types';
import { EntryDetailSheet } from './EntryDetailSheet';
import { FilterBar, type GrowthFilterState } from './FilterBar';
import { GrowthHeader } from './GrowthHeader';
import {
  GrowthEmptyView,
  GrowthErrorView,
  GrowthLoadingView,
  GrowthPermissionView,
} from './GrowthStateViews';
import { GrowthSummaryCard } from './GrowthSummaryCard';
import { TimelineRail } from './TimelineRail';

type PageState =
  | { status: 'loading' }
  | { status: 'ready'; data: StudentGrowthPageData }
  | { status: 'empty'; data: StudentGrowthPageData }
  | { status: 'error'; message: string | null }
  | { status: 'offline'; data: StudentGrowthPageData | null }
  | { status: 'permission_denied' };

export interface GrowthPageProps {
  projectId?: string | null;
  initialType?: StudentGrowthFilterType;
  originHref?: string;
  originLabel?: string;
  /** Injected for tests/review; production uses the shared data source. */
  dataSource?: GrowthDataSource;
}

function syncUrl(next: Partial<GrowthFilterState>): void {
  if (typeof window === 'undefined') {
    return;
  }
  const params = new URLSearchParams(window.location.search);
  if (next.type !== undefined) {
    if (next.type === 'all') {
      params.delete('type');
    } else {
      params.set('type', next.type);
    }
  }
  if (next.projectId !== undefined) {
    if (next.projectId === null) {
      params.delete('projectId');
    } else {
      params.set('projectId', next.projectId);
    }
  }
  params.delete('cursor');
  const queryString = params.toString();
  const nextUrl = queryString.length > 0 ? `${window.location.pathname}?${queryString}` : window.location.pathname;
  window.history.replaceState(null, '', nextUrl);
}

/**
 * Composition root for `/student/growth` (growth-spec.md §7).
 *
 * Read-only: it fetches C1+C2 through the single swappable `GrowthDataSource`
 * and renders. It builds no write request and offers no way to add, edit, or
 * delete a growth record, metric, milestone, or stage.
 */
export function GrowthPage({
  projectId = null,
  initialType = 'all',
  originHref,
  originLabel,
  dataSource,
}: GrowthPageProps) {
  const source = dataSource ?? growthDataSource;
  const [query, setQuery] = useState<StudentGrowthQuery>(() => ({
    ...createDefaultGrowthQuery(),
    type: initialType,
    projectId,
  }));
  const [state, setState] = useState<PageState>({ status: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  const [detail, setDetail] = useState<StudentGrowthEntry | null>(null);
  // Last successfully loaded page, kept in memory only (never persisted) so
  // the offline state can keep showing the last-read timeline.
  const lastKnownRef = useRef<StudentGrowthPageData | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState((prev) => {
      const isLoadMore = query.cursor !== null && (prev.status === 'ready' || prev.status === 'offline');
      return isLoadMore ? prev : { status: 'loading' };
    });

    void (async () => {
      try {
        const data = await source.loadGrowthPage(query);
        if (cancelled) {
          return;
        }
        lastKnownRef.current = data;
        setState((prev) => {
          if (query.cursor !== null && prev.status === 'ready') {
            const merged: StudentGrowthPageData = {
              ...data,
              timeline: {
                ...data.timeline,
                items: [...prev.data.timeline.items, ...data.timeline.items],
              },
            };
            return { status: 'ready', data: merged };
          }
          const isEmpty = !data.hasAnyProject && data.timeline.items.length === 0;
          return isEmpty ? { status: 'empty', data } : { status: 'ready', data };
        });
      } catch (error) {
        if (cancelled) {
          return;
        }
        if (error instanceof GrowthPermissionError) {
          setState({ status: 'permission_denied' });
          return;
        }
        if (error instanceof GrowthOfflineError) {
          setState({ status: 'offline', data: error.lastKnown ?? lastKnownRef.current });
          return;
        }
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : null,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [source, query, reloadToken]);

  /**
   * 断网 is reachable from connectivity loss alone, not only from a failed
   * request (growth-spec.md §9): mirror the today module's listeners so devtools
   * offline shows the offline state immediately, and reconnect auto-refetches.
   */
  useEffect(() => {
    const goOffline = () => {
      setState((prev) => {
        if (prev.status === 'offline') {
          return prev;
        }
        const data =
          prev.status === 'ready' || prev.status === 'empty'
            ? prev.data
            : lastKnownRef.current;
        return { status: 'offline', data };
      });
    };
    const handleOnline = () => setReloadToken((token) => token + 1);
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      goOffline();
    }
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  const activeFilter: GrowthFilterState = { type: query.type, projectId: query.projectId };

  const handleFilterChange = useCallback((next: Partial<GrowthFilterState>) => {
    setQuery((prev) => ({ ...prev, ...next, cursor: null }));
    syncUrl(next);
  }, []);

  const nextCursor = state.status === 'ready' ? state.data.timeline.nextCursor : null;

  const handleLoadMore = useCallback(() => {
    if (nextCursor === null) {
      return;
    }
    setQuery((prev) => ({ ...prev, cursor: nextCursor }));
  }, [nextCursor]);

  const handleRetry = useCallback(() => {
    setQuery((prev) => ({ ...prev, cursor: null }));
    setReloadToken((token) => token + 1);
  }, []);

  const handleBack = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.location.assign('/student/today');
    }
  }, []);

  const projectTitle = useMemo(() => {
    if (query.projectId === null) {
      return null;
    }
    const data =
      state.status === 'ready' ? state.data : state.status === 'offline' ? state.data : null;
    if (data === null) {
      return null;
    }
    return data.projects.find((project) => project.id === query.projectId)?.title ?? null;
  }, [query.projectId, state]);

  return (
    <div className="qitu-growth-page">
      <GrowthHeader
        originHref={originHref}
        originLabel={originLabel}
        projectTitle={projectTitle}
      />

      {state.status === 'permission_denied' ? <GrowthPermissionView onBack={handleBack} /> : null}
      {state.status === 'loading' ? <GrowthLoadingView /> : null}
      {state.status === 'error' ? (
        <GrowthErrorView description={state.message ?? undefined} onRetry={handleRetry} />
      ) : null}

      {state.status === 'empty' ? (
        <>
          <GrowthSummaryCard summary={state.data.summary} brandNew />
          <GrowthEmptyView />
        </>
      ) : null}

      {state.status === 'offline' ? (
        <>
          <OfflineBanner readOnly onRetry={handleRetry} />
          {state.data ? (
            <>
              <GrowthSummaryCard summary={state.data.summary} />
              <FilterBar
                active={activeFilter}
                projects={state.data.projects}
                onChange={handleFilterChange}
                disabled
              />
              <TimelineRail items={state.data.timeline.items} />
            </>
          ) : (
            <GrowthEmptyView />
          )}
        </>
      ) : null}

      {state.status === 'ready' ? (
        <>
          <GrowthSummaryCard summary={state.data.summary} />
          <FilterBar
            active={activeFilter}
            projects={state.data.projects}
            onChange={handleFilterChange}
          />
          <TimelineRail
            items={state.data.timeline.items}
            hasNext={state.data.timeline.hasNext}
            onLoadMore={handleLoadMore}
            onSelect={(entry) => setDetail(entry)}
          />
        </>
      ) : null}

      <EntryDetailSheet entry={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
