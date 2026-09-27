import { Injectable, Inject } from '@nestjs/common';
import type {
  AdminDataSource,
  AdminInterventionStatus,
  ProjectStage,
} from '@qitu/contracts';
import type { DirectoryService } from '../directory/directory.service';

/**
 * 平台演示数据集。
 *
 * 这是家长端与管理后台的共享名册：学生、教师、项目、介入请求、消息推送、
 * 服务工单、版本时间线、鼓励/反馈存储、审计日志。
 *
 * **成长记录真相仍在 `GrowthService`**，这里只持有绑定关系与投影需要的补充字段；
 * 所有需要成长摘要的接口必须注入 `GrowthService` 读取，不得在此另造一份成长记录。
 *
 * `dataSource` 一律返回 `'demo'`：当前无持久层，界面必须如实标注「演示数据」。
 */

export interface DemoStudent {
  studentId: string;
  gradeLabel: string | null;
  classLabel: string | null;
  mentorId: string | null;
  mentorName: string | null;
  /** 学生当前活跃项目（已确认意图、未完成/发布）数量。 */
  activeProjectCount: number;
  /** 已走到 completed/published 的项目数。 */
  projectsCompleted: number;
  currentProjectId: string | null;
  currentProjectTitle: string | null;
  currentStage: ProjectStage | null;
  /** 当前项目进度（仅用于展示，不做门禁判定）。 */
  progressPercent: number;
  lastActivityAt: string | null;
  /** 服务端判定的停滞状态（按停滞时长，不是风险标签）。 */
  stuck: boolean;
  /** 该学生待处理的介入请求数。 */
  attentionCount: number;
}

export interface DemoTeacher {
  teacherId: string;
  /** 该班主任负责的学生 ID 列表。一个学生同一时间只能有一个班主任。 */
  studentIds: string[];
  classLabels: string[];
  pendingInterventionCount: number;
  resolvedThisWeek: number;
  lastActivityAt: string | null;
}

export interface DemoProject {
  projectId: string;
  title: string;
  studentId: string;
  stage: ProjectStage;
  progressPercent: number;
  updatedAt: string;
}

export interface DemoIntervention {
  id: string;
  studentId: string;
  projectId: string | null;
  reason: string;
  status: AdminInterventionStatus;
  createdAt: string;
  assigneeId: string | null;
}

/** 家长端「消息与反馈」的一条推送。 */
export interface DemoParentMessage {
  id: string;
  childId: string;
  kind: 'stage_update' | 'attention' | 'feedback_processing' | 'resolved' | 'artifact';
  title: string;
  summary: string;
  occurredAt: string;
  status: 'unread' | 'pending_confirm' | 'processing' | 'resolved';
  projectTitle: string | null;
  /** 是否有 focus 详情；为 true 时前端才渲染「建议关注」展开。 */
  hasFocus: boolean;
}

/** 家长端服务工单。 */
export interface DemoServiceTicket {
  id: string;
  childId: string;
  problem: string;
  projectTitle: string | null;
  owner: string;
  status: 'processing' | 'resolved';
  handledIn: string;
  createdAt: string;
}

/** 作品版本时间线的一步。 */
export interface DemoVersionStep {
  id: string;
  artifactRef: string;
  at: string;
  title: string;
  note: string;
}

/** 作品背后的成长标注。 */
export interface DemoWorkGrowth {
  artifactRef: string;
  independently: string[];
  withAiHelp: string[];
  nextPlan: string[];
}

/** 家长鼓励记录。 */
export interface DemoEncouragement {
  id: string;
  parentId: string;
  childId: string;
  message: string;
  sentAt: string;
  delivered: boolean;
  idempotencyKey: string;
}

/** 家长反馈/工单。 */
export interface DemoFeedback {
  id: string;
  parentId: string;
  childId: string | null;
  source: 'general' | 'message' | 'project';
  content: string;
  messageId: string | null;
  projectId: string | null;
  status: 'processing' | 'resolved';
  createdAt: string;
  idempotencyKey: string;
}

/** 审计日志条目。 */
export interface AuditLogEntry {
  id: string;
  actorId: string;
  action: string;
  targetId: string | null;
  idempotencyKey: string | null;
  at: string;
}

@Injectable()
export class PlatformDataService {
  readonly dataSource: AdminDataSource = 'demo';

  private readonly students: DemoStudent[];
  private readonly teachers: DemoTeacher[];
  private readonly projects: DemoProject[];
  private readonly interventions: DemoIntervention[];
  private readonly messages: DemoParentMessage[];
  private readonly tickets: DemoServiceTicket[];
  private readonly versions: DemoVersionStep[];
  private readonly workGrowth: DemoWorkGrowth[];
  private readonly encouragements: DemoEncouragement[] = [];
  private readonly feedbacks: DemoFeedback[] = [];
  private readonly auditLog: AuditLogEntry[] = [];

  constructor(
    @Inject('DirectoryService') private readonly directory: DirectoryService,
  ) {
    const now = new Date();
    const daysAgo = (days: number): string => {
      const date = new Date(now);
      date.setUTCDate(date.getUTCDate() - days);
      return date.toISOString();
    };

    // 学生名册（mentorId/mentorName 现在从 DirectoryService 取，这里保留仅为演示）
    this.students = [
      {
        studentId: 'student-demo',
        gradeLabel: '七年级',
        classLabel: '七年级一班',
        mentorId: 'teacher-demo', // Sourced from DirectoryService.mentorOfStudent()
        mentorName: '演示班主任',
        activeProjectCount: 1,
        projectsCompleted: 0,
        currentProjectId: 'project-demo-001',
        currentProjectTitle: '校园植物观察手册',
        currentStage: 'reflection',
        progressPercent: 40,
        lastActivityAt: daysAgo(1),
        stuck: false,
        attentionCount: 0,
      },
      {
        studentId: 'student-demo-2',
        gradeLabel: '七年级',
        classLabel: '七年级二班',
        mentorId: 'teacher-demo-2',
        mentorName: '演示班主任二',
        activeProjectCount: 1,
        projectsCompleted: 0,
        currentProjectId: 'project-demo-002',
        currentProjectTitle: '天气数据小助手',
        currentStage: 'practice_building',
        progressPercent: 65,
        lastActivityAt: daysAgo(0),
        stuck: false,
        attentionCount: 0,
      },
      {
        studentId: 'student-demo-3',
        gradeLabel: '七年级',
        classLabel: '七年级一班',
        mentorId: 'teacher-demo',
        mentorName: '演示班主任',
        activeProjectCount: 1,
        projectsCompleted: 0,
        currentProjectId: 'project-demo-003',
        currentProjectTitle: '创意故事绘本',
        currentStage: 'theory_learning',
        progressPercent: 15,
        lastActivityAt: daysAgo(7),
        stuck: true,
        attentionCount: 1,
      },
      {
        studentId: 'student-demo-4',
        gradeLabel: '七年级',
        classLabel: '七年级二班',
        mentorId: 'teacher-demo-2',
        mentorName: '演示班主任二',
        activeProjectCount: 0,
        projectsCompleted: 0,
        currentProjectId: null,
        currentProjectTitle: null,
        currentStage: null,
        progressPercent: 0,
        lastActivityAt: null,
        stuck: false,
        attentionCount: 0,
      },
    ];

    // 教师名册（mentorId/studentIds 现在从 DirectoryService 取，这里保留仅为演示）
    this.teachers = [
      {
        teacherId: 'teacher-demo',
        studentIds: ['student-demo', 'student-demo-3'], // Sourced from DirectoryService.studentsOfMentor()
        classLabels: ['七年级一班'],
        pendingInterventionCount: 1,
        resolvedThisWeek: 2,
        lastActivityAt: daysAgo(1),
      },
      {
        teacherId: 'teacher-demo-2',
        studentIds: ['student-demo-2', 'student-demo-4'], // Sourced from DirectoryService.studentsOfMentor()
        classLabels: ['七年级二班'],
        pendingInterventionCount: 0,
        resolvedThisWeek: 1,
        lastActivityAt: daysAgo(0),
      },
    ];

    // 项目列表
    this.projects = [
      {
        projectId: 'project-demo-001',
        title: '校园植物观察手册',
        studentId: 'student-demo',
        stage: 'reflection',
        progressPercent: 40,
        updatedAt: daysAgo(1),
      },
      {
        projectId: 'project-demo-002',
        title: '天气数据小助手',
        studentId: 'student-demo-2',
        stage: 'practice_building',
        progressPercent: 65,
        updatedAt: daysAgo(0),
      },
      {
        projectId: 'project-demo-003',
        title: '创意故事绘本',
        studentId: 'student-demo-3',
        stage: 'theory_learning',
        progressPercent: 15,
        updatedAt: daysAgo(7),
      },
    ];

    // 介入请求
    this.interventions = [
      {
        id: 'intervention-001',
        studentId: 'student-demo-3',
        projectId: 'project-demo-003',
        reason: '学生已 7 天未与 AI搭档互动，可能遇到困难',
        status: 'open',
        createdAt: daysAgo(0),
        assigneeId: 'teacher-demo',
      },
      {
        id: 'intervention-002',
        studentId: 'student-demo',
        projectId: 'project-demo-001',
        reason: '学生连续三次在同一知识点卡顿',
        status: 'resolved',
        createdAt: daysAgo(5),
        assigneeId: 'teacher-demo',
      },
    ];

    // 家长端消息推送
    this.messages = [
      {
        id: 'message-001',
        childId: 'student-demo',
        kind: 'stage_update',
        title: '完成「理论闯关」阶段',
        summary: '小宇完成了项目的理论学习部分，准备开始动手实践。',
        occurredAt: daysAgo(4),
        status: 'resolved',
        projectTitle: '校园植物观察手册',
        hasFocus: false,
      },
      {
        id: 'message-002',
        childId: 'student-demo',
        kind: 'artifact',
        title: '发布了第一件作品',
        summary: '小宇发布了观察手册第 1 版，包含 6 种植物的记录。',
        occurredAt: daysAgo(2),
        status: 'resolved',
        projectTitle: '校园植物观察手册',
        hasFocus: false,
      },
      {
        id: 'message-003',
        childId: 'student-demo-3',
        kind: 'attention',
        title: '需要您关注',
        summary: '小满已 7 天未继续学习，可能需要您的鼓励。',
        occurredAt: daysAgo(0),
        status: 'pending_confirm',
        projectTitle: '创意故事绘本',
        hasFocus: true,
      },
    ];

    // 服务工单
    this.tickets = [
      {
        id: 'ticket-001',
        childId: 'student-demo',
        problem: '希望了解如何引导孩子更主动地提问',
        projectTitle: '校园植物观察手册',
        owner: '演示班主任',
        status: 'resolved',
        handledIn: '2小时15分钟',
        createdAt: daysAgo(3),
      },
    ];

    // 作品版本时间线
    this.versions = [
      {
        id: 'version-001',
        artifactRef: 'artifact-demo-001',
        at: daysAgo(6),
        title: '初稿：记录 3 种植物',
        note: '开始观察校园里的植物，记录了叶子形状和颜色。',
      },
      {
        id: 'version-002',
        artifactRef: 'artifact-demo-001',
        at: daysAgo(4),
        title: 'V2：补充生长环境',
        note: '在老师建议下，加上了每种植物喜欢的光照和水分。',
      },
      {
        id: 'version-003',
        artifactRef: 'artifact-demo-001',
        at: daysAgo(2),
        title: '发布版：6 种植物完整记录',
        note: '完成了 6 种植物的观察，每个都有照片和成长变化。',
      },
    ];

    // 作品成长标注
    this.workGrowth = [
      {
        artifactRef: 'artifact-demo-001',
        independently: [
          '选择了 6 种校园植物',
          '拍摄并整理了观察照片',
          '记录了每周的生长变化',
        ],
        withAiHelp: [
          '学习了观察记录的要素',
          '理解了光合作用的条件',
          '优化了记录表格的结构',
        ],
        nextPlan: [
          '加入季节变化的对比',
          '邀请同学一起扩充植物库',
        ],
      },
    ];
  }

  /* ==================== 学生数据 ==================== */

  /**
   * 演示内容层：只提供**还没有真实来源**的字段（项目、停滞、活跃时间等）。
   *
   * 身份（displayName/email）和班主任关系**不在这里**，一律由 DirectoryService 提供。
   * 这里原先有两个叫 `enrichStudentWithMentor` / `enrichTeacherWithStudents` 的方法，
   * 注释写着“已改为每次从 DirectoryService 查询”，实际实现是 `return { ...student }`
   * ——什么也没做。它们已删除；调用方现在直接向目录取身份与关系。
   */
  getStudent(studentId: string): DemoStudent | null {
    return this.students.find((s) => s.studentId === studentId) ?? null;
  }

  getAllStudents(): DemoStudent[] {
    return this.students;
  }

  /* ==================== 教师数据 ==================== */

  getTeacher(teacherId: string): DemoTeacher | null {
    return this.teachers.find((t) => t.teacherId === teacherId) ?? null;
  }

  getAllTeachers(): DemoTeacher[] {
    return this.teachers;
  }

  /* ==================== 项目数据 ==================== */

  getProjectsByStudent(studentId: string): DemoProject[] {
    return this.projects.filter((p) => p.studentId === studentId);
  }

  /* ==================== 介入请求 ==================== */

  getInterventionsByStudent(studentId: string): DemoIntervention[] {
    return this.interventions.filter((i) => i.studentId === studentId);
  }

  getInterventionsByTeacher(teacherId: string): DemoIntervention[] {
    return this.interventions.filter((i) => i.assigneeId === teacherId);
  }

  getAllInterventions(): DemoIntervention[] {
    return [...this.interventions];
  }

  /* ==================== 家长端消息 ==================== */

  getMessagesByChild(childId: string): DemoParentMessage[] {
    return this.messages.filter((m) => m.childId === childId);
  }

  getMessage(messageId: string): DemoParentMessage | null {
    return this.messages.find((m) => m.id === messageId) ?? null;
  }

  /** 确认消息（标记已读/暂不提醒）。 */
  ackMessage(messageId: string, action: 'read' | 'mute'): boolean {
    const message = this.messages.find((m) => m.id === messageId);
    if (message === undefined) return false;
    // 只对 pending_confirm/unread 且有 focus 的消息有效
    if (!message.hasFocus) return false;
    if (message.status !== 'pending_confirm' && message.status !== 'unread') return false;
    message.status = action === 'read' ? 'resolved' : 'processing';
    return true;
  }

  /* ==================== 服务工单 ==================== */

  getTicketsByChild(childId: string): DemoServiceTicket[] {
    return this.tickets.filter((t) => t.childId === childId);
  }

  /* ==================== 作品版本 ==================== */

  getVersions(artifactRef: string): DemoVersionStep[] {
    return this.versions.filter((v) => v.artifactRef === artifactRef);
  }

  getWorkGrowth(artifactRef: string): DemoWorkGrowth | null {
    return this.workGrowth.find((w) => w.artifactRef === artifactRef) ?? null;
  }

  /* ==================== 家长写操作 ==================== */

  /**
   * 记录家长鼓励。
   * 返回 null 表示幂等键冲突（已存在相同 key 的记录）。
   */
  recordEncouragement(
    parentId: string,
    childId: string,
    message: string,
    idempotencyKey: string,
  ): DemoEncouragement | null {
    // 幂等检查：同一 key 不得产生第二条记录
    const existing = this.encouragements.find((e) => e.idempotencyKey === idempotencyKey);
    if (existing !== undefined) return existing;

    const record: DemoEncouragement = {
      id: `encouragement-${this.encouragements.length + 1}`,
      parentId,
      childId,
      message,
      sentAt: new Date().toISOString(),
      delivered: false, // 家长给未成年人的留言不直接推送，由服务端决定何时呈现
      idempotencyKey,
    };
    this.encouragements.push(record);

    // 写审计日志
    this.auditLog.push({
      id: `audit-${this.auditLog.length + 1}`,
      actorId: parentId,
      action: 'encouragement',
      targetId: childId,
      idempotencyKey,
      at: record.sentAt,
    });

    return record;
  }

  /**
   * 提交家长反馈。
   * 返回 null 表示幂等键冲突。
   */
  recordFeedback(
    parentId: string,
    childId: string | null,
    source: 'general' | 'message' | 'project',
    content: string,
    messageId: string | null,
    projectId: string | null,
    idempotencyKey: string,
  ): DemoFeedback | null {
    const existing = this.feedbacks.find((f) => f.idempotencyKey === idempotencyKey);
    if (existing !== undefined) return existing;

    const record: DemoFeedback = {
      id: `feedback-${this.feedbacks.length + 1}`,
      parentId,
      childId,
      source,
      content,
      messageId,
      projectId,
      status: 'processing',
      createdAt: new Date().toISOString(),
      idempotencyKey,
    };
    this.feedbacks.push(record);

    this.auditLog.push({
      id: `audit-${this.auditLog.length + 1}`,
      actorId: parentId,
      action: 'feedback',
      targetId: childId,
      idempotencyKey,
      at: record.createdAt,
    });

    return record;
  }

  /* ==================== 统计 ==================== */

  getOverviewStats() {
    const activeProjects = this.projects.filter(
      (p) => p.stage !== 'completed' && p.stage !== 'published',
    );
    const stuckStudents = this.students.filter((s) => s.stuck);
    const pendingInterventions = this.interventions.filter((i) => i.status === 'open');
    const publishedArtifacts = this.projects.filter((p) => p.stage === 'published');

    return {
      studentCount: this.students.length,
      activeProjectCount: activeProjects.length,
      stuckStudentCount: stuckStudents.length,
      teacherCount: this.teachers.length,
      pendingInterventionCount: pendingInterventions.length,
      publishedArtifactCount: publishedArtifacts.length,
    };
  }
}
