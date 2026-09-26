import { ErrorState, PermissionDenied, SectionCard, SkeletonBlock } from '@qitu/ui';
export function LoadingState() {
  return (
    <SectionCard title="正在加载家长陪伴数据…">
      <SkeletonBlock lines={4} height={20} />
    </SectionCard>
  );
}
export function ErrorView({ retry }: { retry: () => void }) {
  return (
    <ErrorState title="暂时无法加载" description="服务暂时不可用，请稍后重试。" onRetry={retry} />
  );
}
export function PermissionView() {
  return (
    <PermissionDenied
      title="暂时无法查看这些数据"
      description="当前账号没有权限查看该孩子的数据，请联系学校确认绑定关系。"
    />
  );
}
export function EmptyView({ title = '暂无内容' }: { title?: string }) {
  return (
    <section className="parent-empty">
      <h2>{title}</h2>
      <p>孩子完成新的学习活动后，这里会显示最新内容。</p>
    </section>
  );
}
