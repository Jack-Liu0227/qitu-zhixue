import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Query,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Database } from '@qitu/database';
import { artifacts, auditLogs, projects } from '@qitu/database';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { DATABASE_TOKEN } from '../../database';
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
import { AccessPolicy } from '../../common/access/access-policy';
import { AuthService } from '../identity-auth/auth.service';
import { GrowthService } from '../growth/growth.service';
import { PlatformDataService } from '../platform-data/platform-data.service';
import { ModelRegistryService } from '../model-registry/model-registry.service';
import { DirectoryService } from '../directory/directory.service';
import { AuditWriter } from '../../common/audit/audit.service';

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
 *
 * 边界（ADR 0008 / 产品文档 7.0）：管理员的默认视图是聚合与治理（概览、
 * 学生数据统计、关系绑定、设置），**不包含**个别学生的日常处理。
 * `students/:studentId` 属于「管理员个别学生访问」，按产品要求必须携带
 * 「对象级范围 + 最小字段 + 原因 + 二次确认 + 审计 + 限时」；这些能力尚未落地，
 * 因此这里通过 `AccessPolicy` fail closed（403），而不是默认放行。
 */
@Controller('admin')
export class AdminController {
  constructor(
    private readonly authService: AuthService,
    private readonly growthService: GrowthService,
    private readonly platformData: PlatformDataService,
    private readonly modelRegistry: ModelRegistryService,
    private readonly directory: DirectoryService,
    private readonly accessPolicy: AccessPolicy,
    private readonly audit: AuditWriter,
    @Inject(DATABASE_TOKEN) private readonly db: Database | null,
  ) {}

  /* ==================== 概览 ==================== */

  @Get('overview')
  async getOverview(
    @Headers('cookie') cookieHeader: string | undefined,
  ): Promise<{ data: AdminOverviewPageData }> {
    const admin = requireRole(this.authService, cookieHeader, 'admin', '管理后台仅向管理员开放');
    await this.auditRead(admin.id, 'admin.read.overview', 'admin-overview');
    const stats = this.db === null ? this.platformData.getOverviewStats() : await this.getLiveOverviewStats();
    const allInterventions = this.db === null ? this.platformData.getAllInterventions() : [];

    // 最近的介入请求。展示名从目录解析，否则这里会显示演示数据里的「小满」，
    // 而其他页面显示「演示学生三」——同一份数据两个名字。
    const recentInterventions: AdminInterventionRow[] = await Promise.all(
      allInterventions
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .slice(0, 5)
        .map((i) => this.toInterventionRow(i)),
    );

    return {
      data: {
        stats,
        recentInterventions,
        generatedAt: new Date().toISOString(),
        dataSource: this.dataSource(),
      },
    };
  }

  /* ==================== 学生数据 ==================== */

  @Get('students')
  async getStudents(
    @Headers('cookie') cookieHeader: string | undefined,
    @Query('filter') filter?: string,
    @Query('classLabel') classLabel?: string,
    @Query('mentorId') mentorId?: string,
    @Query('search') search?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limitStr?: string,
  ): Promise<{ data: AdminStudentListPageData }> {
    const admin = requireRole(this.authService, cookieHeader, 'admin', '管理后台仅向管理员开放');
    await this.auditRead(admin.id, 'admin.read.students', null);
    const validFilter = this.parseStudentFilter(filter);
    const limit = this.parseLimit(limitStr, 20, 100);

    let students = await this.listUnifiedStudents();

    // filter 参数与原来 platformData.getStudentsByFilter 的语义保持一致。
    if (validFilter === 'active') {
      students = students.filter((s) => s.activeProjectCount > 0);
    } else if (validFilter === 'stuck') {
      students = students.filter((s) => s.stuck);
    } else if (validFilter === 'no_project') {
      students = students.filter((s) => s.activeProjectCount === 0);
    }

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

    // 全量计数（不受分页影响），基于上面已合并统一的列表。
    const allStudents = await this.listUnifiedStudents();
    const totals = {
      all: allStudents.length,
      active: allStudents.filter((s) => s.activeProjectCount > 0).length,
      stuck: allStudents.filter((s) => s.stuck).length,
      noProject: allStudents.filter((s) => s.activeProjectCount === 0).length,
    };

    // 筛选选项
    const classOptions = [...new Set(allStudents.map((s) => s.classLabel).filter((c) => c !== null))] as string[];
    const mentors: AdminMentorOption[] = (await this.directory.listUsersByRole('teacher')).map(
      (t) => ({ mentorId: t.userId, displayName: t.displayName }),
    );

    return {
      data: {
        items,
        nextCursor: hasNext && page.length > 0 ? page[page.length - 1]!.studentId : null,
        hasNext,
        totals,
        classOptions,
        mentors,
        dataSource: this.dataSource(),
      },
    };
  }

  @Get('students/:studentId')
  async getStudentDetail(
    @Headers('cookie') cookieHeader: string | undefined,
    @Param('studentId') studentId: string,
  ): Promise<{ data: AdminStudentDetail }> {
    const admin = requireRole(this.authService, cookieHeader, 'admin', '管理后台仅向管理员开放');

    await this.auditRead(admin.id, 'admin.read.student.detail', studentId);

    // ADR 0008 决定 6 / 产品文档 7.0 / docs/admin/permissions.md §5：管理员读取个别学生
    // 数据是「显式动作」，需要「对象级范围 + 最小字段 + 原因 + 二次确认 + 审计 + 限时」。
    // 当前没有可持久化的授权与审计链路，所以这里调用唯一授权入口 fail closed：
    // 即使前端仍渲染了入口，后端也返回 403，且不因学生是否存在而改变响应（防枚举）。
    // 显式授权模型落地后，改 `canAdminReadIndividualStudent` 即可，此处无需改动。
    await this.accessPolicy.assertCanReadStudent(admin, studentId);

    // 用统一的合并列表，而不是 platformData.getStudent：
    // 后者取的是与目录无关的硬编码副本，会让详情页名字与列表页不一致。
    const student = (await this.listUnifiedStudents()).find((s) => s.studentId === studentId);
    if (student === undefined) {
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

    // 介入请求：live 尚无规范化介入表，不借用 demo 数据。
    const interventions = this.db === null
      ? await Promise.all(this.platformData.getInterventionsByStudent(studentId).map((i) => this.toInterventionRow(i)))
      : [];

    // 项目列表：live 从 PostgreSQL 读取，demo 才使用演示投影。
    const liveStudentProjects = this.db === null ? [] : (await this.getProjectsByStudent()).get(studentId) ?? [];
    const projects: AdminStudentProject[] = this.db === null
      ? this.platformData.getProjectsByStudent(studentId).map((p) => ({
          projectId: p.projectId, title: p.title, stage: p.stage,
          progressPercent: p.progressPercent, updatedAt: p.updatedAt,
        }))
      : liveStudentProjects.map((p) => ({
          projectId: p.id, title: p.title, stage: p.status as AdminStudentProject['stage'],
          progressPercent: p.progressPercent, updatedAt: p.createdAt.toISOString(),
        }));

    // 会话时长依赖尚未建成的 activity 聚合表；live 不借用 demo 数字。
    const sessionsThisWeek = this.db === null ? 4 : 0;
    const minutesThisWeek = this.db === null ? 200 : 0;

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
        dataSource: this.dataSource(),
      },
    };
  }

  /* ==================== 教师数据 ==================== */
  async getTeachers(
    @Headers('cookie') cookieHeader: string | undefined,
    @Query('search') search?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limitStr?: string,
  ): Promise<{ data: AdminTeacherListPageData }> {
    const admin = requireRole(this.authService, cookieHeader, 'admin', '管理后台仅向管理员开放');
    await this.auditRead(admin.id, 'admin.read.teachers', null);

    const limit = this.parseLimit(limitStr, 20, 100);

    // 同 listUnifiedStudents：教师身份来自目录，演示数据只补没有真实来源的字段。
    let teachers = await this.listUnifiedTeachers();

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

    // 停滞学生数已经在上面的合并里按目录名册算好了，这里不再重算。
    const items: AdminTeacherRow[] = page;

    // 全量计数：基于上面的统一列表，避免两套口径。
    const allTeachers = await this.listUnifiedTeachers();
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
        dataSource: this.dataSource(),
      },
    };
  }

  @Get('teachers/:teacherId')
  async getTeacherDetail(
    @Headers('cookie') cookieHeader: string | undefined,
    @Param('teacherId') teacherId: string,
  ): Promise<{ data: AdminTeacherDetail }> {
    const admin = requireRole(this.authService, cookieHeader, 'admin', '管理后台仅向管理员开放');
    await this.auditRead(admin.id, 'admin.read.teacher.detail', teacherId);

    const teacher = (await this.listUnifiedTeachers()).find((t) => t.teacherId === teacherId);
    if (teacher === undefined) {
      throw new NotFoundException('教师不存在');
    }

    // 该教师负责的学生：从目录名册筛，而不是演示数据的 mentorId 映射，
    // 否则这里的学生集合会与名册、与学生统计对不上。
    const students = (await this.listUnifiedStudents()).filter((s) => s.mentorId === teacherId);

    // 该教师的介入请求
    const interventions = this.db === null
      ? await Promise.all(this.platformData.getInterventionsByTeacher(teacherId).map((i) => this.toInterventionRow(i)))
      : [];

    const stuckStudentCount = teacher.stuckStudentCount;

    return {
      data: {
        teacher: {
          teacherId: teacher.teacherId,
          displayName: teacher.displayName,
          email: teacher.email,
          studentCount: teacher.studentCount,
          classLabels: teacher.classLabels,
          pendingInterventionCount: teacher.pendingInterventionCount,
          resolvedThisWeek: teacher.resolvedThisWeek,
          stuckStudentCount,
          lastActivityAt: teacher.lastActivityAt,
        },
        students,
        interventions,
        dataSource: this.dataSource(),
      },
    };
  }

  /* ==================== 设置 ==================== */
  getSettings(@Headers('cookie') cookieHeader: string | undefined): { data: AdminSettingsIndexData } {
    const admin = requireRole(this.authService, cookieHeader, 'admin', '管理后台仅向管理员开放');
    await this.auditRead(admin.id, 'admin.read.settings', 'admin-settings');

    // 设置面板（只列出真实可用的）。
    // `route` 是相对 basePath（`/admin`）的子路由：前端用 `next/link` 跳转时
    // 会自动补 basePath，因此这里要写 `/settings/...` 而不是 `/admin/settings/...`。
    const panels: AdminSettingsPanel[] = [
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
        dataSource: this.dataSource(),
      },
    };
  }

  @Get('audit-logs')
  async getAuditLogs(
    @Headers('cookie') cookieHeader: string | undefined,
    @Query('actorId') actorId?: string,
    @Query('targetType') targetType?: string,
    @Query('targetId') targetId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limitStr?: string,
  ) {
    const admin = requireRole(this.authService, cookieHeader, 'admin', '管理后台仅向管理员开放');
    if (this.db === null) throw new ServiceUnavailableException('审计查询不可用：未配置 DATABASE_URL');
    const limit = this.parseLimit(limitStr, 50, 200);
    const conditions = [
      actorId ? eq(auditLogs.actorId, actorId) : undefined,
      targetType ? eq(auditLogs.targetType, targetType) : undefined,
      targetId ? eq(auditLogs.targetId, targetId) : undefined,
      from ? gte(auditLogs.at, parseDate(from, 'from')) : undefined,
      to ? lte(auditLogs.at, parseDate(to, 'to')) : undefined,
      cursor ? lte(auditLogs.at, parseDate(cursor, 'cursor')) : undefined,
    ].filter((condition): condition is NonNullable<typeof condition> => condition !== undefined);
    const rows = await this.db.select().from(auditLogs).where(conditions.length ? and(...conditions) : undefined).orderBy(desc(auditLogs.at)).limit(limit + 1);
    await this.auditRead(admin.id, 'admin.read.audit_logs', null);
    const page = rows.slice(0, limit);
    return {
      data: {
        items: page.map((row) => ({ id: row.id, actorId: row.actorId, action: row.action, targetType: row.targetType, targetId: row.targetId, at: row.at.toISOString(), detail: row.detail })),
        nextCursor: rows.length > limit && page.length > 0 ? page[page.length - 1]!.at.toISOString() : null,
        hasNext: rows.length > limit,
        dataSource: 'live' as const,
      },
    };
  }



  private async toInterventionRow(intervention: {
    id: string;
    studentId: string;
    projectId: string | null;
    reason: string;
    status: 'open' | 'acknowledged' | 'resolved';
    createdAt: string;
    assigneeId: string | null;
  }): Promise<AdminInterventionRow> {
    // 学生与处理人的显示名来自目录；项目标题仍由演示数据提供。
    const [student, assignee] = await Promise.all([
      this.directory.findUser(intervention.studentId),
      intervention.assigneeId
        ? this.directory.findUser(intervention.assigneeId)
        : Promise.resolve(null),
    ]);
    const project = intervention.projectId
      ? this.platformData.getProjectsByStudent(intervention.studentId).find((p) => p.projectId === intervention.projectId)
      : null;

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

  /**
   * 管理后台的学生名册：**目录提供身份与班主任关系，演示数据只填充内容**。
   *
   * 这是「数据统一」的落点。从前这里直接列 `platformData.students`，而那份数据
   * 是与目录无关的硬编码副本，于是同一个学生在管理后台叫「小宇」、在教师名册和
   * 学生统计里叫「演示学生」。合并策略：
   *
   * 1. 集合 = 目录里的全部 student（目录里有的学生不会因为演示数据没写在名单里
   *    就消失）；
   * 2. displayName / email / mentor 一律取目录；
   * 3. 项目数、停滞、活跃时间等尚无真实来源的字段，按 studentId 从演示数据合并，
   *    缺失则为空值而不是报错。
   */
  /**
   * 管理后台的教师名册：同样的合并策略（目录提供身份与带生数，演示数据补内容）。
   * 列表、全量计数和详情三处共用，保证同一字段不会出现两套口径。
   */
  private async listUnifiedTeachers(): Promise<AdminTeacherRow[]> {
    const directoryTeachers = await this.directory.listUsersByRole('teacher');
    const demoTeachers = new Map(this.platformData.getAllTeachers().map((t) => [t.teacherId, t]));
    const demoStudents = this.platformData.getAllStudents();

    return Promise.all(
      directoryTeachers.map(async (u) => {
        const demo = demoTeachers.get(u.userId);
        // studentCount 取目录（当前班主任关系），而不是硬编码的 studentIds 列表。
        const students = await this.directory.studentsOfMentor(u.userId);
        const stuckStudentCount = students.filter(
          (s) => demoStudents.find((d) => d.studentId === s.userId)?.stuck === true,
        ).length;
        return {
          teacherId: u.userId,
          displayName: u.displayName,
          email: u.email,
          studentCount: students.length,
          classLabels: demo?.classLabels ?? [],
          pendingInterventionCount: this.db === null ? demo?.pendingInterventionCount ?? 0 : 0,
          resolvedThisWeek: this.db === null ? demo?.resolvedThisWeek ?? 0 : 0,
          stuckStudentCount: this.db === null ? stuckStudentCount : 0,
          lastActivityAt: this.db === null ? demo?.lastActivityAt ?? null : null,
        };
      }),
    );
  }

  private async listUnifiedStudents(): Promise<AdminStudentRow[]> {
    const directoryStudents = await this.directory.listUsersByRole('student');
    const demoContent = new Map(this.platformData.getAllStudents().map((s) => [s.studentId, s]));
    const activeAssignments = await this.directory.listMentorAssignments('active');
    const mentorByStudent = new Map(activeAssignments.map((a) => [a.student.userId, a.mentor]));
    const liveProjects = this.db === null ? new Map<string, typeof projects.$inferSelect[]>() : await this.getProjectsByStudent();

    return directoryStudents.map((u) => {
      const demo = demoContent.get(u.userId);
      const mentor = mentorByStudent.get(u.userId) ?? null;
      const rows = liveProjects.get(u.userId) ?? [];
      const active = rows.filter((p) => p.status !== 'completed' && p.status !== 'published');
      const completed = rows.filter((p) => p.status === 'completed' || p.status === 'published');
      const current = [...active].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
      const latestAt = rows.length === 0 ? null : new Date(Math.max(...rows.map((p) => p.createdAt.getTime()))).toISOString();
      return {
        studentId: u.userId,
        displayName: u.displayName,
        email: u.email,
        gradeLabel: demo?.gradeLabel ?? null,
        classLabel: demo?.classLabel ?? null,
        mentorId: mentor?.userId ?? null,
        mentorName: mentor?.displayName ?? null,
        activeProjectCount: this.db === null ? demo?.activeProjectCount ?? 0 : active.length,
        projectsCompleted: this.db === null ? demo?.projectsCompleted ?? 0 : completed.length,
        currentProjectId: this.db === null ? demo?.currentProjectId ?? null : current?.id ?? null,
        currentProjectTitle: this.db === null ? demo?.currentProjectTitle ?? null : current?.title ?? null,
        currentStage: this.db === null ? demo?.currentStage ?? null : (current?.status as AdminStudentRow['currentStage'] ?? null),
        progressPercent: this.db === null ? demo?.progressPercent ?? 0 : current?.progressPercent ?? 0,
        lastActivityAt: this.db === null ? demo?.lastActivityAt ?? null : latestAt,
        // interventions and inactivity signals have no normalized live table yet;
        // never import demo values into a live response.
        stuck: this.db === null ? demo?.stuck ?? false : false,
        attentionCount: this.db === null ? demo?.attentionCount ?? 0 : 0,
      };
    });
  }

  private async getProjectsByStudent(): Promise<Map<string, typeof projects.$inferSelect[]>> {
    if (this.db === null) return new Map();
    const rows = await this.db.select().from(projects);
    const grouped = new Map<string, typeof projects.$inferSelect[]>();
    for (const row of rows) grouped.set(row.studentUserId, [...(grouped.get(row.studentUserId) ?? []), row]);
    return grouped;
  }

  private async getLiveOverviewStats() {
    const students = await this.listUnifiedStudents();
    const teachers = await this.directory.listUsersByRole('teacher');
    const [published] = this.db === null ? [{ count: 0 }] : await this.db.select({ count: sql<number>`count(*)` }).from(artifacts).where(eq(artifacts.status, 'published'));
    return {
      studentCount: students.length,
      activeProjectCount: students.reduce((total, student) => total + student.activeProjectCount, 0),
      stuckStudentCount: 0,
      teacherCount: teachers.length,
      pendingInterventionCount: 0,
      publishedArtifactCount: Number(published?.count ?? 0),
    };
  }

  private async auditRead(actorId: string, action: string, targetId: string | null): Promise<void> {
    if (this.db === null) return;
    await this.audit.write({ actorId, actorRole: 'admin', action, targetType: targetId ? 'admin_resource' : 'admin_collection', targetId, detail: { purpose: 'governance_read' } });
  }

  private dataSource(): 'demo' | 'live' {
    return this.db === null ? 'demo' : 'live';
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

function parseDate(value: string, field: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new BadRequestException(`INVALID_${field.toUpperCase()}_DATE`);
  return date;
}
