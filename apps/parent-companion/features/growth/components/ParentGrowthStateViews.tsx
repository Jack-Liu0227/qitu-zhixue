import { ErrorState, PermissionDenied, SectionCard, SkeletonBlock } from '@qitu/ui';

/**
 * 家长端成长轨迹的加载 / 错误 / 权限状态视图。
 * 数据源决定抛哪种错误，页面据此选择渲染哪一个。
 */

export function ParentGrowthLoadingView() {
  return (
    <div className="qitu-parent-growth-loading" aria-busy="true" aria-live="polite">
      <SectionCard title="正在加载孩子的成长轨迹…">
        <SkeletonBlock lines={1} height={20} width="60%" />
      </SectionCard>
      <SectionCard>
        <SkeletonBlock lines={4} height={18} />
      </SectionCard>
    </div>
  );
}

export function ParentGrowthErrorView({ onRetry }: { onRetry: () => void }) {
  return (
    <ErrorState
      title="成长轨迹没能加载出来"
      description="可能是网络或服务临时出了点问题，可以稍后再试。"
      onRetry={onRetry}
    />
  );
}

export function ParentGrowthPermissionView() {
  return (
    <PermissionDenied
      title="暂时看不到这份成长轨迹"
      description="家长端只显示已授权孩子的成长轨迹。如果你认为这是误会，请联系学校或班主任确认绑定关系。"
    />
  );
}
