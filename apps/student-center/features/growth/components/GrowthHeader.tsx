import { BreadcrumbBar, HandwrittenNote } from '@qitu/ui';
import type { ReactNode } from 'react';
import { renderBreadcrumbLink } from '../../../components/breadcrumb-link';

/**
 * Page heading + breadcrumb back to the entry point (今天 or 我的项目).
 * Navigation is passed in by the integrator so the frozen nav is untouched.
 */
export function GrowthHeader({
  originHref = '/student/today',
  originLabel = '今天',
  projectTitle = null,
  action,
}: {
  originHref?: string;
  originLabel?: string;
  projectTitle?: string | null;
  action?: ReactNode;
}) {
  return (
    <header className="qitu-growth-header">
      <BreadcrumbBar
        renderLink={renderBreadcrumbLink}
        items={[
          { label: originLabel, href: originHref },
          { label: '成长轨迹' },
        ]}
      />
      <div className="qitu-growth-header-main">
        <div>
          <h1 className="qitu-growth-title">成长轨迹</h1>
          <p className="qitu-growth-subtitle">
            这里记录你一步步做出来的东西。
            {projectTitle ? <HandwrittenNote>正看着「{projectTitle}」</HandwrittenNote> : null}
          </p>
        </div>
        {action ? <div className="qitu-growth-header-action">{action}</div> : null}
      </div>
    </header>
  );
}
