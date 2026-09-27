import { EmptyState } from '@qitu/ui';
import { StudentLink } from '../../components/student-link';

/**
 * `/student/works` — 作品展厅.
 *
 * The artifact gallery backend (`GET /api/v1/artifacts`) is not wired into the
 * student app yet, so this page must not invent works. Instead of a dead
 * "spec pending" surface it offers the real next steps that exist today:
 * revisit 我的项目, or start something new in 灵感空间.
 */
export default function WorksRoute() {
  return (
    <div className="qitu-works-page">
      <EmptyState
        title="作品展厅"
        description="你完成并发布的作品会陈列在这里。现在可以先去「我的项目」继续制作，或者到「灵感空间」开始一个新想法。"
        action={
          <div className="qitu-works-actions">
            <StudentLink className="qitu-button qitu-button-primary" href="/student/projects">
              查看我的项目
            </StudentLink>
            <StudentLink className="qitu-button qitu-button-ghost" href="/student/inspiration">
              去灵感空间
            </StudentLink>
          </div>
        }
      />
    </div>
  );
}
