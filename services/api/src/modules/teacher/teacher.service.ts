import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DirectoryService } from '../directory/directory.service';
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
} from '@qitu/contracts';

/**
 * Teacher service: roster, interventions, statistics.
 * All methods enforce object-level authorization — teacher may only access their assigned students.
 */
@Injectable()
export class TeacherService {
  constructor(private readonly directory: DirectoryService) {}

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

    // In demo mode, return minimal data
    return students.map((s) => ({
      studentId: s.userId,
      displayName: s.displayName,
      email: s.email,
      gradeLabel: null,
      classLabel: null,
      avatarInitial: s.displayName.charAt(0),
      activeProjectCount: 0,
      projectsCompleted: 0,
      currentProjectId: null,
      currentProjectTitle: null,
      currentStage: null,
      progressPercent: 0,
      lastActivityAt: null,
      stuck: false,
      attentionCount: 0,
      guardianCount: guardianCounts.get(s.userId) ?? 0,
      activeDays: 0,
      weeklyTasks: 0,
    }));
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
    const students = await this.directory.studentsOfMentor(teacherUserId);

    return {
      teacher,
      totals: {
        studentCount: students.length,
        activeStudentCount: 0,
        sessionsThisWeek: 0,
        minutesThisWeek: 0,
        tasksCompletedThisWeek: 0,
        openInterventions: 0,
      },
      weeklyActivity: [],
      stageDistribution: [],
      needsAttention: [],
      dataSource: 'demo',
    };
  }

}
