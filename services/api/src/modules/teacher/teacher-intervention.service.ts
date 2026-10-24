import { ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { projectEvidence, projects, teacherSupportReceipts, users, type Database } from '@qitu/database';
import type { TeacherInterventionAction, TeacherInterventionRow } from '@qitu/contracts';
import { DATABASE_TOKEN } from '../../database';
import { AuditWriter } from '../../common/audit/audit.service';
import { DirectoryService } from '../directory/directory.service';

/** Projects own escalation facts; this service records only the teacher response. */
@Injectable()
export class TeacherInterventionService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database | null,
    private readonly directory: DirectoryService, private readonly audit: AuditWriter) {}

  async list(teacherId: string): Promise<TeacherInterventionRow[]> {
    const students = await this.directory.studentsOfMentor(teacherId);
    if (!students.length) return [];
    const rows = await this.database().select({
      id: projectEvidence.id, studentId: projectEvidence.studentUserId, name: users.displayName,
      projectId: projectEvidence.projectId, title: projects.title, at: projectEvidence.occurredAt,
      status: teacherSupportReceipts.status,
    }).from(projectEvidence).innerJoin(users, eq(users.id, projectEvidence.studentUserId))
      .innerJoin(projects, eq(projects.id, projectEvidence.projectId))
      .leftJoin(teacherSupportReceipts, eq(teacherSupportReceipts.evidenceId, projectEvidence.id))
      .where(and(inArray(projectEvidence.studentUserId, students.map(student => student.userId)),
        eq(projectEvidence.sourceKind, 'escalation_event'))).orderBy(desc(projectEvidence.occurredAt));
    const teacher = await this.directory.findUser(teacherId);
    return rows.map(row => ({ id: row.id, studentId: row.studentId, studentDisplayName: row.name,
      projectId: row.projectId, projectTitle: row.title, reason: '探究过程中有需要老师协助的步骤',
      status: supportStatus(row.status), createdAt: row.at.toISOString(), assigneeName: teacher?.displayName ?? null }));
  }

  async act(teacherId: string, id: string, action: TeacherInterventionAction, note: string | null) {
    const item = (await this.list(teacherId)).find(row => row.id === id);
    if (!item) throw missing();
    const next = action === 'resolve' ? 'resolved' : 'acknowledged';
    const saved = await this.database().transaction(async tx => {
      const [source] = await tx.select({ id: projectEvidence.id, studentId: projectEvidence.studentUserId }).from(projectEvidence)
        .where(and(eq(projectEvidence.id, id), eq(projectEvidence.sourceKind, 'escalation_event'))).for('update');
      if (!source || !(await this.directory.studentsOfMentor(teacherId)).some(student => student.userId === source.studentId)) throw missing();
      const [prior] = await tx.select().from(teacherSupportReceipts).where(eq(teacherSupportReceipts.evidenceId, id));
      if (prior?.status === next) return prior;
      if (prior?.status === 'resolved') throw new ConflictException({ code: 'INTERVENTION_ALREADY_RESOLVED', message: '此支持请求已处理完成' });
      const [record] = await tx.insert(teacherSupportReceipts).values({ evidenceId: id, teacherId, status: next, note })
        .onConflictDoUpdate({ target: teacherSupportReceipts.evidenceId, set: { teacherId, status: next, note, updatedAt: new Date() } }).returning();
      if (!record) throw new ServiceUnavailableException('处理回执读取失败');
      await this.audit.write({ actorId: teacherId, actorRole: 'teacher', action: 'teacher.intervention.action',
        targetType: 'project_evidence', targetId: id, detail: { studentId: item.studentId, action, noteLength: note?.length ?? 0 } }, tx);
      return record;
    });
    return { intervention: { ...item, status: supportStatus(saved.status) }, changedAt: saved.updatedAt.toISOString() };
  }
  private database() {
    if (!this.db) throw new ServiceUnavailableException({ code: 'TEACHER_INTERVENTIONS_UNAVAILABLE', message: '学习支持服务暂时无法读取' });
    return this.db;
  }
}
function supportStatus(value: string | null): TeacherInterventionRow['status'] {
  if (value === 'resolved' || value === 'acknowledged') return value;
  return 'open';
}
function missing() { return new NotFoundException({ code: 'INTERVENTION_NOT_FOUND', message: '学习支持请求不存在' }); }
