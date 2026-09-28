'use client';

import { EmptyState, OfflineBanner } from '@qitu/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { parentGrowthDataSource, type ParentGrowthDataSource } from '../data';
import {
  ParentGrowthOfflineError,
  ParentGrowthPermissionError,
} from '../data/parentGrowthDataSource';
import { createDefaultParentGrowthQuery, type ParentGrowthPageData, type StudentGrowthQuery } from '../types';
import { ParentGrowthSummaryCard } from './ParentGrowthSummaryCard';
import {
  ParentGrowthErrorView,
  ParentGrowthLoadingView,
  ParentGrowthPermissionView,
} from './ParentGrowthStateViews';
import { ParentTimelineCard } from './ParentTimelineCard';

type GrowthState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: ParentGrowthPageData }
  | { status: 'empty'; data: ParentGrowthPageData }
  | { status: 'error'; message: string | null }
  | { status: 'offline'; data: ParentGrowthPageData | null }
  | { status: 'permission_denied' };

export interface ParentGrowthPageProps {
  /**
   * 当前选中的孩子，由父级（学习进展页顶部唯一的 ChildPicker）受控传入。
   * 成长页不再维护第二套孩子选择器，只负责渲染这一份只读成长投影。
   */
  childId: string | null;
  /** 测试 / 评审可注入；生产使用共享数据源单例。 */
  dataSource?: ParentGrowthDataSource;
}

/**
 * 学习进展 →「成长记录」内容面板（家长投影，只读）。
 *
 * 数据流：
 *  1. `childId` 由父级受控传入；为 `null` 时提示先选择孩子。
 *  2. 选中孩子后拉取其成长页（summary + timeline），用 `cursor` 分页追加。
 *  3. 把传输失败映射为 loading / empty / error / offline / permission_denied。
 *
 * 这里刻意不渲染 AppShell / 顶栏：外层 `ParentShell` 已经提供唯一顶栏，
 * 本组件只输出内容容器，避免嵌套第二层 `qitu-topbar` / `qitu-content`。
 */
export function ParentGrowthPage({ childId, dataSource }: ParentGrowthPageProps) {
  const source = dataSource ?? parentGrowthDataSource;
  const [query, setQuery] = useState<StudentGrowthQuery>(() => createDefaultParentGrowthQuery());
  const [growthState, setGrowthState] = useState<GrowthState>({ status: 'idle' });
  const [loadingMore, setLoadingMore] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  // 最近一次成功加载的成长页，仅存内存（绝不持久化），断网时用于继续展示已读内容。
  const lastKnownRef = useRef<ParentGrowthPageData | null>(null);
  const prevChildIdRef = useRef<string | null>(childId);

  // 1) 切换孩子时重置分页与内存缓存。cursor 已为 null 时返回同一引用，
  //    避免在挂载 / 切孩子时多触发一次重复请求。
  useEffect(() => {
    if (prevChildIdRef.current === childId) return;
    prevChildIdRef.current = childId;
    lastKnownRef.current = null;
    setLoadingMore(false);
    setQuery((prev) => (prev.cursor === null ? prev : createDefaultParentGrowthQuery()));
  }, [childId]);

  // 2) 选中孩子的成长页
  useEffect(() => {
    if (childId === null) {
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
        const data = await source.getGrowthPage(childId, query);
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
  }, [source, childId, query, reloadToken]);

  // 3) 断网 / 恢复监听：断网立即进入 offline，恢复自动重载。
  useEffect(() => {
    const goOffline = () => {
      if (childId === null) return;
      setGrowthState((prev) => {
        if (prev.status === 'offline') return prev;
        const data =
          prev.status === 'ready' || prev.status === 'empty' ? prev.data : lastKnownRef.current;
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
  }, [childId]);

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

  if (childId === null) {
    return (
      <div className="qitu-parent-growth-page">
        <EmptyState
          title="请先选择孩子"
          description="选择要查看的孩子后，这里会显示他的成长轨迹。"
        />
      </div>
    );
  }

  return (
    <div className="qitu-parent-growth-page">
      {growthState.status === 'offline' ? (
        <OfflineBanner readOnly onRetry={handleRetry} />
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
  );
}
