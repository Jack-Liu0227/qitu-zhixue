import { TutorPage } from '../../../features/tutor';

/** `/student/tutor/:projectId` — AI搭档 scoped to one project. */
export default async function TutorProjectRoute({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <TutorPage projectId={projectId} />;
}
