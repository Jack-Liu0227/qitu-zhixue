'use client';

import { BreadcrumbBar } from '@qitu/ui';
import { renderBreadcrumbLink } from '../../../components/breadcrumb-link';

export interface WorkbenchBreadcrumbProps {
  projectTitle: string;
}

/**
 * Fixed breadcrumb for the workbench. Rendered into `StudentShell.bannerSlot`,
 * replacing the global greeting banner. Never adds a nav item.
 */
export function WorkbenchBreadcrumb({ projectTitle }: WorkbenchBreadcrumbProps) {
  return (
    <BreadcrumbBar
      renderLink={renderBreadcrumbLink}
      items={[
        { label: '我的项目', href: '/student/projects' },
        { label: projectTitle },
        { label: '制作工作台' },
      ]}
    />
  );
}
