import { ErrorState, OfflineBanner, SkeletonBlock } from '@qitu/ui';
import { AdminOfflineError, AdminPermissionError } from '../api/types';

interface AdminStateViewsProps {
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
}

export function AdminStateViews({ loading, error, onRetry }: AdminStateViewsProps) {
  if (loading) {
    return <SkeletonBlock lines={8} />;
  }

  if (error instanceof AdminOfflineError) {
    return <OfflineBanner readOnly onRetry={onRetry} />;
  }

  if (error instanceof AdminPermissionError) {
    return (
      <ErrorState
        title="权限不足"
        description={error.message}
        onRetry={onRetry}
      />
    );
  }

  if (error) {
    return (
      <ErrorState
        title="加载失败"
        description={error.message || '发生了未知错误，请稍后重试'}
        onRetry={onRetry}
      />
    );
  }

  return null;
}
