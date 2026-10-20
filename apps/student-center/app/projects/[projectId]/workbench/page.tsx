import { WorkbenchPage, workbenchDataSource } from '../../../../features/workbench';

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
  const [initialProject, initialDraft] = await Promise.all([
    workbenchDataSource.getProject(projectId),
    workbenchDataSource.getDraft(projectId, 'flow'),
  ]);

  return (
    <WorkbenchPage
      projectId={projectId}
      initialProject={initialProject}
      initialDraft={initialDraft}
      finishHref="/student/works"
    />
  );
}
