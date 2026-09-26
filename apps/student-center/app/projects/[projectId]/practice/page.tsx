import { PracticeScreen } from '../../../../features/projects';

/** `/student/projects/:projectId/practice` — practice checklist + submit. */
export default async function ProjectPracticeRoute({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <PracticeScreen projectId={projectId} />;
}
