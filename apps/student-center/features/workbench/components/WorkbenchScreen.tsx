'use client';

import type { ReactNode } from 'react';
import { StudentShell, type NavItem } from '@qitu/ui';
import { WorkbenchBreadcrumb } from './WorkbenchBreadcrumb';
import { WorkbenchPage, type WorkbenchPageProps } from './WorkbenchPage';

export interface WorkbenchScreenProps extends WorkbenchPageProps {
  /** Frozen nav items are owned by the shell/integrator; never redefined here. */
  navItems: NavItem[];
  activeHref: string;
  brandName?: string;
  header?: ReactNode;
}

/**
 * Optional convenience wrapper: renders the workbench inside `StudentShell`
 * with the breadcrumb in the real `bannerSlot`. Wave 4 may use this or wire the
 * shell itself; this component never adds a nav item.
 */
export function WorkbenchScreen({
  navItems,
  activeHref,
  brandName,
  header,
  ...pageProps
}: WorkbenchScreenProps) {
  return (
    <StudentShell
      brandName={brandName}
      navItems={navItems}
      activeHref={activeHref}
      header={header ?? null}
      bannerSlot={<WorkbenchBreadcrumb projectTitle={pageProps.initialProject.title} />}
    >
      <WorkbenchPage {...pageProps} />
    </StudentShell>
  );
}
