import {
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import type {
  AdminOverviewPageData,
  AdminStudentListPageData,
  AdminStudentDetail,
  AdminTeacherListPageData,
  AdminTeacherDetail,
  AdminSettingsIndexData,
  AdminStudentRow,
  AdminTeacherRow,
  AdminInterventionRow,
  AdminGrowthDigest,
  AdminStudentProject,
  AdminMentorOption,
  AdminSettingsPanel,
  AdminStudentFilter,
} from '@qitu/contracts';
import { requireRole } from '../../common/access/request-auth';
import { AuthService } from '../identity-auth/auth.service';
import { GrowthService } from '../growth/growth.service';
import { PlatformDataService } from '../platform-data/platform-data.service';
import { ModelRegistryService } from '../model-registry/model-registry.service';

/**
 * 平台管理后台接口。
 *
 * 六个端点（freeze-parent-admin.md §3）：
 *  - 概览（overview）
 *  - 学生列表与详情（students / students/:id）
 *  - 教师列表与详情（teachers / teachers/:id）
 *  - 设置索引（settings）
 *
 * 全部要求 `role === 'admin'`。
 * `dataSource` 一律返回 `'demo'`，界面必须如实标注「演示数据」。
 */
@Controller('admin')
export class AdminController {
  constructor(
    private readonly authService: AuthService,
    private readonly growthService: GrowthService,
    private readonly platformData: PlatformDataService,
    private readonly modelRegistry: ModelRegistryService,
  ) {}

  /* ==================== 概览 ==================== */

  @Get('overview')
  getOverview(@Headers('cookie') cookieHeader: string | undefined): { data: AdminOverviewPageData } {
    requireRole(this.authService, cookieHeader, 'admin', '管理后台仅向管理员开放');

    const stats = this.platformData.getOverviewStats();
    const allInterventions = this.platformData.getAllInterventions();

    // 最近的介入请求
    const recentInterventions: AdminInterventionRow[] = allInterventions
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, 5)
      .map((i) => this.toInterventionRow(i));

    return {
      data: {
        stats,
        recentInterventions,
        generatedAt: new Date().toISOString(),
        dataSource: 'demo',
      },
    };
  }

  /* ==================== 学生数据 ==================== */

  @Get('students')
  getStudents(
    @Headers('cookie') cookieHeader: string | undefined,
    @Query('filter') filter?: string,
    @Query('classLabel') classLabel?: string,
    @Query('mentorId') mentorId?: string,
    @Query('search') search?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limitStr?: string,
  ): { data: AdminStudentListPageData } {
    requireRole(this.authService, cookieHeader, 'admin', '管理后台仅向管理员开放');

    const validFilter = this.parseStudentFilter(filter);
    const limit = this.parseLimit(limitStr, 20, 100);

    // 筛选
    let students = this.platformData.getStudentsByFilter(validFilter);

    if (classLabel !== undefined && classLabel.length > 0) {
      students = students.filter((s) => s.classLabel === classLabel);
    }

    if (mentorId !== undefined && mentorId.length > 0) {
      students = students.filter((s) => s.mentorId === mentorId);
    }

    if (search !== undefined && search.length > 0) {
      const term = search.toLowerCase();
      students = students.filter(
        (s) =>
          s.displayName.toLowerCase().includes(term) ||
          s.email.toLowerCase().includes(term),
      );
    }

    // 排序：停滞优先，然后按活跃时间降序
    students.sort((a, b) => {
      if (a.stuck !== b.stuck) return a.stuck ? -1 : 1;
      if (a.lastActivityAt === null && b.lastActivityAt === null) return 0;
      if (a.lastActivityAt === null) return 1;
      if (b.lastActivityAt === null) return -1;
      return a.lastActivityAt < b.lastActivityAt ? 1 : -1;
    });

    // 分页
    let start = 0;
    if (cursor !== undefined && cursor.length > 0) {
      const index = students.findIndex((s) => s.studentId === cursor);
      start = index === -1 ? 0 : index + 1;
    }

    const page = students.slice(start, start + limit);
    const hasNext = start + limit < students.length;

    // 投影为行
    const items: AdminStudentRow[] = page.map((s) => ({
      studentId: s.studentId,
      displayName: s.displayName,
      email: s.email,
      gradeLabel: s.gradeLabel,
      classLabel: s.classLabel,
      mentorId: s.mentorId,
      mentorName: s.mentorName,
      activeProjectCount: s.activeProjectCount,
      projectsCompleted: s.projectsCompleted,
      currentProjectId: s.currentProjectId,
      currentProjectTitle: s.currentProjectTitle,
      currentStage: s.currentStage,
      progressPercent: s.progressPercent,
      lastActivityAt: s.lastActivityAt,
      stuck: s.stuck,
      attentionCount: s.attentionCount,
    }));

    // 全量计数（不受分页影响）
    const allStudents = this.platformData.getAllStudents();
    const totals = {
      all: allStudents.length,
      active: allStudents.filter((s) => s.activeProjectCount > 0).length,
      stuck: allStudents.filter((s) => s.stuck).length,
      noProject: allStudents.filter((s) => s.activeProjectCount === 0).length,
    };

    // 筛选选项
    const classOptions = [...new Set(allStudents.map((s) => s.classLabel).filter((c) => c !== null))] as string[];
    const mentors: AdminMentorOption[] = this.platformData
      .getAllTeachers()
      .map((t) => ({ mentorId: t.teacherId, displayName: t.displayName }));

    return {
      data: {
        items,
        nextCursor: hasNext && page.length > 0 ? page[page.length - 1]!.studentId : null,
        hasNext,
        totals,
        classOptions,
        mentors,
        dataSource: 'demo',
      },
    };
  }

  @Get('students/:studentId')
  getStudentDetail(
    @Headers('cookie') cookieHeader: string | undefined,
    @Param('studentId') studentId: string,
  ): { data: AdminStudentDetail } {
    requireRole(this.authService, cookieHeader, 'admin', '管理后台仅向管理员开放');

    const student = this.platformData.getStudent(studentId);
    if (student === null) {
      throw new NotFoundException('学生不存在');
    }

    // 成长记录（从 GrowthService 读取，投影为管理后台措辞）
    const timeline = this.growthService.getTimeline(studentId, {
      type: 'all',
      projectId: null,
      from: null,
      to: null,
      cursor: null,
      limit: 10,
    });

    const recentGrowth: AdminGrowthDigest[] = timeline.items.map((entry) => ({
      id: entry.id,
      occurredAt: entry.occurredAt,
      title: entry.title,
      summary: entry.summaryStudent, // 管理员看学生措辞
    }));

    // 介入请求
    const interventions = this.platformData
      .getInterventionsByStudent(studentId)
      .map((i) => this.toInterventionRow(i));

    // 项目列表
    const projects: AdminStudentProject[] = this.platformData
      .getProjectsByStudent(studentId)
      .map((p) => ({
        projectId: p.projectId,
        title: p.title,
        stage: p.stage,
        progressPercent: p.progressPercent,
        updatedAt: p.updatedAt,
      }));

    // 本周会话与时长（演示数据）
    const sessionsThisWeek = 4;
    const minutesThisWeek = 200;

    return {
      data: {
        student: {
          studentId: student.studentId,
          displayName: student.displayName,
          email: student.email,
          gradeLabel: student.gradeLabel,
          classLabel: student.classLabel,
          mentorId: student.mentorId,
          mentorName: student.mentorName,
          activeProjectCount: student.activeProjectCount,
          projectsCompleted: student.projectsCompleted,
          currentProjectId: student.currentProjectId,
          currentProjectTitle: student.currentProjectTitle,
          currentStage: student.currentStage,
          progressPercent: student.progressPercent,
          lastActivityAt: student.lastActivityAt,
          stuck: student.stuck,
          attentionCount: student.attentionCount,
        },
        recentGrowth,
        interventions,
        projects,
        sessionsThisWeek,
        minutesThisWeek,
      },
    };
  }

  /* ==================== 教师数据 ==================== */

  @Get('teachers')
  getTeachers(
    @Headers('cookie') cookieHeader: string | undefined,
    @Query('search') search?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limitStr?: string,
  ): { data: AdminTeacherListPageData } {
    requireRole(this.authService, cookieHeader, 'admin', '管理后台仅向管理员开放');

    const limit = this.parseLimit(limitStr, 20, 100);

    let teachers = this.platformData.getAllTeachers();

    // 搜索
    if (search !== undefined && search.length > 0) {
      const term = search.toLowerCase();
      teachers = teachers.filter(
        (t) =>
          t.displayName.toLowerCase().includes(term) ||
          t.email.toLowerCase().includes(term),
      );
    }

    // 排序：有待处理介入的优先，然后按活跃时间降序
    teachers.sort((a, b) => {
      if (a.pendingInterventionCount !== b.pendingInterventionCount) {
        return b.pendingInterventionCount - a.pendingInterventionCount;
      }
      if (a.lastActivityAt === null && b.lastActivityAt === null) return 0;
      if (a.lastActivityAt === null) return 1;
      if (b.lastActivityAt === null) return -1;
      return a.lastActivityAt < b.lastActivityAt ? 1 : -1;
    });

    // 分页
    let start = 0;
    if (cursor !== undefined && cursor.length > 0) {
      const index = teachers.findIndex((t) => t.teacherId === cursor);
      start = index === -1 ? 0 : index + 1;
    }

    const page = teachers.slice(start, start + limit);
    const hasNext = start + limit < teachers.length;

    // 计算停滞学生数
    const items: AdminTeacherRow[] = page.map((t) => {
      const students = this.platformData.getAllStudents().filter((s) => s.mentorId === t.teacherId);
      const stuckStudentCount = students.filter((s) => s.stuck).length;

      return {
        teacherId: t.teacherId,
        displayName: t.displayName,
        email: t.email,
        studentCount: t.studentIds.length,
        classLabels: t.classLabels,
        pendingInterventionCount: t.pendingInterventionCount,
        resolvedThisWeek: t.resolvedThisWeek,
        stuckStudentCount,
        lastActivityAt: t.lastActivityAt,
      };
    });

    // 全量计数
    const allTeachers = this.platformData.getAllTeachers();
    const totals = {
      all: allTeachers.length,
      withPendingIntervention: allTeachers.filter((t) => t.pendingInterventionCount > 0).length,
      idle: allTeachers.filter((t) => t.lastActivityAt === null).length,
    };

    return {
      data: {
        items,
        nextCursor: hasNext && page.length > 0 ? page[page.length - 1]!.teacherId : null,
        hasNext,
        totals,
        dataSource: 'demo',
      },
    };
  }

  @Get('teachers/:teacherId')
  getTeacherDetail(
    @Headers('cookie') cookieHeader: string | undefined,
    @Param('teacherId') teacherId: string,
  ): { data: AdminTeacherDetail } {
    requireRole(this.authService, cookieHeader, 'admin', '管理后台仅向管理员开放');

    const teacher = this.platformData.getTeacher(teacherId);
    if (teacher === null) {
      throw new NotFoundException('教师不存在');
    }

    // 该教师负责的学生
    const students = this.platformData
      .getAllStudents()
      .filter((s) => s.mentorId === teacherId)
      .map((s) => ({
        studentId: s.studentId,
        displayName: s.displayName,
        email: s.email,
        gradeLabel: s.gradeLabel,
        classLabel: s.classLabel,
        mentorId: s.mentorId,
        mentorName: s.mentorName,
        activeProjectCount: s.activeProjectCount,
        projectsCompleted: s.projectsCompleted,
        currentProjectId: s.currentProjectId,
        currentProjectTitle: s.currentProjectTitle,
        currentStage: s.currentStage,
        progressPercent: s.progressPercent,
        lastActivityAt: s.lastActivityAt,
        stuck: s.stuck,
        attentionCount: s.attentionCount,
      }));

    // 该教师的介入请求
    const interventions = this.platformData
      .getInterventionsByTeacher(teacherId)
      .map((i) => this.toInterventionRow(i));

    const stuckStudentCount = students.filter((s) => s.stuck).length;

    return {
      data: {
        teacher: {
          teacherId: teacher.teacherId,
          displayName: teacher.displayName,
          email: teacher.email,
          studentCount: teacher.studentIds.length,
          classLabels: teacher.classLabels,
          pendingInterventionCount: teacher.pendingInterventionCount,
          resolvedThisWeek: teacher.resolvedThisWeek,
          stuckStudentCount,
          lastActivityAt: teacher.lastActivityAt,
        },
        students,
        interventions,
      },
    };
  }

  /* ==================== 设置 ==================== */

  @Get('settings')
  getSettings(@Headers('cookie') cookieHeader: string | undefined): { data: AdminSettingsIndexData } {
    requireRole(this.authService, cookieHeader, 'admin', '管理后台仅向管理员开放');

    // 设置面板（只列出真实可用的）。
    // `route` 是相对 basePath（`/admin`）的子路由：前端用 `next/link` 跳转时
    // 会自动补 basePath，因此这里要写 `/settings/...` 而不是 `/admin/settings/...`。
    const panels: AdminSettingsPanel[] = [
      {
        id: 'model_slots',
        title: '模型插槽',
        description: '配置「文本模型」与「Live 模型」两个插槽的供应商、模型与密钥',
        route: '/settings/models',
        status: 'available',
      },
      {
        id: 'model_providers',
        title: '模型供应商',
        description: '配置 OpenAI、Anthropic 等 LLM 供应商的网关地址与密钥，并自动拉取模型列表',
        route: '/settings/model-providers',
        status: 'available',
      },
      {
        id: 'model_usages',
        title: '模型用途绑定',
        description: '为 AI搭档、灵感推荐、成长总结等用途指定模型',
        route: '/settings/model-usages',
        status: 'available',
      },
      {
        id: 'platform',
        title: '平台配置',
        description: '全局开关、功能门禁、安全策略',
        route: null,
        status: 'planned',
      },
      {
        id: 'security',
        title: '安全与合规',
        description: '未成年人数据保护、内容审核规则',
        route: null,
        status: 'planned',
      },
      {
        id: 'audit',
        title: '审计日志',
        description: '查看关键操作记录',
        route: null,
        status: 'planned',
      },
    ];

    // 已配置的供应商数与用途数（从 ModelRegistryService 读取）
    const providers = this.modelRegistry.listProviders();
    const usages = this.modelRegistry.getUsages();

    const configuredProviderCount = providers.providers.filter((p) => p.auth.configured).length;
    const configuredUsageCount = usages.bindings.filter((b) => b.resolved !== null).length;

    return {
      data: {
        panels,
        configuredProviderCount,
        configuredUsageCount,
        dataSource: 'demo',
      },
    };
  }

  /* ==================== 内部工具 ==================== */

  private toInterventionRow(intervention: {
    id: string;
    studentId: string;
    projectId: string | null;
    reason: string;
    status: 'open' | 'acknowledged' | 'resolved';
    createdAt: string;
    assigneeId: string | null;
  }): AdminInterventionRow {
    const student = this.platformData.getStudent(intervention.studentId);
    const project = intervention.projectId
      ? this.platformData.getProjectsByStudent(intervention.studentId).find((p) => p.projectId === intervention.projectId)
      : null;
    const assignee = intervention.assigneeId ? this.platformData.getTeacher(intervention.assigneeId) : null;

    return {
      id: intervention.id,
      studentId: intervention.studentId,
      studentDisplayName: student?.displayName ?? '未知学生',
      projectTitle: project?.title ?? null,
      reason: intervention.reason,
      status: intervention.status,
      createdAt: intervention.createdAt,
      assigneeName: assignee?.displayName ?? null,
    };
  }

  private parseStudentFilter(filter: string | undefined): AdminStudentFilter {
    if (filter === 'active' || filter === 'stuck' || filter === 'no_project') return filter;
    return 'all';
  }

  private parseLimit(limitStr: string | undefined, defaultLimit: number, maxLimit: number): number {
    const limit = limitStr === undefined ? defaultLimit : Number.parseInt(limitStr, 10);
    if (!Number.isFinite(limit) || limit <= 0) return defaultLimit;
    return Math.min(Math.floor(limit), maxLimit);
  }
}
