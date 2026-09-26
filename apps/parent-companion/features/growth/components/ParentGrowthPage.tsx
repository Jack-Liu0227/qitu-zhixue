'use client';

import { PRODUCT_NAME, colors } from '@qitu/design-tokens';
import { AppShell, EmptyState, OfflineBanner } from '@qitu/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { parentGrowthDataSource, type ParentGrowthDataSource } from '../data';
import {
  ParentGrowthOfflineError,
  ParentGrowthPermissionError,
} from '../data/parentGrowthDataSource';
import {
  createDefaultParentGrowthQuery,
  type ChildRef,
  type ParentGrowthPageData,
  type StudentGrowthQuery,
} from '../types';
import { ParentChildSelector } from './ParentChildSelector';
import { ParentGrowthSummaryCard } from './ParentGrowthSummaryCard';
import {
  ParentGrowthErrorView,
  ParentGrowthLoadingView,
  ParentGrowthPermissionView,
} from './ParentGrowthStateViews';
import { ParentTimelineCard } from './ParentTimelineCard';

type ChildrenState =
  | { status: 'loading' }
  | { status: 'ready'; children: ChildRef[] }
  | { status: 'empty' }
  | { status: 'error' }
  | { status: 'offline' }
  | { status: 'permission_denied' };

type GrowthState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: ParentGrowthPageData }
  | { status: 'empty'; data: ParentGrowthPageData }
  | { status: 'error'; message: string | null }
  | { status: 'offline'; data: ParentGrowthPageData | null }
  | { status: 'permission_denied' };

export interface ParentGrowthPageProps {
  /** 测试 / 评审可注入；生产使用共享数据源单例。 */
  dataSource?: ParentGrowthDataSource;
}

/**
 * `/parent` 的组装根（家长投影，只读）。
 *
 * 数据流：
 *  1. 拉取当前家长已绑定的孩子列表；多孩子时渲染切换器。
 *  2. 选中孩子后拉取其成长页（summary + timeline），用 `cursor` 分页追加。
 *  3. 把传输失败映射为 loading / empty / error / offline / permission_denied。
 */
export function ParentGrowthPage({ dataSource }: ParentGrowthPageProps) {
  const source = dataSource ?? parentGrowthDataSource;
  const [childrenState, setChildrenState] = useState<ChildrenState>({ status: 'loading' });
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);
  const [query, setQuery] = useState<StudentGrowthQuery>(() => createDefaultParentGrowthQuery());
  const [growthState, setGrowthState] = useState<GrowthState>({ status: 'idle' });
  const [loadingMore, setLoadingMore] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  // 最近一次成功加载的孩子列表与成长页，仅存内存（绝不持久化），
  // 断网时用于继续展示已读内容。
  const childrenListRef = useRef<ChildRef[] | null>(null);
  const lastKnownRef = useRef<ParentGrowthPageData | null>(null);

  // 1) 孩子列表
  useEffect(() => {
    let cancelled = false;
    setChildrenState({ status: 'loading' });

    void (async () => {
      try {
        const children = await source.getChildren();
        if (cancelled) return;
        childrenListRef.current = children;
        setChildrenState(
          children.length === 0 ? { status: 'empty' } : { status: 'ready', children },
        );
        setSelectedChildId((prev) => {
          if (prev !== null && children.some((child) => child.childId === prev)) return prev;
          return children[0]?.childId ?? null;
        });
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ParentGrowthPermissionError) {
          setChildrenState({ status: 'permission_denied' });
          return;
        }
        if (error instanceof ParentGrowthOfflineError) {
          setChildrenState({ status: 'offline' });
          return;
        }
        setChildrenState({ status: 'error' });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [source, reloadToken]);

  // 2) 选中孩子的成长页
  useEffect(() => {
    if (selectedChildId === null) {
      setGrowthState({ status: 'idle' });
      return;
    }

    let cancelled = false;
    setGrowthState((prev) => {
      const isLoadMore = query.cursor !== null && prev.status === 'ready';
      return isLoadMore ? prev : { status: 'loading' };
    });

    void (async () => {
      try {
        const data = await source.getGrowthPage(selectedChildId, query);
        if (cancelled) return;

        setGrowthState((prev) => {
          if (query.cursor !== null && prev.status === 'ready') {
            const merged: ParentGrowthPageData = {
              ...data,
              timeline: {
                ...data.timeline,
                items: [...prev.data.timeline.items, ...data.timeline.items],
              },
            };
            lastKnownRef.current = merged;
            return { status: 'ready', data: merged };
          }

          lastKnownRef.current = data;
          return data.timeline.items.length === 0
            ? { status: 'empty', data }
            : { status: 'ready', data };
        });
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ParentGrowthPermissionError) {
          setGrowthState({ status: 'permission_denied' });
          return;
        }
        if (error instanceof ParentGrowthOfflineError) {
          setGrowthState({ status: 'offline', data: error.lastKnown ?? lastKnownRef.current });
          return;
        }
        setGrowthState({
          status: 'error',
          message: error instanceof Error ? error.message : null,
        });
      } finally {
        if (!cancelled) setLoadingMore(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [source, selectedChildId, query, reloadToken]);

  // 3) 断网 / 恢复监听：断网立即进入 offline，恢复自动重载。
  useEffect(() => {
    const goOffline = () => {
      setChildrenState((prev) => (prev.status === 'offline' ? prev : { status: 'offline' }));
      if (selectedChildId !== null) {
        setGrowthState((prev) => {
          if (prev.status === 'offline') return prev;
          const data =
            prev.status === 'ready' || prev.status === 'empty' ? prev.data : lastKnownRef.current;
          return { status: 'offline', data };
        });
      }
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
  }, [selectedChildId]);

  const handleSelectChild = useCallback((childId: string) => {
    lastKnownRef.current = null;
    setLoadingMore(false);
    setSelectedChildId(childId);
    setQuery(createDefaultParentGrowthQuery());
  }, []);

  const handleRetry = useCallback(() => {
    setLoadingMore(false);
    setQuery(createDefaultParentGrowthQuery());
    setReloadToken((token) => token + 1);
  }, []);

  const nextCursor = growthState.status === 'ready' ? growthState.data.timeline.nextCursor : null;

  const handleLoadMore = useCallback(() => {
    if (nextCursor === null || loadingMore) return;
    setLoadingMore(true);
    setQuery((prev) => ({ ...prev, cursor: nextCursor }));
  }, [nextCursor, loadingMore]);

  const visibleChildren = childrenListRef.current;
  const showChildSelector = visibleChildren !== null && visibleChildren.length > 1;
  const offline = childrenState.status === 'offline' || growthState.status === 'offline';

  return (
    <AppShell title={`${PRODUCT_NAME} · 家长陪伴中心`} accent={colors.completed}>
      <div className="qitu-parent-growth-page">
        {offline ? <OfflineBanner readOnly onRetry={handleRetry} /> : null}

        {childrenState.status === 'permission_denied' ? <ParentGrowthPermissionView /> : null}

        {childrenState.status === 'loading' ? <ParentGrowthLoadingView /> : null}

        {childrenState.status === 'error' ? <ParentGrowthErrorView onRetry={handleRetry} /> : null}

        {childrenState.status === 'offline' && selectedChildId === null ? (
          <EmptyState
            title="暂时无法加载孩子列表"
            description="当前网络不可用。网络恢复后会自动重新加载。"
          />
        ) : null}

        {childrenState.status === 'empty' ? (
          <EmptyState
            title="还没有绑定孩子"
            description="家长账号由学校发放并绑定孩子后，这里会显示孩子的成长轨迹。如果你认为这是误会，请联系学校或班主任确认绑定关系。"
          />
        ) : null}

        {showChildSelector ? (
          <ParentChildSelector
            children={visibleChildren}
            value={selectedChildId}
            onChange={handleSelectChild}
          />
        ) : null}

        {growthState.status === 'permission_denied' ? <ParentGrowthPermissionView /> : null}
        {growthState.status === 'loading' ? <ParentGrowthLoadingView /> : null}
        {growthState.status === 'error' ? <ParentGrowthErrorView onRetry={handleRetry} /> : null}

        {growthState.status === 'offline' ? (
          growthState.data ? (
            <>
              <ParentGrowthSummaryCard summary={growthState.data.summary} />
              <ParentTimelineCard
                items={growthState.data.timeline.items}
                hasNext={false}
                loadingMore={false}
              />
            </>
          ) : (
            <EmptyState
              title="暂时无法加载成长轨迹"
              description="当前网络不可用。网络恢复后会自动重新加载。"
            />
          )
        ) : null}

        {growthState.status === 'empty' ? (
          <>
            <ParentGrowthSummaryCard summary={growthState.data.summary} />
            <EmptyState
              title="孩子的成长轨迹会从这里开始"
              description="孩子完成第一个小目标后，里程碑、作品、反思和掌握的目标都会出现在这里。"
            />
          </>
        ) : null}

        {growthState.status === 'ready' ? (
          <>
            <ParentGrowthSummaryCard summary={growthState.data.summary} />
            <ParentTimelineCard
              items={growthState.data.timeline.items}
              hasNext={growthState.data.timeline.hasNext}
              loadingMore={loadingMore}
              onLoadMore={handleLoadMore}
            />
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
