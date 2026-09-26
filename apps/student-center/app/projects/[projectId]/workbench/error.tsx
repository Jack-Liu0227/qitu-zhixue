'use client';

import { ErrorState } from '@qitu/ui';

/**
 * Route-level error boundary for `/student/projects/:projectId/workbench`.
 * Catches a render/loader crash in the workbench subtree and offers a reset,
 * so the five-state coverage (workbench-spec.md §9) never leaves a blank page.
 */
export default function WorkbenchError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorState
      title="工作台加载失败"
      description="页面渲染时出现了问题，请重试。"
      errorCode={error.digest ?? error.message}
      onRetry={reset}
    />
  );
}
