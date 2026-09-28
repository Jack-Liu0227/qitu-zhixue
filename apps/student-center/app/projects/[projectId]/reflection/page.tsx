import { redirect } from 'next/navigation';

/** 兼容旧入口，统一落到项目详情容器的成果模式。 */
export default async function ProjectReflectionRoute({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  redirect(`/projects/${encodeURIComponent(projectId)}?mode=showcase`);
}
