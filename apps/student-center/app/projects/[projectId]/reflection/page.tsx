import { ReflectionScreen } from '../../../../features/projects';

/** `/student/projects/:projectId/reflection` — reflection form. */
export default async function ProjectReflectionRoute({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <ReflectionScreen projectId={projectId} />;
}
