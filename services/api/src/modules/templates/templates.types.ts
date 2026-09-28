/**
 * 共享可验证项目模板库的领域类型。
 *
 * 归属：模板治理（Admin / 授权教职工）。学生端只读已发布版本；治理端在
 * `draft → review → published → archived` 生命周期内写入。版本一经发布即冻结，
 * 修改内容必须产生**新版本**，绝不原地改写（ADR 0006 / 产品文档 7.4）。
 */

/** 模板与模板版本共用的生命周期状态。只有 `published` 对学生可见 / 可推荐。 */
export type TemplateStatus = 'draft' | 'review' | 'published' | 'archived';

/** 模板定义里的展示阶段（随版本冻结）。 */
export interface TemplateStage {
  id: string;
  label: string;
}

/** 模板主体（元数据 + 治理状态）。 */
export interface ProjectTemplateRecord {
  id: string;
  /** NULL = 平台共享；否则为校属模板。 */
  schoolId: string | null;
  slug: string;
  title: string;
  summary: string;
  domain: string | null;
  ageRange: string | null;
  difficulty: string | null;
  estimatedDurationMinutes: number | null;
  requiredMaterials: string[];
  learningObjectives: string[];
  outcomeForm: string | null;
  safetyNotes: string | null;
  status: TemplateStatus;
  createdBy: string | null;
  verifiedBy: string | null;
  verifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** 某一模板的不可变版本快照。 */
export interface ProjectTemplateVersionRecord {
  id: string;
  templateId: string;
  version: string;
  stages: TemplateStage[];
  content: Record<string, unknown>;
  rubric: unknown[];
  status: TemplateStatus;
  createdBy: string | null;
  publishedAt: Date | null;
  createdAt: Date;
}

/* ============================ 写操作入参 ============================ */

export interface CreateTemplateInput {
  /** 仅 admin 可显式指定平台模板（null）；teacher 由服务端强制绑定本校。 */
  schoolId: string | null;
  slug: string;
  title: string;
  summary: string;
  domain?: string | null;
  ageRange?: string | null;
  difficulty?: string | null;
  estimatedDurationMinutes?: number | null;
  requiredMaterials?: string[];
  learningObjectives?: string[];
  outcomeForm?: string | null;
  safetyNotes?: string | null;
}

export interface UpdateTemplateInput {
  title?: string;
  summary?: string;
  domain?: string | null;
  ageRange?: string | null;
  difficulty?: string | null;
  estimatedDurationMinutes?: number | null;
  requiredMaterials?: string[];
  learningObjectives?: string[];
  outcomeForm?: string | null;
  safetyNotes?: string | null;
}

export interface CreateTemplateVersionInput {
  stages: TemplateStage[];
  content?: Record<string, unknown>;
  rubric?: unknown[];
}

/* ============================ 读操作投影 ============================ */

export interface TemplateView {
  id: string;
  schoolId: string | null;
  scope: 'platform' | 'school';
  slug: string;
  title: string;
  summary: string;
  domain: string | null;
  ageRange: string | null;
  difficulty: string | null;
  estimatedDurationMinutes: number | null;
  requiredMaterials: string[];
  learningObjectives: string[];
  outcomeForm: string | null;
  safetyNotes: string | null;
  status: TemplateStatus;
  latestPublishedVersionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateVersionView {
  id: string;
  templateId: string;
  version: string;
  stages: TemplateStage[];
  status: TemplateStatus;
  publishedAt: string | null;
  createdAt: string;
}

/* ========================== 验证评测证据 ========================== */

/** 单个目标的掌握证据；`mastered` 直接来自 mastery 引擎，绝不在此重算。 */
export interface ObjectiveMasteryEvidence {
  objectiveId: string;
  knowledgeType: string;
  mastered: boolean;
}

/**
 * 某模板版本的验证证据快照。
 *
 * 所有字段都来自服务端已持久化的领域表，客户端无法写入：
 * - `completedProjectIds` ← `projects`（status = completed）；
 * - `theoryObjectives` / `practiceObjectives` ← `learning_objectives` + `mastery_records`；
 * - `artifactAcceptedRefs` ← `mentor_reviews`（kind=artifact, status=approved）；
 * - `mentorApprovalRefs` ← `mentor_reviews`（kind=project, status=approved）。
 */
export interface VerificationEvidence {
  templateVersionId: string;
  completedProjectIds: string[];
  theoryObjectives: ObjectiveMasteryEvidence[];
  practiceObjectives: ObjectiveMasteryEvidence[];
  artifactAcceptedRefs: string[];
  mentorApprovalRefs: string[];
}

export type VerificationCheckKey =
  | 'project_completed'
  | 'theory_mastered'
  | 'practice_mastered'
  | 'artifact_accepted'
  | 'mentor_approved';

export interface VerificationCheck {
  key: VerificationCheckKey;
  label: string;
  passed: boolean;
  detail: string;
}

export interface VerificationReport {
  templateVersionId: string;
  passed: boolean;
  checks: VerificationCheck[];
  evidenceRefs: string[];
  evaluatedAt: string;
}
