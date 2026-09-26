import { EmptyState } from '@qitu/ui';
import { StudentLink } from '../../components/student-link';

/**
 * `/student/works` — 作品展厅.
 *
 * No feature module ships yet. This is an honest "spec pending" surface in the
 * app's shared state-component style; it renders no invented content.
 */
export default function WorksRoute() {
  return (
    <EmptyState
      title="作品展厅 · 模块规格尚未开发"
      description="作品展厅的产品规格尚未开发，这里暂时不会展示任何作品内容。完成制作后你仍可从项目页查看进展。"
      action={
        <StudentLink className="qitu-button qitu-button-ghost" href="/student/today">
          返回今天
        </StudentLink>
      }
    />
  );
}
