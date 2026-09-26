import { TheoryScreen } from '../../../../features/projects';

/** `/student/projects/:projectId/theory` — theory material + TheoryCheck. */
export default async function ProjectTheoryRoute({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <TheoryScreen projectId={projectId} />;
}
