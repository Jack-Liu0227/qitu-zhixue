import { redirect } from 'next/navigation';

/**
 * `/student/projects/:projectId/workbench` — 制作工作台.
 *
 * The route shell only loads the initial read model the module documents
 * (`WorkbenchPage` requires `initialProject` / `initialDraft`);
 * all editing, autosave and conflict state stays inside the module.
 */
export default async function ProjectWorkbenchRoute({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  // The owned project surface provides practice gating; server-side relative
  // fetches from the retired standalone workbench had no request origin/cookie.
  redirect(`/projects/${encodeURIComponent(projectId)}?mode=practice`);
}
