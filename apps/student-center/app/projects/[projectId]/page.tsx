import { ProjectDetailScreen } from '../../../features/projects';

/** `/student/projects/:projectId` — project detail + stage timeline. */
export default async function ProjectDetailRoute({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <ProjectDetailScreen projectId={projectId} />;
}
