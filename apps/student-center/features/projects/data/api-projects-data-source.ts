import type { LearningPlanView, ProjectDisplayChange, ProjectHistoryPage, TemplateStage } from '@qitu/contracts';
import type { ProjectsDataSource } from './data-source';
import type {
  MentorNoteView, NextStep, PresignRequest, PresignResponse, ProjectDetail, ProjectListItem,
  ProjectStageView, ProjectTab, ReflectionInput, TaskSubmission, TaskView,
  LessonScheduleView, TheoryAnswer, TheoryCheckResult, TheoryMaterial, TheoryQuestion,
} from '../types';
import { ProjectsDataError } from './data-source';
import { deleteStudentHistory } from './delete-history';

type SessionIndex = { id: string; theoryObjectiveIds: string[]; practiceObjectiveIds: string[] };

/** API adapter for the governed project and learning-plan contracts. */
export class ApiProjectsDataSource implements ProjectsDataSource {
  readonly deleteHistory = deleteStudentHistory;
  private readonly planCache = new Map<string, { planId: string; sessions: SessionIndex[] }>();

  async listProjects(query: { tab: ProjectTab; q?: string }): Promise<ProjectListItem[]> {
    return (await this.queryProjects(query)).items;
  }

  async queryProjects(query: { tab: ProjectTab; q?: string; cursor?: string; includeCollected?: boolean }): Promise<ProjectHistoryPage> {
    const params = new URLSearchParams({ tab:query.tab, q:query.q ?? '',limit:'12',includeCollected:String(query.includeCollected === true) });
    if (query.cursor) params.set('cursor',query.cursor);
    return (await this.request<{ data:ProjectHistoryPage }>(`/api/v1/projects/query?${params}`)).data;
  }

  async changeProjectDisplay(projectId: string | null, input: ProjectDisplayChange, key: string): Promise<{ superseded:boolean }> {
    const path = projectId ? `${encodeURIComponent(projectId)}/display-preference` : 'current-selection';
    const raw = (await this.request<{ data:unknown }>(`/api/v1/projects/${path}`,{ method:'PATCH',
      headers:{ 'content-type':'application/json','idempotency-key':key },body:JSON.stringify(input) })).data;
    const receipt = raw && typeof raw === 'object' ? raw as Record<string,unknown> : {};
    if (typeof receipt.superseded !== 'boolean' || typeof receipt.replayed !== 'boolean'
      || receipt.version !== input.expectedVersion+1 || !Number.isSafeInteger(receipt.currentVersion)
      || Number(receipt.currentVersion) < Number(receipt.version)
      || receipt.superseded !== (receipt.currentVersion !== receipt.version)
      || !(receipt.currentProjectId === null || typeof receipt.currentProjectId === 'string')
      || input.currentProjectId !== undefined && receipt.currentProjectId !== input.currentProjectId
      || projectId && input.collected === true && (typeof receipt.collectedAt !== 'string' || !Number.isFinite(Date.parse(receipt.collectedAt)))
      || projectId && input.collected === false && receipt.collectedAt !== null) {
      throw new ProjectsDataError('显示偏好回执不完整，请刷新核对',502,'PROJECT_PREFERENCE_RECEIPT_INVALID');
    }
    return { superseded:receipt.superseded };
  }

  async getProject(projectId: string): Promise<ProjectDetail | null> {
    try {
      const project = (await this.request<{ data: ProjectDetail }>(`/api/v1/projects/${encodeURIComponent(projectId)}`)).data;
      if (project.learningPlanId) {
        void this.cachePlan(projectId, project.learningPlanId).catch(() => {
          // The detail response remains usable; plan reads will retry on demand.
        });
      }
      return project;
    } catch (error) {
      if (error instanceof ProjectsDataError && error.status === 404) return null;
      throw error;
    }
  }

  async getStages(projectId: string): Promise<ProjectStageView[]> { return (await this.overview(projectId)).stages; }
  async getTasks(projectId: string): Promise<TaskView[]> { return (await this.overview(projectId)).tasks; }
  async getNextStep(projectId: string): Promise<NextStep | null> {
    return (await this.request<{ data: NextStep | null }>(`/api/v1/projects/${encodeURIComponent(projectId)}/next-step`)).data;
  }

  async getTemplateStages(templateVersionId: string): Promise<TemplateStage[]> {
    const parts = templateVersionId.split(':', 2);
    const templateId = parts[0] || templateVersionId;
    const versionId = parts[1] || templateVersionId;
    const payload = await this.request<{ data: { stages?: TemplateStage[] } }>(`/api/v1/project-templates/${encodeURIComponent(templateId)}/versions/${encodeURIComponent(versionId)}`);
    return payload.data.stages ?? [];
  }

  async getLessonSchedule(projectId: string): Promise<LessonScheduleView | null> {
    const project = await this.getProject(projectId);
    if (!project?.learningPlanId) return null;
    const plan = (await this.request<{ data: LearningPlanView }>(`/api/v1/learning-plans/${encodeURIComponent(project.learningPlanId)}`)).data;
    return {
      lessonCount: plan.lessonCount,
      lessonMinutes: plan.lessonMinutes,
      lessons: plan.sessions
        .slice()
        .sort((left, right) => left.lessonIndex - right.lessonIndex)
        .map(({ lessonIndex, title, blocks }) => ({ lessonIndex, title, blocks })),
    };
  }

  async getTheoryMaterial(projectId: string): Promise<TheoryMaterial | null> {
    const plan = await this.loadPlan(projectId);
    const sections = plan.modules.map((module) => ({
      heading: module.name,
      body: module.objectives.map((objective) => `${objective.name}: ${objective.objective}`).join('\n'),
    }));
    return sections.length > 0 ? { title: plan.goal || plan.interest, sections } : null;
  }

  async getTheoryQuestions(_projectId: string): Promise<TheoryQuestion[]> {
    // A formal question belongs to one current Tutor session and objective.
    // Reading a project page must not allocate questions across every lesson.
    return [];
  }

  async getMentorNote(_projectId: string): Promise<MentorNoteView | null> { return null; }

  async submitTheoryCheck(_projectId: string, _answers: TheoryAnswer[], _idempotencyKey: string): Promise<TheoryCheckResult> {
    throw unsupported('Formal assessment is available in the current project Tutor session.');
  }

  async completeTask(_taskId: string, _idempotencyKey: string): Promise<{ taskId: string; status: ProjectDetail['status'] }> {
    throw unsupported('请在当前项目 AI 搭档中提交课时证据并申请完成课时。');
  }

  async submitTask(taskId: string, payload: TaskSubmission, idempotencyKey: string): Promise<{ submissionId: string }> {
    const mapping = this.findTask(taskId);
    if (!mapping) throw new ProjectsDataError('Task context expired; refresh the project', 409, 'TASK_CONTEXT_EXPIRED');
    const artifact = await this.request<{ data: { id: string } }>('/api/v1/artifacts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
      body: JSON.stringify({
        projectId: mapping.projectId,
        title: `Project task submission ${taskId}`,
        summary: payload.content.slice(0, 1000),
        version: { objectKey: payload.artifactRefs[0] ?? null, note: payload.content.slice(0, 500) },
      }),
    });
    const objectiveId = mapping.practiceObjectiveIds[0];
    if (objectiveId) await this.request(`/api/v1/learning-plans/${encodeURIComponent(mapping.planId)}/sessions/${encodeURIComponent(mapping.sessionId)}/evidence`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': `${idempotencyKey}:evidence` },
      body: JSON.stringify({ objectiveId, evidenceRef: `artifact:${artifact.data.id}`, summary: payload.content }),
    });
    return { submissionId: artifact.data.id };
  }

  async submitReflection(_projectId: string, _payload: ReflectionInput, _idempotencyKey: string): Promise<{ reflectionId: string }> {
    throw unsupported('Reflection submission has no server contract yet');
  }

  async presignArtifact(payload: PresignRequest, idempotencyKey: string): Promise<PresignResponse> {
    return (await this.request<{ data: PresignResponse }>('/api/v1/files/presign', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey }, body: JSON.stringify(payload),
    })).data;
  }

  private async overview(projectId: string) {
    const data = (await this.request<{ data: { project: ProjectDetail; stages: ProjectStageView[]; tasks: TaskView[] } }>(`/api/v1/projects/${encodeURIComponent(projectId)}/overview`)).data;
    if (data.project.learningPlanId) await this.cachePlan(projectId, data.project.learningPlanId);
    return data;
  }

  private async cachePlan(projectId: string, planId: string): Promise<void> {
    if (this.planCache.has(projectId)) return;
    const sessions = (await this.request<{ data: SessionIndex[] }>(`/api/v1/learning-plans/${encodeURIComponent(planId)}/sessions`)).data;
    this.planCache.set(projectId, { planId, sessions });
  }

  private async loadPlan(projectId: string): Promise<{ planId: string; interest: string; goal: string; modules: Array<{ name: string; objectives: Array<{ name: string; objective: string }> }>; sessions: SessionIndex[] }> {
    const project = await this.getProject(projectId);
    if (!project?.learningPlanId) throw new ProjectsDataError('Project has no active learning plan', 409, 'LEARNING_PLAN_UNAVAILABLE');
    await this.cachePlan(projectId, project.learningPlanId);
    const plan = (await this.request<{ data: { interest: string; goal: string; modules: Array<{ name: string; objectives: Array<{ name: string; objective: string }> }> } }>(`/api/v1/learning-plans/${encodeURIComponent(project.learningPlanId)}`)).data;
    return { planId: project.learningPlanId, interest: plan.interest, goal: plan.goal, modules: plan.modules, sessions: this.planCache.get(projectId)!.sessions };
  }

  private findTask(taskId: string): { projectId: string; planId: string; sessionId: string; practiceObjectiveIds: string[] } | null {
    for (const [projectId, plan] of this.planCache) {
      const session = plan.sessions.find((item) => item.id === taskId);
      if (session) return { projectId, planId: plan.planId, sessionId: session.id, practiceObjectiveIds: session.practiceObjectiveIds };
    }
    return null;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try { response = await fetch(path, { ...init, credentials: 'same-origin', headers: { accept: 'application/json', ...(init?.headers ?? {}) } }); }
    catch { throw new ProjectsDataError('Network unavailable', 0, 'NETWORK_OFFLINE'); }
    if (!response.ok) {
      let message = 'Project data request failed';
      try { const body = await response.json() as { detail?: string; title?: string; message?: string }; message = body.detail ?? body.message ?? body.title ?? message; } catch { /* non-json response */ }
      throw new ProjectsDataError(message, response.status, `HTTP_${response.status}`);
    }
    return await response.json() as T;
  }
}

function unsupported(message: string): ProjectsDataError { return new ProjectsDataError(message, 501, 'SERVER_CONTRACT_REQUIRED'); }
