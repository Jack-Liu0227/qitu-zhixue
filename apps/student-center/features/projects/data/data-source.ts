import type { TemplateStage } from '@qitu/contracts';
import type {
  MentorNoteView,
  NextStep,
  PresignRequest,
  PresignResponse,
  ProjectDetail,
  ProjectListItem,
  ProjectStage,
  ProjectStageView,
  ProjectTab,
  ReflectionInput,
  TaskSubmission,
  TaskView,
  TheoryAnswer,
  TheoryCheckResult,
  TheoryMaterial,
  TheoryQuestion,
} from '../types';

/** 数据源统一错误：携带 HTTP 语义，供五态分类。 */
export class ProjectsDataError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ProjectsDataError';
  }
}

export interface ProjectListQuery {
  tab: ProjectTab;
  q?: string;
}

/**
 * 「我的项目」唯一可换数据源接口。
 *
 * - 组件只调用本接口，绝不直接 fetch（WAVE3-BRIEF §3.5）。
 * - 读操作返回契约视图模型；写操作必须带 `idempotencyKey`（§6.6）。
 * - 不暴露任何写 ProjectStatus / progressPercent / currentStageIndex 的方法（§6.1/§6.4）。
 */
export interface ProjectsDataSource {
  listProjects(query: ProjectListQuery): Promise<ProjectListItem[]>;
  getProject(projectId: string): Promise<ProjectDetail | null>;
  getStages(projectId: string): Promise<ProjectStageView[]>;
  getTasks(projectId: string): Promise<TaskView[]>;
  getNextStep(projectId: string): Promise<NextStep | null>;
  getTemplateStages(templateVersionId: string): Promise<TemplateStage[]>;
  getTheoryMaterial(projectId: string): Promise<TheoryMaterial | null>;
  getTheoryQuestions(projectId: string): Promise<TheoryQuestion[]>;
  getMentorNote(projectId: string): Promise<MentorNoteView | null>;

  submitTheoryCheck(
    projectId: string,
    answers: TheoryAnswer[],
    idempotencyKey: string,
  ): Promise<TheoryCheckResult>;
  completeTask(
    taskId: string,
    idempotencyKey: string,
  ): Promise<{ taskId: string; status: ProjectStage }>;
  submitTask(
    taskId: string,
    payload: TaskSubmission,
    idempotencyKey: string,
  ): Promise<{ submissionId: string }>;
  submitReflection(
    projectId: string,
    payload: ReflectionInput,
    idempotencyKey: string,
  ): Promise<{ reflectionId: string }>;
  presignArtifact(payload: PresignRequest, idempotencyKey: string): Promise<PresignResponse>;
}
