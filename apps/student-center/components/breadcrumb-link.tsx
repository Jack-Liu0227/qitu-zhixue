'use client';
import { StudentLink } from './student-link';
import type { NavLinkRenderer } from '@qitu/ui';
export const renderBreadcrumbLink: NavLinkRenderer = ({ href, className, children }) => (
  <StudentLink href={href} className={className || undefined}>{children}</StudentLink>
);
