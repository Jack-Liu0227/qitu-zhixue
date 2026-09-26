'use client';

import type { ReactNode } from 'react';
import { EmptyState, ErrorState, OfflineBanner, PermissionDenied, SkeletonBlock } from '@qitu/ui';
import type { Loadable } from '../lib/loadable';

export interface ScreenStateProps<T> {
  state: Loadable<T>;
  onRetry: () => void;
  retrying?: boolean;
  loading?: ReactNode;
  emptyTitle: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  onBack?: () => void;
  render: (data: T, offline: boolean) => ReactNode;
}

/**
 * 五态统一渲染器：loading / empty / error / 断网 / 权限失败，
 * 全部复用 `@qitu/ui` 的状态组件；`ready`/`offline` 交给 `render`。
 */
export function ScreenState<T>({
  state,
  onRetry,
  retrying = false,
  loading,
  emptyTitle,
  emptyDescription,
  emptyAction,
  onBack,
  render,
}: ScreenStateProps<T>) {
  switch (state.status) {
    case 'loading':
      return <>{loading ?? <SkeletonBlock lines={5} />}</>;
    case 'empty':
      return (
        <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />
      );
    case 'error':
      return (
        <ErrorState
          description={state.error.message}
          errorCode={state.error.code}
          onRetry={onRetry}
          retrying={retrying}
        />
      );
    case 'denied':
      return <PermissionDenied description={state.error.message} onBack={onBack} />;
    case 'offline':
      return (
        <>
          <OfflineBanner readOnly onRetry={onRetry} />
          {render(state.data, true)}
        </>
      );
    case 'ready':
      return <>{render(state.data, false)}</>;
  }
}
