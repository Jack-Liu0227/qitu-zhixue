import type { TemplateStage } from '@qitu/contracts';
import type { ProjectsDataSource } from './data-source';
import type {
  MentorNoteView, NextStep, PresignRequest, PresignResponse, ProjectDetail, ProjectListItem,
  ProjectStageView, ProjectTab, ReflectionInput, TaskSubmission, TaskView,
  TheoryAnswer, TheoryCheckResult, TheoryMaterial, TheoryQuestion,
} from '../types';
import { ProjectsDataError } from './data-source';

type SessionIndex = { id: string; theoryObjectiveIds: string[]; practiceObjectiveIds: string[] };

/** API adapter for the governed project and learning-plan contracts. */
export class ApiProjectsDataSource implements ProjectsDataSource {
  private readonly planCache = new Map<string, { planId: string; sessions: SessionIndex[] }>();
  private readonly questionCache = new Map<string, { sessionId: string; options: string[] }>();

  async listProjects(query: { tab: ProjectTab; q?: string }): Promise<ProjectListItem[]> {
    const payload = await this.request<{ data: ProjectListItem[] }>('/api/v1/projects');
    return payload.data.filter((project) => matchesTab(project, query.tab) && (!query.q || `${project.title} ${project.subtitle}`.toLowerCase().includes(query.q.toLowerCase())));
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

  async getTheoryMaterial(projectId: string): Promise<TheoryMaterial | null> {
    const plan = await this.loadPlan(projectId);
    const sections = plan.modules.map((module) => ({ heading: module.name, body: module.objectives.map((objective) => `${objective.name}: ${objective.objective}`).join('\n') }));
    return sections.length > 0 ? { title: plan.goal || plan.interest, sections } : null;
  }

  async getTheoryQuestions(projectId: string): Promise<TheoryQuestion[]> {
    const plan = await this.loadPlan(projectId);
    const questions: TheoryQuestion[] = [];
    for (const session of plan.sessions.filter((item) => item.theoryObjectiveIds.length > 0)) {
      const next = await this.request<{ data: { question: { questionId: string; prompt: string; options: Array<{ id: string; label: string; body: string }> } | null } }>(`/api/v1/learning-plans/${encodeURIComponent(plan.planId)}/sessions/${encodeURIComponent(session.id)}/next-step`);
      const question = next.data.question;
      if (!question || this.questionCache.has(question.questionId)) continue;
      // The grading owner compares the answer against the option body; ids
      // are transport metadata and must not be sent as the learner answer.
      const options = question.options.map((option) => option.body || option.label || option.id);
      this.questionCache.set(question.questionId, { sessionId: session.id, options });
      questions.push({ id: question.questionId, prompt: question.prompt, options, allowFreeText: options.length === 0 });
    }
    return questions;
  }

  async getMentorNote(_projectId: string): Promise<MentorNoteView | null> { return null; }

  async submitTheoryCheck(projectId: string, answers: TheoryAnswer[], idempotencyKey: string): Promise<TheoryCheckResult> {
    const plan = await this.loadPlan(projectId);
    let passed = true;
    let theoryMastered = false;
    for (const answer of answers) {
      const metadata = this.questionCache.get(answer.questionId);
      if (!metadata) { passed = false; continue; }
      const option = answer.answer?.trim() || metadata.options[answer.optionIndex];
      if (!option) { passed = false; continue; }
      const response = await this.request<{ data: { isCorrect: boolean; theoryMastered: boolean } }>(`/api/v1/learning-plans/${encodeURIComponent(plan.planId)}/sessions/${encodeURIComponent(metadata.sessionId)}/answers`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': `${idempotencyKey}:${answer.questionId}` },
        body: JSON.stringify({ questionId: answer.questionId, answer: option }),
      });
      passed = passed && response.data.isCorrect;
      theoryMastered = response.data.theoryMastered;
    }
    return { passed, theoryMastered, nextStage: theoryMastered ? 'practice_ready' : undefined };
  }

  async completeTask(taskId: string, idempotencyKey: string): Promise<{ taskId: string; status: ProjectDetail['status'] }> {
    const mapping = this.findTask(taskId);
    if (!mapping) throw new ProjectsDataError('Task context expired; refresh the project', 409, 'TASK_CONTEXT_EXPIRED');
    const response = await this.request<{ data: { stage: ProjectDetail['status'] } }>(`/api/v1/projects/${encodeURIComponent(mapping.projectId)}/advance`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey }, body: '{}',
    });
    return { taskId, status: response.data.stage };
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

function matchesTab(project: ProjectListItem, tab: ProjectTab): boolean {
  if (tab === 'done') return project.status === 'completed';
  if (tab === 'draft') return project.status === 'exploration' || project.status === 'intent_confirmed';
  return project.status !== 'completed' && project.status !== 'exploration' && project.status !== 'intent_confirmed';
}

function unsupported(message: string): ProjectsDataError { return new ProjectsDataError(message, 501, 'SERVER_CONTRACT_REQUIRED'); }
