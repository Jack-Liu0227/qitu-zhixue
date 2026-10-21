import { VisualAsset } from './visual-assets';

const ARTWORK: Record<string, string> = {
  '/': 'activity-reflection-v1', '/today': 'growth-milestone-v1', '/dashboard': 'growth-milestone-v1',
  '/inspiration': 'subject-interdisciplinary-v1', '/tutor': 'avatar-general-v1',
  '/projects': 'template-optics-v1', '/works': 'growth-artifact-v1', '/growth': 'capability-growth-v1',
  '/profile': 'avatar-growth-v1', '/students': 'team-optics-v1', '/issues': 'activity-reflection-v1',
  '/statistics': 'avatar-data-v1', '/progress': 'growth-milestone-v1', '/messages': 'activity-reflection-v1',
  '/relationships': 'team-optics-v1', '/copilot': 'avatar-coordinator-v1', '/settings': 'capability-tools-v1',
  '/knowledge': 'capability-knowledge-v1', '/account': 'avatar-general-v1',
  '/settings/assistants': 'avatar-general-v1', '/settings/teams': 'team-optics-v1',
  '/settings/knowledge': 'capability-knowledge-v1', '/settings/templates': 'template-optics-v1',
  '/settings/skills': 'capability-skills-v1', '/settings/tools': 'capability-tools-v1',
  '/settings/model-providers': 'avatar-data-v1', '/settings/profile-growth': 'capability-growth-v1',
  '/settings/appearance': 'subject-art-v1', '/settings/feishu': 'activity-reflection-v1',
};

/** Fixed navigation artwork, independent of configurable object bindings. */
export function NavigationArtwork({ href, size = 24 }: { href: string; size?: number }) {
  const path = href.replace(/^\/(student|parent|teacher|admin)(?=\/|$)/, '') || '/';
  return <VisualAsset assetId={ARTWORK[path] ?? 'capability-tools-v1'} size={size} />;
}
