import { redirect } from 'next/navigation';

/** 兼容旧入口，统一落到项目详情容器的实践模式。 */
export default async function ProjectPracticeRoute({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  redirect(`/projects/${encodeURIComponent(projectId)}?mode=practice`);
}
