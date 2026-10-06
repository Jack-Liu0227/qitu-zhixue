import { ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { DirectoryService } from '../directory/directory.service';
import { PlatformDataService } from '../platform-data/platform-data.service';
import { TeamRuntimeService, type TeacherAgentRunProjection } from '../team-runtime/team-runtime.service';
import type {
  TeacherStudentRow,
  TeacherStudentDetail,
  TeacherInterventionRow,
  TeacherInterventionDetail,
  TeacherInterventionAction,
  TeacherInterventionActionResponse,
  TeacherStatisticsPageData,
  TeacherIdentity,
  TeacherGuardianRef,
  ProjectStage,
} from '@qitu/contracts';

/**
 * Teacher service: roster, interventions, statistics.
 * All methods enforce object-level authorization — teacher may only access their assigned students.
 */
@Injectable()
export class TeacherService {
  constructor(
    private readonly directory: DirectoryService,
    private readonly platformData: PlatformDataService,
    @Optional() private readonly teamRuntime?: TeamRuntimeService,
  ) {}

  /**
   * Assert that teacherUserId currently mentors studentUserId (active assignment).
   * Throws 403 if not assigned — no data leak.
   */
  async assertTeacherCanAccessStudent(teacherUserId: string, studentUserId: string): Promise<void> {
    const students = await this.directory.studentsOfMentor(teacherUserId);
    const assigned = students.some((s) => s.userId === studentUserId);
    if (!assigned) {
      throw new ForbiddenException({
        code: 'STUDENT_NOT_ASSIGNED',
        message: '您当前不是该学生的班主任',
      });
    }
  }

  /**
   * Get teacher identity.
   */
  async getTeacherIdentity(teacherUserId: string): Promise<TeacherIdentity> {
    const teacher = await this.directory.findUser(teacherUserId);
    if (!teacher) {
      throw new NotFoundException('教师不存在');
    }
    const students = await this.directory.studentsOfMentor(teacherUserId);
    return {
      teacherId: teacher.userId,
      displayName: teacher.displayName,
      email: teacher.email,
      studentCount: students.length,
    };
  }

  /**
   * Get all students currently assigned to this teacher.
   */
  async getRoster(teacherUserId: string): Promise<TeacherStudentRow[]> {
    const students = await this.directory.studentsOfMentor(teacherUserId);

    // 监护人数必须真算。之前这里是写死的 `guardianCount: 0`，于是教师端
    // 「尚无监护人接入」统计永远等于学生总数 —— 和管理后台的关系绑定页
    // 直接矛盾（那边明明显示已绑定）。这里一次取全部 active 关系再本地聚合，
    // 避免每个学生查一次库。
    const activeLinks = await this.directory.listGuardianLinks('active');
    const guardianCounts = new Map<string, number>();
    for (const link of activeLinks) {
      const studentId = link.student.userId;
      guardianCounts.set(studentId, (guardianCounts.get(studentId) ?? 0) + 1);
    }

    return students.map((s) => {
      const demo = this.platformData.getStudent(s.userId);
      const projects = this.platformData.getProjectsByStudent(s.userId);
      const activeProjects = projects.filter(
        (project) => project.stage !== 'completed' && project.stage !== 'published',
      );
      const current = activeProjects[0] ?? projects[0] ?? null;
      const activeDays = demo?.lastActivityAt
        ? isWithinDays(demo.lastActivityAt, 7)
          ? 1
          : 0
        : 0;
      return {
        studentId: s.userId,
        displayName: s.displayName,
        email: s.email,
        gradeLabel: demo?.gradeLabel ?? null,
        classLabel: demo?.classLabel ?? null,
        avatarInitial: s.displayName.charAt(0),
        activeProjectCount: demo?.activeProjectCount ?? activeProjects.length,
        projectsCompleted:
          demo?.projectsCompleted ?? projects.filter((project) => project.stage === 'completed' || project.stage === 'published').length,
        currentProjectId: current?.projectId ?? demo?.currentProjectId ?? null,
        currentProjectTitle: current?.title ?? demo?.currentProjectTitle ?? null,
        currentStage: current?.stage ?? demo?.currentStage ?? null,
        progressPercent: current?.progressPercent ?? demo?.progressPercent ?? 0,
        lastActivityAt: demo?.lastActivityAt ?? null,
        stuck: demo?.stuck ?? false,
        attentionCount: demo?.attentionCount ?? 0,
        guardianCount: guardianCounts.get(s.userId) ?? 0,
        activeDays,
        weeklyTasks: 0,
      };
    });
  }

  /**
   * Get detail for one student. Enforces object-level auth.
   */
  async getStudentDetail(teacherUserId: string, studentUserId: string): Promise<TeacherStudentDetail> {
    await this.assertTeacherCanAccessStudent(teacherUserId, studentUserId);

    const student = await this.directory.findUser(studentUserId);
    if (!student) {
      throw new NotFoundException('学生不存在');
    }

    const guardians = await this.directory.guardiansOfStudent(studentUserId);

    const studentRow: TeacherStudentRow = {
      studentId: student.userId,
      displayName: student.displayName,
      email: student.email,
      gradeLabel: null,
      classLabel: null,
      avatarInitial: student.displayName.charAt(0),
      activeProjectCount: 0,
      projectsCompleted: 0,
      currentProjectId: null,
      currentProjectTitle: null,
      currentStage: null,
      progressPercent: 0,
      lastActivityAt: null,
      stuck: false,
      attentionCount: 0,
      guardianCount: guardians.length,
      activeDays: 0,
      weeklyTasks: 0,
    };

    return {
      student: studentRow,
      projects: [],
      interventions: [],
      recentGrowth: [],
      guardians: guardians.map((g) => ({
        userId: g.userId,
        displayName: g.displayName,
        relationship: 'guardian' as any,
      })),
      sessionsThisWeek: 0,
      minutesThisWeek: 0,
    };
  }

  /** Return the latest server-owned Team Run for a currently assigned student. */
  async getStudentAgentRuns(
    teacherUserId: string,
    studentUserId: string,
  ): Promise<TeacherAgentRunProjection> {
    await this.assertTeacherCanAccessStudent(teacherUserId, studentUserId);
    if (this.teamRuntime !== undefined) {
      return this.teamRuntime.getLatestRunProjection(studentUserId);
    }
    return {
      runId: null,
      status: 'idle',
      nodes: [],
      activity: [],
      generatedAt: null,
    };
  }

  /**
   * List interventions for this teacher's students.
   */
  async listInterventions(teacherUserId: string): Promise<TeacherInterventionRow[]> {
    const students = await this.directory.studentsOfMentor(teacherUserId);

    // Demo: no interventions yet
    return [];
  }

  /**
   * Get one intervention detail. Enforces that the student is assigned to this teacher.
   */
  async getInterventionDetail(teacherUserId: string, interventionId: string): Promise<TeacherInterventionDetail> {
    // Demo: no interventions exist
    throw new NotFoundException('干预记录不存在');
  }

  /**
   * Record an action on an intervention.
   */
  async recordInterventionAction(
    teacherUserId: string,
    interventionId: string,
    action: TeacherInterventionAction,
  ): Promise<TeacherInterventionActionResponse> {
    // Demo: no interventions exist
    throw new NotFoundException('干预记录不存在');
  }

  /**
   * Get statistics for this teacher's roster.
   */
  async getStatistics(teacherUserId: string): Promise<TeacherStatisticsPageData> {
    const teacher = await this.getTeacherIdentity(teacherUserId);
    const students = await this.getRoster(teacherUserId);
    const assignedIds = new Set(students.map((student) => student.studentId));
    const projects = [...assignedIds].flatMap((studentId) =>
      this.platformData.getProjectsByStudent(studentId),
    );
    const stageDistribution = countStages(projects.map((project) => project.stage));
    const interventions = this.platformData
      .getInterventionsByTeacher(teacherUserId)
      .filter((intervention) => intervention.status !== 'resolved');
    const weeklyActivity = buildWeeklyActivity(students);

    return {
      teacher,
      totals: {
        studentCount: students.length,
        activeStudentCount: students.filter((student) => student.activeDays > 0).length,
        sessionsThisWeek: 0,
        minutesThisWeek: 0,
        tasksCompletedThisWeek: students.reduce((sum, student) => sum + student.weeklyTasks, 0),
        openInterventions: interventions.length,
      },
      weeklyActivity,
      stageDistribution,
      needsAttention: students.filter((student) => student.stuck || student.attentionCount > 0),
      dataSource: 'demo',
    };
  }
}

function isWithinDays(value: string, days: number): boolean {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return false;
  const age = Date.now() - timestamp;
  return age >= 0 && age <= days * 24 * 60 * 60 * 1000;
}

function countStages(stages: ProjectStage[]): { stage: ProjectStage; count: number }[] {
  const order: ProjectStage[] = [
    'exploration',
    'intent_confirmed',
    'theory_learning',
    'theory_check',
    'practice_ready',
    'practice_building',
    'artifact_review',
    'reflection',
    'published',
    'completed',
  ];
  return order
    .map((stage) => ({ stage, count: stages.filter((candidate) => candidate === stage).length }))
    .filter((item) => item.count > 0);
}

function buildWeeklyActivity(
  students: TeacherStudentRow[],
): { weekLabel: string; activeStudents: number; tasksCompleted: number }[] {
  const today = new Date();
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (6 - index));
    const key = date.toISOString().slice(0, 10);
    return {
      weekLabel: `${date.getMonth() + 1}/${date.getDate()}`,
      activeStudents: students.filter((student) => student.lastActivityAt?.slice(0, 10) === key).length,
      tasksCompleted: 0,
    };
  });
}
