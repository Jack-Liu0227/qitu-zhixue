import type { TemplateStage } from '@qitu/contracts';
import { PROJECT_TAB_STAGE_MAP } from '../constants';
import type {
  MentorNoteView,
  NextStep,
  PresignRequest,
  PresignResponse,
  ProjectDetail,
  ProjectListItem,
  ProjectStage,
  ProjectStageView,
  ReflectionInput,
  TaskSubmission,
  TaskView,
  TheoryAnswer,
  TheoryCheckResult,
  TheoryMaterial,
  TheoryQuestion,
} from '../types';
import type { ProjectListQuery, ProjectsDataSource } from './data-source';
import {
  MOCK_MENTOR_NOTES,
  MOCK_NEXT_STEPS,
  MOCK_PROJECTS,
  MOCK_STAGE_VIEWS,
  MOCK_TASKS,
  MOCK_TEMPLATE_STAGES,
  MOCK_THEORY_ANSWER_KEY,
  MOCK_THEORY_MATERIAL,
  MOCK_THEORY_QUESTIONS,
} from './mock-data';

const delay = (ms = 120): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const toListItem = (project: ProjectDetail): ProjectListItem => ({ ...project });

function matchesQuery(project: ProjectListItem, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return (
    project.title.toLowerCase().includes(needle) ||
    project.subtitle.toLowerCase().includes(needle) ||
    project.tags.some((tag) => tag.toLowerCase().includes(needle))
  );
}

/**
 * mock 实现：内存数据 + 延迟，用于在真 API 落地前驱动五态。
 * Wave 4 通过 `setProjectsDataSource` 换成真实 API 客户端即可。
 */
export class MockProjectsDataSource implements ProjectsDataSource {
  async listProjects(query: ProjectListQuery): Promise<ProjectListItem[]> {
    await delay();
    const stages = PROJECT_TAB_STAGE_MAP[query.tab];
    return MOCK_PROJECTS.filter(
      (project) => stages.includes(project.status) && matchesQuery(project, query.q ?? ''),
    ).map(toListItem);
  }

  async getProject(projectId: string): Promise<ProjectDetail | null> {
    await delay();
    const project = MOCK_PROJECTS.find((item) => item.id === projectId);
    return project ? { ...project, tags: [...project.tags] } : null;
  }

  async getStages(projectId: string): Promise<ProjectStageView[]> {
    await delay();
    return (MOCK_STAGE_VIEWS[projectId] ?? []).map((item) => ({ ...item }));
  }

  async getTasks(projectId: string): Promise<TaskView[]> {
    await delay();
    return (MOCK_TASKS[projectId] ?? []).map((item) => ({ ...item }));
  }

  async getNextStep(projectId: string): Promise<NextStep | null> {
    await delay();
    const next = MOCK_NEXT_STEPS[projectId];
    return next ? { ...next } : null;
  }

  async getTemplateStages(templateVersionId: string): Promise<TemplateStage[]> {
    await delay();
    return (MOCK_TEMPLATE_STAGES[templateVersionId] ?? []).map((item) => ({ ...item }));
  }

  async getTheoryMaterial(projectId: string): Promise<TheoryMaterial | null> {
    await delay();
    const material = MOCK_THEORY_MATERIAL[projectId];
    return material ? { ...material, sections: material.sections.map((item) => ({ ...item })) } : null;
  }

  async getTheoryQuestions(projectId: string): Promise<TheoryQuestion[]> {
    await delay();
    return (MOCK_THEORY_QUESTIONS[projectId] ?? []).map((item) => ({
      ...item,
      options: [...item.options],
    }));
  }

  async getMentorNote(projectId: string): Promise<MentorNoteView | null> {
    await delay();
    const note = MOCK_MENTOR_NOTES[projectId];
    return note ? { ...note } : null;
  }

  // ——— 写操作：均带幂等键，服务端权威 ———

  async submitTheoryCheck(
    projectId: string,
    answers: TheoryAnswer[],
    _idempotencyKey: string,
  ): Promise<TheoryCheckResult> {
    await delay();
    const questions = MOCK_THEORY_QUESTIONS[projectId] ?? [];
    const passed =
      questions.length > 0 &&
      questions.every((question) => {
        const answer = answers.find((item) => item.questionId === question.id);
        return answer !== undefined && answer.optionIndex === MOCK_THEORY_ANSWER_KEY[question.id];
      });
    return {
      passed,
      theoryMastered: passed,
      nextStage: passed ? 'practice_ready' : undefined,
    };
  }

  async completeTask(
    taskId: string,
    _idempotencyKey: string,
  ): Promise<{ taskId: string; status: ProjectStage }> {
    await delay();
    return { taskId, status: 'practice_building' };
  }

  async submitTask(
    taskId: string,
    _payload: TaskSubmission,
    _idempotencyKey: string,
  ): Promise<{ submissionId: string }> {
    await delay();
    return { submissionId: `sub-${taskId}-${Date.now().toString(36)}` };
  }

  async submitReflection(
    projectId: string,
    _payload: ReflectionInput,
    _idempotencyKey: string,
  ): Promise<{ reflectionId: string }> {
    await delay();
    return { reflectionId: `ref-${projectId}-${Date.now().toString(36)}` };
  }

  async presignArtifact(payload: PresignRequest, _idempotencyKey: string): Promise<PresignResponse> {
    await delay();
    const objectKey = `projects/${payload.purpose}/${Date.now().toString(36)}-${payload.filename}`;
    return { uploadUrl: `https://files.example.com/${objectKey}`, objectKey };
  }
}
