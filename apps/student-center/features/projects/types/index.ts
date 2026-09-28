/**
 * 学生端「我的项目」模块类型。
 *
 * 规则：这里只从 `@qitu/contracts` 再导出共享类型；本文件额外声明的对象是
 * spec §4 明确标注为 `gap` 的「响应形状」视图模型，**不是**第二套 ProjectStatus。
 * 阶段/权限判定一律读 `ProjectStage`（见 `lib/stage.ts`）。
 */
import type {
  ProjectDeepLink,
  ProjectStage,
  ProjectViewMode,
  StageProgressDisplay,
} from '@qitu/contracts';

export type {
  ProjectDeepLink,
  ProjectStage,
  ProjectViewMode,
  TemplateStage,
  StageProgressDisplay,
  ProjectSummary,
  Role,
  ApiErrorCode,
  ProblemDetails,
} from '@qitu/contracts';

/** 列表标签（图片「进行中 / 草稿 / 已完成」）。 */
export type ProjectTab = 'active' | 'draft' | 'done';

/** C1/C3 列表与详情共用的项目摘要字段。 */
export interface ProjectListItem extends StageProgressDisplay {
  id: string;
  title: string;
  subtitle: string;
  coverUrl?: string;
  tags: string[];
  /** 服务端状态机状态；阶段/权限判定只读这里。 */
  status: ProjectStage;
  templateVersionId: string;
}

/** C3 项目详情（gap：completedAt / sourceExplorationId / theoryMastered）。 */
export interface ProjectDetail extends ProjectListItem {
  completedAt?: string | null;
  sourceExplorationId?: string | null;
  /**
   * 只读 TheoryMastered 标志。确认门 Q4：暴露方式待 contract-owner 拍板
   * （并入 GET /projects/:id 或独立端点）。客户端只读，不写。
   */
  theoryMastered: boolean;
}

/** C4 阶段视图。`name` 逐字来自模板，代码中不设阶段名常量。 */
export interface ProjectStageView {
  id: string;
  index: number;
  name: string;
  description: string;
  status: 'done' | 'active' | 'pending';
  /** 服务端状态机状态；入口门判定读这里。 */
  stage: ProjectStage;
}

/** C5 任务视图。 */
export interface TaskView {
  id: string;
  stageId: string;
  title: string;
  description: string;
  status: 'todo' | 'doing' | 'done' | 'locked';
  isTodayFocus: boolean;
  order: number;
}

/** C10「下一步」卡（gap：产品文档无此端点）。 */
export interface NextStep {
  title: string;
  description: string;
  targetStage: ProjectStage;
  deepLink: string;
}

/** C3 只读理论材料（gap：无端点，本模块不新增接口，仅用于 mock 形状）。 */
export interface TheoryMaterialSection {
  heading: string;
  body: string;
}
export interface TheoryMaterial {
  title: string;
  sections: TheoryMaterialSection[];
}

/** 理论校验题。 */
export interface TheoryQuestion {
  id: string;
  prompt: string;
  options: string[];
}
export interface TheoryAnswer {
  questionId: string;
  optionIndex: number;
}
/** C6 响应（`passed:false` 属正常业务态，非 409）。 */
export interface TheoryCheckResult {
  passed: boolean;
  theoryMastered: boolean;
  nextStage?: ProjectStage;
}

/** C8 提交。 */
export interface TaskSubmission {
  content: string;
  artifactRefs: string[];
}

/** C9 反思。visibility 由服务端最小可见策略消费。 */
export interface ReflectionInput {
  stageId: string;
  text: string;
  visibility: 'private' | 'mentor';
}

/** C12 文件预签名。 */
export interface PresignRequest {
  purpose: string;
  filename: string;
  contentType: string;
}
export interface PresignResponse {
  uploadUrl: string;
  objectKey: string;
}

/** 班主任留言（只读、脱敏、最小字段；Q7 数据源待定）。 */
export interface MentorNoteView {
  author: string;
  message: string;
  updatedAt: string;
}

/** 详情页一次性聚合读取（C3/C4/C5/C10）。 */
export interface ProjectOverview {
  project: ProjectDetail | null;
  stages: ProjectStageView[];
  tasks: TaskView[];
  nextStep: NextStep | null;
}
