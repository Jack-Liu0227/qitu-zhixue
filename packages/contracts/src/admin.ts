import type { ProjectStage } from './project';
import type { DataSource } from './platform';

/**
 * 平台管理后台契约。
 *
 * 首期必须有三个板块（用户明确要求）：
 *  1. **设置** —— 模型供应商 / 模型 / 用途绑定（复用 `models.ts`）
 *  2. **学生端数据查看**
 *  3. **教师端数据查看**
 *
 * ⚠️ **数据来源标注**：当前后端还没有持久层，所有统计都是服务端内存里的
 * **演示种子数据**。因此每个响应都带 `dataSource`，界面必须如实展示，
 * 不允许把种子数据画成真实运营数据。接入真实数据库后改为 `'live'` 即可。
 *
 * 本文件是 type-only，不含运行时逻辑。
 */

export type AdminDataSource = DataSource;

/** 管理后台一级板块（与 `(console)/layout.tsx` 的侧边导航对应）。 */
export type AdminSectionId = 'overview' | 'students' | 'teachers' | 'settings';

/* ------------------------------------------------------------------ *
 * 概览
 * ------------------------------------------------------------------ */

export interface AdminOverviewStats {
  studentCount: number;
  /** 处于 `completed` / `published` 之外、且已确认意图的项目。 */
  activeProjectCount: number;
  /** 服务端按停滞时长判定的卡顿学生数（不是风险标签）。 */
  stuckStudentCount: number;
  teacherCount: number;
  /** 班主任端待处理的介入请求数。 */
  pendingInterventionCount: number;
  /** 已发布作品数。 */
  publishedArtifactCount: number;
}

export interface AdminOverviewPageData {
  stats: AdminOverviewStats;
  /** 最近的介入请求，用于概览页快速一瞥。 */
  recentInterventions: AdminInterventionRow[];
  generatedAt: string;
  dataSource: AdminDataSource;
}

/* ------------------------------------------------------------------ *
 * 学生端数据
 * ------------------------------------------------------------------ */

export type AdminStudentFilter = 'all' | 'active' | 'stuck' | 'no_project';

export interface AdminStudentQuery {
  filter: AdminStudentFilter;
  /** 按班级 / 班主任筛选；null 表示不限。 */
  classLabel: string | null;
  mentorId: string | null;
  /** 按姓名或邮箱模糊搜索；null 表示不限。 */
  search: string | null;
  cursor: string | null;
  limit: number;
}

export interface AdminStudentRow {
  studentId: string;
  displayName: string;
  email: string;
  gradeLabel: string | null;
  classLabel: string | null;
  /** 当前班主任。一个学生同一时间只能有一个（AGENTS.md 硬约束）。 */
  mentorId: string | null;
  mentorName: string | null;
  activeProjectCount: number;
  projectsCompleted: number;
  currentProjectId: string | null;
  currentProjectTitle: string | null;
  currentStage: ProjectStage | null;
  progressPercent: number;
  lastActivityAt: string | null;
  /** 服务端判定的「停滞」，用于列表高亮；界面上必须写成「需要关注」。 */
  stuck: boolean;
  /** 该学生未处理的介入请求数。 */
  attentionCount: number;
}

export interface AdminStudentDetail {
  student: AdminStudentRow;
  /** 最近的成长记录（家长 / 班主任投影的措辞，不含原始对话）。 */
  recentGrowth: AdminGrowthDigest[];
  interventions: AdminInterventionRow[];
  projects: AdminStudentProject[];
  sessionsThisWeek: number;
  minutesThisWeek: number;
}

export interface AdminStudentProject {
  projectId: string;
  title: string;
  stage: ProjectStage;
  progressPercent: number;
  updatedAt: string;
}

export interface AdminGrowthDigest {
  id: string;
  occurredAt: string;
  title: string;
  summary: string;
}

export interface AdminStudentListPageData {
  items: AdminStudentRow[];
  nextCursor: string | null;
  hasNext: boolean;
  /** 全量计数，供筛选标签展示（不受分页影响）。 */
  totals: {
    all: number;
    active: number;
    stuck: number;
    noProject: number;
  };
  /** 可选的筛选维度，由服务端给出，避免前端硬编码班级名。 */
  classOptions: string[];
  mentors: AdminMentorOption[];
  dataSource: AdminDataSource;
}

export interface AdminMentorOption {
  mentorId: string;
  displayName: string;
}

/* ------------------------------------------------------------------ *
 * 教师端数据
 * ------------------------------------------------------------------ */

export interface AdminTeacherQuery {
  search: string | null;
  cursor: string | null;
  limit: number;
}

export interface AdminTeacherRow {
  teacherId: string;
  displayName: string;
  email: string;
  /** 一个班主任可负责多个学生；学生端只会有一个当前班主任。 */
  studentCount: number;
  classLabels: string[];
  pendingInterventionCount: number;
  resolvedThisWeek: number;
  /** 负责学生中处于停滞状态的人数。 */
  stuckStudentCount: number;
  lastActivityAt: string | null;
}

export interface AdminTeacherDetail {
  teacher: AdminTeacherRow;
  students: AdminStudentRow[];
  interventions: AdminInterventionRow[];
}

export interface AdminTeacherListPageData {
  items: AdminTeacherRow[];
  nextCursor: string | null;
  hasNext: boolean;
  totals: {
    all: number;
    withPendingIntervention: number;
    idle: number;
  };
  dataSource: AdminDataSource;
}

/* ------------------------------------------------------------------ *
 * 介入请求（学生端 / 教师端共用的一行）
 * ------------------------------------------------------------------ */

export type AdminInterventionStatus = 'open' | 'acknowledged' | 'resolved';

export interface AdminInterventionRow {
  id: string;
  studentId: string;
  studentDisplayName: string;
  projectTitle: string | null;
  reason: string;
  status: AdminInterventionStatus;
  createdAt: string;
  /** 已指派班主任；未指派时为 null。 */
  assigneeName: string | null;
}

/* ------------------------------------------------------------------ *
 * 设置
 *
 * 设置页是一个「索引」：只列出真实可用的面板，其余明确标为 `planned`。
 * 不允许为了填满界面而渲染假的设置项。
 * ------------------------------------------------------------------ */

export type AdminSettingsPanelId =
  | 'model_providers'
  | 'model_usages'
  | 'model_slots'
  | 'platform'
  | 'security'
  | 'audit';

export interface AdminSettingsPanel {
  id: AdminSettingsPanelId;
  title: string;
  description: string;
  /** 可点击进入的子路由（相对 basePath）；未开放时为 null。 */
  route: string | null;
  status: 'available' | 'planned';
}

export interface AdminSettingsIndexData {
  panels: AdminSettingsPanel[];
  /** 已配置的供应商数与已绑定的用途数，供设置页概览展示。 */
  configuredProviderCount: number;
  configuredUsageCount: number;
  dataSource: AdminDataSource;
}
