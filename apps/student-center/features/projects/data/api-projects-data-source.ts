import type { TemplateStage } from '@qitu/contracts';
import type {
  MentorNoteView, NextStep, PresignRequest, PresignResponse, ProjectDetail, ProjectListItem,
  ProjectStageView, ProjectTab, ProjectsDataSource, ReflectionInput, TaskSubmission, TaskView,
  TheoryAnswer, TheoryCheckResult, TheoryMaterial, TheoryQuestion,
} from './data-source';
import { ProjectsDataError } from './data-source';

export class ApiProjectsDataSource implements ProjectsDataSource {
  async listProjects(query: { tab: ProjectTab; q?: string }): Promise<ProjectListItem[]> {
    const payload = await this.request<{ data: ProjectListItem[] }>('/api/v1/projects');
    return payload.data.filter((project) => matchesTab(project, query.tab) && (!query.q || `${project.title} ${project.subtitle}`.toLowerCase().includes(query.q.toLowerCase())));
  }

  async getProject(projectId: string): Promise<ProjectDetail | null> {
    try { return (await this.request<{ data: ProjectDetail }>(`/api/v1/projects/${encodeURIComponent(projectId)}`)).data; }
    catch (error) { if (error instanceof ProjectsDataError && error.status === 404) return null; throw error; }
  }

  async getStages(projectId: string): Promise<ProjectStageView[]> { return (await this.overview(projectId)).stages; }
  async getTasks(projectId: string): Promise<TaskView[]> { return (await this.overview(projectId)).tasks; }
  async getNextStep(projectId: string): Promise<NextStep | null> { return (await this.request<{ data: NextStep | null }>(`/api/v1/projects/${encodeURIComponent(projectId)}/next-step`)).data; }

  async getTemplateStages(templateVersionId: string): Promise<TemplateStage[]> {
    const [templateId, versionId] = templateVersionId.includes(':') ? templateVersionId.split(':', 2) : [templateVersionId, templateVersionId];
    const payload = await this.request<{ data: { stages?: TemplateStage[] } }>(`/api/v1/project-templates/${encodeURIComponent(templateId)}/versions/${encodeURIComponent(versionId)}`);
    return payload.data.stages ?? [];
  }

  async getTheoryMaterial(): Promise<TheoryMaterial | null> { return null; }
  async getTheoryQuestions(): Promise<TheoryQuestion[]> { return []; }
  async getMentorNote(): Promise<MentorNoteView | null> { return null; }
  async submitTheoryCheck(): Promise<TheoryCheckResult> { throw unsupported('理论校验提交尚未有服务端合同'); }
  async completeTask(): Promise<{ taskId: string; status: ProjectDetail['status'] }> { throw unsupported('任务完成必须接入服务端证据接口'); }
  async submitTask(): Promise<{ submissionId: string }> { throw unsupported('任务提交必须接入服务端证据接口'); }
  async submitReflection(): Promise<{ reflectionId: string }> { throw unsupported('反思提交必须接入服务端接口'); }
  async presignArtifact(): Promise<PresignResponse> { throw unsupported('作品上传必须接入服务端对象存储接口'); }

  private async overview(projectId: string) {
    return (await this.request<{ data: { stages: ProjectStageView[]; tasks: TaskView[] } }>(`/api/v1/projects/${encodeURIComponent(projectId)}/overview`)).data;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try { response = await fetch(path, { ...init, credentials: 'same-origin', headers: { accept: 'application/json', ...(init?.headers ?? {}) } }); }
    catch { throw new ProjectsDataError('网络不可用', 0, 'NETWORK_OFFLINE'); }
    if (!response.ok) {
      let message = '项目数据加载失败';
      try { const body = await response.json() as { detail?: string; title?: string }; message = body.detail ?? body.title ?? message; } catch { /* response may not be JSON */ }
      throw new ProjectsDataError(message, response.status, `HTTP_${response.status}`);
    }
    return await response.json() as T;
  }
}

function matchesTab(project: ProjectListItem, tab: ProjectTab): boolean {
  if (tab === 'done') return project.status === 'completed';
  if (tab === 'draft') return project.status === 'exploration' || project.status === 'intent_confirmed';
  return project.status !== 'completed' && project.status !== 'exploration' && project.status !== 'intent_confirmed';
}

function unsupported(message: string): ProjectsDataError {
  return new ProjectsDataError(message, 501, 'SERVER_CONTRACT_REQUIRED');
}
