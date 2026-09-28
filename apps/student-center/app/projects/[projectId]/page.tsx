import { ProjectDetailScreen, parseProjectDeepLink } from '../../../features/projects';

/** `/student/projects/:projectId` — one project container for every entry point. */
export default async function ProjectDetailRoute({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  const deepLink = parseProjectDeepLink(projectId, query);
  return <ProjectDetailScreen taskId={deepLink.taskId} mode={deepLink.mode} projectId={projectId} />;
}
