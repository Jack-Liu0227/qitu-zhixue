import type { DataSource } from './platform.js';
import type { ProjectStage } from './project.js';

/**
 * 目录与关系绑定契约（Stage 2 单一真源）。
 *
 * 背景：在持久层落地之前，同一批「谁是谁的学生 / 谁是谁的家长」散落在三处
 * 互不相干的硬编码里，且**互相矛盾**：
 *
 * | 位置 | 内容 |
 * |---|---|
 * | `identity-auth/auth.service.ts` | 9 个账号，`displayName` 是「演示学生」 |
 * | `platform-data.service.ts` | 班主任名册，同一批 id 的 `displayName` 是「小宇」 |
 * | `growth.service.ts` | `PARENT_CHILDREN` 家长↔孩子映射 |
 *
 * 本契约把「人」与「关系」定义为**一个**真源。所有端（学生 / 家长 / 班主任 /
 * 管理后台）都从这里取关系，不允许任何模块再自己维护一份映射。
 *
 * 两条不可绕过的硬约束（AGENTS.md + 数据库部分唯一索引）：
 *  1. **一个学生同一时间只能有一个当前班主任**
 *     （`mentor_assignments_one_active_per_student_idx`）。
 *  2. **对象级权限必须由后端校验**。前端隐藏入口不算数，
 *     因此读接口只返回调用方有权看到的关系。
 *
 * 所有写操作要求 `Idempotency-Key`，重复提交不得产生第二条关系记录。
 * 本文件是 type-only，不含运行时逻辑。
 */

/** 目录里的角色。与 `auth.ts` 的 `Role` 同义，但这里用于**关系两端**的类型校验。 */
export type DirectoryRole = 'student' | 'parent' | 'teacher' | 'admin';

/** 关系行的生命周期。`ended` 是历史事实，不可删除（审计要求）。 */
export type RelationshipStatus = 'active' | 'ended';

/** 家长与孩子的监护关系种类。 */
export type GuardianRelationship = 'mother' | 'father' | 'guardian';

/** 人的最小投影。不含口令、不含任何敏感字段。 */
export interface DirectoryPersonRef {
  userId: string;
  displayName: string;
  email: string;
  role: DirectoryRole;
}

/* ------------------------------------------------------------------ *
 * 家长 ↔ 学生（监护关系）
 * ------------------------------------------------------------------ */

export interface GuardianLinkRow {
  linkId: string;
  parent: DirectoryPersonRef;
  student: DirectoryPersonRef;
  relationship: GuardianRelationship;
  status: RelationshipStatus;
  createdAt: string;
  endedAt: string | null;
}

/** 家长↔学生关系的列表页数据。`parents`/`students` 是**可选绑定对象**，供下拉框使用。 */
export interface GuardianLinkListPageData {
  items: GuardianLinkRow[];
  /** 尚未与该学生绑定过的家长候选（已剔除重复绑定）。 */
  availableParents: DirectoryPersonRef[];
  /** 尚未绑定该家长的其余学生候选。 */
  availableStudents: DirectoryPersonRef[];
  totals: {
    activeCount: number;
    endedCount: number;
    /** 至少有一个 active 监护人的学生占比（0..100，服务端取整）。 */
    coveredStudentPercent: number;
  };
  dataSource: DataSource;
}

export interface CreateGuardianLinkRequest {
  parentUserId: string;
  studentUserId: string;
  relationship: GuardianRelationship;
}

export interface UpdateGuardianLinkRequest {
  relationship: GuardianRelationship;
}

/** 结束关系而不是删除：保留 `endedAt`，学生历史对家长可见范围随之收敛。 */
export interface EndGuardianLinkRequest {
  reason: string | null;
}

/* ------------------------------------------------------------------ *
 * 班主任 ↔ 学生（导师分配）
 * ------------------------------------------------------------------ */

export interface MentorAssignmentRow {
  assignmentId: string;
  student: DirectoryPersonRef;
  mentor: DirectoryPersonRef;
  status: RelationshipStatus;
  assignedAt: string;
  endedAt: string | null;
}

export interface MentorAssignmentListPageData {
  items: MentorAssignmentRow[];
  /** 当前**没有**班主任的学生。这是「一个学生一个当前班主任」约束下的待办队列。 */
  unassignedStudents: DirectoryPersonRef[];
  /** 可被分配的班主任候选。 */
  availableMentors: DirectoryPersonRef[];
  totals: {
    activeCount: number;
    endedCount: number;
    /** 有当前班主任的学生占比（0..100，服务端取整）。 */
    coveredStudentPercent: number;
  };
  dataSource: DataSource;
}

export interface CreateMentorAssignmentRequest {
  studentUserId: string;
  mentorUserId: string;
}

export interface EndMentorAssignmentRequest {
  reason: string | null;
}

/**
 * 换班主任 = 结束旧分配 + 新建分配。
 *
 * 之所以做成**一个**接口而不是让前端连调两次：两个动作必须在一个事务里，
 * 否则中途失败会留下「学生完全没有班主任」的中间态，
 * 也可能撞上 `mentor_assignments_one_active_per_student_idx`。
 */
export interface TransferMentorRequest {
  studentUserId: string;
  mentorUserId: string;
  reason: string | null;
}

export interface TransferMentorResponse {
  ended: MentorAssignmentRow;
  created: MentorAssignmentRow;
}

/* ------------------------------------------------------------------ *
 * 写操作结果
 * ------------------------------------------------------------------ */

export interface GuardianLinkMutationResponse {
  link: GuardianLinkRow;
  /** 变更时间，供前端乐观更新与审计对齐。 */
  changedAt: string;
}

export interface MentorAssignmentMutationResponse {
  assignment: MentorAssignmentRow;
  changedAt: string;
}

/* ------------------------------------------------------------------ *
 * 学生数据统计（管理后台）
 *
 * 产品约束：**没有分数、排名、百分位**。这里只统计过程性事实
 * （活跃天数、任务数、阶段分布、绑定覆盖率），不产出任何「学生评分」。
 * 覆盖率是本轮关系绑定工作的直接验收指标：未绑定班主任 / 监护人的学生
 * 必须能被一眼看出，而不是淹没在总量里。
 * ------------------------------------------------------------------ */

export type AdminStudentStatsRange = '7d' | '30d' | 'all';

export interface AdminStudentStatsQuery {
  range: AdminStudentStatsRange;
}

/** 按天聚合的活跃度。`date` 是 `YYYY-MM-DD`，服务端按平台时区切分。 */
export interface AdminStudentActivityBucket {
  date: string;
  activeStudents: number;
  sessions: number;
  tasksCompleted: number;
}

/** 项目阶段分布。只统计已确认意图的正式项目。 */
export interface AdminStudentStageBucket {
  stage: ProjectStage;
  count: number;
}

export interface AdminStudentStatsRow {
  studentId: string;
  displayName: string;
  gradeLabel: string | null;
  classLabel: string | null;
  activeDays: number;
  sessionsThisWeek: number;
  minutesThisWeek: number;
  tasksCompleted: number;
  currentProjectTitle: string | null;
  currentStage: ProjectStage | null;
  lastActivityAt: string | null;
  /** 是否已绑定监护人与班主任。未绑定项在界面上必须是显式的待办。 */
  hasMentor: boolean;
  hasGuardian: boolean;
}

export interface AdminStudentStatsPageData {
  range: AdminStudentStatsRange;
  totals: {
    studentCount: number;
    /** 区间内有任意学习行为的去重学生数。 */
    activeStudentCount: number;
    sessions: number;
    minutes: number;
    tasksCompleted: number;
    /** 绑定覆盖率，0..100，服务端取整。 */
    mentorCoveredPercent: number;
    guardianCoveredPercent: number;
    /** 两个关系都缺的学生数，是绑定的最高优先级队列。 */
    unboundStudentCount: number;
  };
  activity: AdminStudentActivityBucket[];
  stageDistribution: AdminStudentStageBucket[];
  rows: AdminStudentStatsRow[];
  generatedAt: string;
  dataSource: DataSource;
}
