import type { AdminInterventionStatus } from './admin';
import type { DataSource } from './platform';
import type { ProjectStage } from './project';

/**
 * 班主任工作台契约。
 *
 * 背景：`apps/teacher-workspace` 此前**完全没有接 API**，
 * 五个数据页全部读 `lib/mock-data.ts`，而那套假数据的 id（`s-001`）、
 * 姓名（`林小宇`）、年级（`五年级`）与后端真实账号
 * （`student-demo` / 小宇 / 七年级）**对不上**，是「数据不统一」的第三个来源。
 * 本契约是它的唯一数据来源。
 *
 * ⚠️ **刻意不包含的字段**：旧 mock 里有 `focusScore`（86）、
 * `radar`（科学探究 92 / 逻辑推理 78 …）、`solved` 这类**评分与雷达图**。
 * 它们与产品自身的约束冲突——家长端契约明令「没有分数、排名、百分位、等级」，
 * 学生端成长档案同样只允许过程性正向计数。班主任端不该出现第三种尺度，
 * 否则同一个孩子在三端会看到互相矛盾的「分数」。
 * 因此这里只保留**过程性事实**：活跃天数、任务数、阶段、停滞与待关注数。
 *
 * 本文件是 type-only，不含运行时逻辑。
 */

/** 工作台顶部身份区。`studentCount` 来自关系真源，不是班主任自己维护的名单。 */
export interface TeacherIdentity {
  teacherId: string;
  displayName: string;
  email: string;
  studentCount: number;
}

/* ------------------------------------------------------------------ *
 * 名册
 * ------------------------------------------------------------------ */

export interface TeacherStudentRow {
  studentId: string;
  displayName: string;
  email: string;
  gradeLabel: string | null;
  classLabel: string | null;
  /** 服务端给出的头像首字母，避免前端各自截取。 */
  avatarInitial: string;
  activeProjectCount: number;
  projectsCompleted: number;
  currentProjectId: string | null;
  currentProjectTitle: string | null;
  currentStage: ProjectStage | null;
  /** 仅用于进度条展示，**不得**用于任何门禁判定。 */
  progressPercent: number;
  lastActivityAt: string | null;
  /** 服务端按停滞时长判定，界面措辞必须是「需要关注」而不是风险标签。 */
  stuck: boolean;
  /** 该学生待处理的介入请求数。 */
  attentionCount: number;
  /** 已接入平台的监护人数量。为 0 意味着家长端看不到这个孩子。 */
  guardianCount: number;
  /** 区间内的活跃天数（过程性计数）。 */
  activeDays: number;
  /** 本周完成任务数（过程性计数）。 */
  weeklyTasks: number;
}

export interface TeacherRosterPageData {
  teacher: TeacherIdentity;
  students: TeacherStudentRow[];
  totals: {
    studentCount: number;
    stuckCount: number;
    attentionCount: number;
    /** 尚无监护人接入的学生数——班主任可以据此推动家长绑定。 */
    withoutGuardianCount: number;
  };
  dataSource: DataSource;
}

export interface TeacherStudentProject {
  projectId: string;
  title: string;
  stage: ProjectStage;
  progressPercent: number;
  updatedAt: string;
}

/** 班主任投影的成长记录；措辞由服务端预审，不含原始对话与内部风险标签。 */
export interface TeacherGrowthDigest {
  id: string;
  occurredAt: string;
  title: string;
  summary: string;
}

export interface TeacherGuardianRef {
  userId: string;
  displayName: string;
  relationship: 'mother' | 'father' | 'guardian';
}

export interface TeacherStudentDetail {
  student: TeacherStudentRow;
  projects: TeacherStudentProject[];
  interventions: TeacherInterventionRow[];
  recentGrowth: TeacherGrowthDigest[];
  guardians: TeacherGuardianRef[];
  /** 本周学习次数与时长，供详情页概览。 */
  sessionsThisWeek: number;
  minutesThisWeek: number;
}

/* ------------------------------------------------------------------ *
 * 介入请求
 * ------------------------------------------------------------------ */

export interface TeacherInterventionRow {
  id: string;
  studentId: string;
  studentDisplayName: string;
  projectId: string | null;
  projectTitle: string | null;
  reason: string;
  status: AdminInterventionStatus;
  createdAt: string;
  /** 已指派班主任；未指派时为 null。 */
  assigneeName: string | null;
}

export interface TeacherInterventionListPageData {
  items: TeacherInterventionRow[];
  totals: {
    open: number;
    acknowledged: number;
    resolved: number;
  };
  dataSource: DataSource;
}

/**
 * 介入详情比列表多两块：系统判定依据与建议话术。
 *
 * `diagnostic` 与 `suggestedPrompt` 都是**服务端生成**的，
 * 前端不得自行拼装话术，否则同一个卡点会因入口不同而给出不同引导。
 */
export interface TeacherInterventionDetail {
  intervention: TeacherInterventionRow;
  student: TeacherStudentRow;
  diagnostic: string;
  suggestion: string;
  suggestedPrompt: string;
}

export type TeacherInterventionAction = 'acknowledge' | 'resolve';

export interface TeacherInterventionActionRequest {
  action: TeacherInterventionAction;
  note: string | null;
}

export interface TeacherInterventionActionResponse {
  intervention: TeacherInterventionRow;
  changedAt: string;
}

/* ------------------------------------------------------------------ *
 * 数据统计
 *
 * 同样是过程性统计，**没有分数与排名**。
 * 重点是把「谁需要关注」和「谁还没绑定关系」显式列出来。
 * ------------------------------------------------------------------ */

export interface TeacherStatisticsPageData {
  teacher: TeacherIdentity;
  totals: {
    studentCount: number;
    activeStudentCount: number;
    sessionsThisWeek: number;
    minutesThisWeek: number;
    tasksCompletedThisWeek: number;
    openInterventions: number;
  };
  /** 每周活跃度，用于趋势展示。 */
  weeklyActivity: { weekLabel: string; activeStudents: number; tasksCompleted: number }[];
  /** 阶段分布，只统计已确认意图的正式项目。 */
  stageDistribution: { stage: ProjectStage; count: number }[];
  /** 需要关注的名单，按停滞时长排序。 */
  needsAttention: TeacherStudentRow[];
  dataSource: DataSource;
}

/* ------------------------------------------------------------------ *
 * 启发式策略设置（只读投影）
 *
 * 这些开关属于平台级配置，**唯一写入者是管理后台**。
 * 班主任端只做只读展示 + 跳转提示，避免两端各自改策略导致
 * 同一个学生的引导方式不一致。
 * ------------------------------------------------------------------ */

export interface TeacherStrategySection {
  id: string;
  label: string;
  description: string;
  active: boolean;
}

export interface TeacherSettingsPageData {
  sections: TeacherStrategySection[];
  /** 该设置的实际管理入口（指向管理后台），前端据此给出跳转说明。 */
  managedByRoute: string;
  /** 本租户是否允许班主任覆盖平台默认策略。默认 false。 */
  teacherOverrideAllowed: boolean;
  dataSource: DataSource;
}
