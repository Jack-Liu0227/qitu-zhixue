'use client';
import { useCallback, useEffect, useState } from 'react';
import { OfflineBanner, Button, RobotMascot } from '@qitu/ui';
import {
  parentApi,
  ParentOfflineError,
  ParentPermissionError,
  type ChildRef,
  type ParentPageData,
} from './parentApi';
import { EmptyView, ErrorView, LoadingState, PermissionView } from './ParentStates';
export function DemoPill({ source }: { source?: string }) {
  return <span className="demo-pill">{source === 'live' ? '实时数据' : '演示数据'}</span>;
}
export function useChildren() {
  const [state, setState] = useState<{
    status: 'loading' | 'ready' | 'empty' | 'error' | 'offline' | 'permission';
    children: ChildRef[];
  }>({ status: 'loading', children: [] });
  const reload = useCallback(() => {
    setState({ status: 'loading', children: [] });
    void parentApi
      .children()
      .then((r) =>
        setState(
          r.data.length ? { status: 'ready', children: r.data } : { status: 'empty', children: [] },
        ),
      )
      .catch((e) =>
        setState({
          status:
            e instanceof ParentPermissionError
              ? 'permission'
              : e instanceof ParentOfflineError
                ? 'offline'
                : 'error',
          children: [],
        }),
      );
  }, []);
  useEffect(reload, [reload]);
  return { state, reload };
}
export function ChildPicker({
  children,
  value,
  onChange,
}: {
  children: ChildRef[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="child-picker" role="radiogroup" aria-label="选择绑定的孩子">
      {children.map((c) => {
        const isSelected = c.childId === value;
        const initial = c.displayName ? c.displayName.slice(0, 1).toUpperCase() : '学';
        return (
          <button
            type="button"
            className={isSelected ? 'child-chip selected' : 'child-chip'}
            aria-pressed={isSelected}
            key={c.childId}
            onClick={() => onChange(c.childId)}
          >
            <span className="child-avatar-badge" aria-hidden="true">
              {initial}
            </span>
            <span className="child-info">
              <span className="child-name">{c.displayName}</span>
              <small className="child-sub">{c.activeProjectCount} 个进行中项目</small>
            </span>
            {isSelected && (
              <span className="child-selected-check" aria-hidden="true">
                ✓
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
export function PageFrame({
  title,
  subtitle,
  source,
  children,
}: {
  title: string;
  subtitle?: string;
  source?: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="parent-eyebrow">家长陪伴中心</p>
          <h2>{title}</h2>
          <p className="page-subtitle">{subtitle ?? '用 AI 陪伴孩子，发现更大的可能'}</p>
        </div>
        <DemoPill source={source} />
      </div>
      {children}
    </>
  );
}
export function DataState({
  state,
  reload,
  emptyTitle,
  children,
}: {
  state: { status: string };
  reload: () => void;
  emptyTitle?: string;
  children: React.ReactNode;
}) {
  if (state.status === 'loading') return <LoadingState />;
  if (state.status === 'permission') return <PermissionView />;
  if (state.status === 'offline')
    return (
      <>
        <OfflineBanner readOnly onRetry={reload} />
        <EmptyView title="网络暂时不可用" />
      </>
    );
  if (state.status === 'error') return <ErrorView retry={reload} />;
  if (state.status === 'empty') return <EmptyView title={emptyTitle} />;
  return <>{children}</>;
}
export function HeroMascot() {
  return (
    <div className="hero-mascot">
      <RobotMascot size={82} mood="happy" />
    </div>
  );
}
export function safeData<T extends object>(data: ParentPageData<T>): T & { dataSource?: string } {
  return data;
}
export { Button };
