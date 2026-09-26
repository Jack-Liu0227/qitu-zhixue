import { WorkbenchPage, workbenchDataSource } from '../../../../features/workbench';

/**
 * `/student/projects/:projectId/workbench` — 制作工作台.
 *
 * The route shell only loads the initial read model the module documents
 * (`WorkbenchPage` requires `initialProject` / `initialStages` / `initialDraft`);
 * all editing, autosave and conflict state stays inside the module.
 */
export default async function ProjectWorkbenchRoute({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const [initialProject, stageProgress, initialDraft] = await Promise.all([
    workbenchDataSource.getProject(projectId),
    workbenchDataSource.getStageProgress(projectId),
    workbenchDataSource.getDraft(projectId, 'flow'),
  ]);

  return (
    <WorkbenchPage
      projectId={projectId}
      initialProject={initialProject}
      initialStages={stageProgress.stages}
      initialDraft={initialDraft}
      finishHref="/student/works"
    />
  );
}
