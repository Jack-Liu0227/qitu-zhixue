import type { FixedNavigationArtworkId } from './navigation-artwork-files';

export type NavigationArtworkDescriptor =
  | { kind: 'library'; assetId: string }
  | { kind: 'fixed'; id: FixedNavigationArtworkId };

/** One artwork per destination; preserve platform identity when matching routes. */
export const NAVIGATION_ARTWORK: Record<string, NavigationArtworkDescriptor> = {
  '/student/today': { kind: 'library', assetId: 'growth-milestone-v1' },
  '/student/inspiration': { kind: 'library', assetId: 'subject-interdisciplinary-v1' },
  '/student/tutor': { kind: 'library', assetId: 'avatar-general-v1' },
  '/student/projects': { kind: 'library', assetId: 'template-optics-v1' },
  '/student/works': { kind: 'library', assetId: 'growth-artifact-v1' },
  '/student/growth': { kind: 'library', assetId: 'capability-growth-v1' },
  '/student/profile': { kind: 'fixed', id: 'profile' },
  '/parent': { kind: 'fixed', id: 'home' },
  '/parent/progress': { kind: 'library', assetId: 'growth-objective-v1' },
  '/parent/messages': { kind: 'fixed', id: 'messages' },
  '/dashboard': { kind: 'fixed', id: 'workbench' },
  '/students': { kind: 'fixed', id: 'students' },
  '/issues': { kind: 'library', assetId: 'activity-inquiry-v1' },
  '/statistics': { kind: 'fixed', id: 'teacher-statistics' },
  '/admin': { kind: 'fixed', id: 'governance' },
  '/admin/students/statistics': { kind: 'fixed', id: 'statistics' },
  '/admin/relationships': { kind: 'fixed', id: 'relationships' },
  '/admin/copilot': { kind: 'library', assetId: 'avatar-coordinator-v1' },
  '/admin/settings': { kind: 'fixed', id: 'settings' },
  '/settings': { kind: 'library', assetId: 'capability-tools-v1' },
  '/settings/account': { kind: 'fixed', id: 'account' },
  '/settings/assistants': { kind: 'fixed', id: 'assistants' },
  '/settings/feishu': { kind: 'fixed', id: 'feishu' },
  '/settings/teams': { kind: 'library', assetId: 'team-coding-v1' },
  '/settings/model-providers': { kind: 'fixed', id: 'gateway' },
  '/settings/skills': { kind: 'library', assetId: 'capability-skills-v1' },
  '/settings/tools': { kind: 'library', assetId: 'subject-coding-v1' },
  '/settings/plugins': { kind: 'fixed', id: 'plugins' },
  '/settings/knowledge': { kind: 'library', assetId: 'capability-knowledge-v1' },
  '/settings/templates': { kind: 'library', assetId: 'template-kinetic-v1' },
  '/settings/profile-growth': { kind: 'library', assetId: 'growth-reflection-v1' },
  '/settings/database': { kind: 'fixed', id: 'database' },
  '/settings/appearance': { kind: 'library', assetId: 'subject-art-v1' },
  '/settings/ops': { kind: 'fixed', id: 'ops' },
  '/settings/system': { kind: 'fixed', id: 'system' },
  '/settings/about': { kind: 'fixed', id: 'about' },
};

const STUDENT_ROUTES = new Set(['today', 'inspiration', 'tutor', 'projects', 'works', 'growth', 'profile']);

export function getNavigationArtwork(href: string): NavigationArtworkDescriptor | undefined {
  let path = href.replace(/[?#].*$/, '').replace(/\/+$/, '') || '/';
  if (path.startsWith('/teacher/')) path = path.slice('/teacher'.length);
  if (path.startsWith('/admin/settings/')) path = path.slice('/admin'.length);
  if (STUDENT_ROUTES.has(path.slice(1))) path = `/student${path}`;
  return NAVIGATION_ARTWORK[path];
}
