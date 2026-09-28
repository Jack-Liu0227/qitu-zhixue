import { Inject, Injectable } from '@nestjs/common';
import { eq, and, sql } from 'drizzle-orm';
import type { Database } from '@qitu/database';
import { users, guardianLinks, mentorAssignments } from '@qitu/database';
import type {
  DirectoryPersonRef,
  GuardianLinkRow,
  MentorAssignmentRow,
  GuardianRelationship,
} from '@qitu/contracts';
import {
  DATABASE_TOKEN,
  DATABASE_TRANSACTION_TOKEN,
  DATA_MODE_TOKEN,
  DataModeError,
  type DataMode,
} from '../../database';

/**
 * Drizzle 事务句柄类型，直接从 `withTransaction()` 的签名推导。
 *
 * `createGuardianLink` 通过可选 `tx` 接收调用方事务，使关系写入与审计写入
 * 落在同一个事务里；不传时退回池化连接，保持既有调用兼容。
 */
export type DirectoryTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];

/** `DirectoryService` 能抛出的领域错误码（均为 `ApiErrorCode` 的子集）。 */
export type DirectoryErrorCode =
  | 'DIRECTORY_USER_NOT_FOUND'
  | 'RELATIONSHIP_ROLE_INVALID'
  | 'SELF_RELATIONSHIP_INVALID'
  | 'RELATIONSHIP_NOT_FOUND'
  | 'GUARDIAN_LINK_ALREADY_ACTIVE'
  | 'GUARDIAN_LINK_ENDED'
  | 'MENTOR_ALREADY_ASSIGNED';

/**
 * 目录层的领域错误。
 *
 * `message` 直接就是契约里的稳定错误码，由控制器统一翻译成 HTTP 状态码。
 * 这样做的原因：校验必须在**两个引擎之前**做一次，否则内存引擎和 Postgres
 * 引擎会各自漂移（内存引擎曾经静默存下 `parent: null`，而 Postgres 引擎因为
 * 外键约束直接抛 500）。
 */
export class DirectoryError extends Error {
  constructor(readonly code: DirectoryErrorCode) {
    super(code);
    this.name = 'DirectoryError';
  }
}

/** 合法的监护关系取值，与 `GuardianRelationship` 保持一致。 */
const GUARDIAN_RELATIONSHIPS: readonly string[] = ['mother', 'father', 'guardian'];

/**
 * DirectoryService: the SINGLE SOURCE OF TRUTH for identities and relationships.
 *
 * Replaces three contradictory hardcoded sources:
 * - auth.service.ts users[] (displayName "演示学生")
 * - platform-data.service.ts students[]/teachers[] (displayName "小宇")
 * - growth.service.ts PARENT_CHILDREN mapping
 *
 * Two engines behind ONE interface:
 * - Postgres engine (DATABASE_TOKEN is non-null; the only engine allowed in `live`)
 * - In-memory engine (mirrors seeded DB rows exactly; only when
 *   `QITU_DATA_MODE=demo|test`, non-production, and DATABASE_URL is absent)
 *
 * Selection: Postgres when DATABASE_TOKEN is non-null; otherwise memory.
 * `live` never reaches the memory branch — DatabaseModule fails fast instead.
 * Both engines MUST produce the same output shape so no app breaks when switching.
 */
@Injectable()
export class DirectoryService {
  constructor(
    @Inject(DATA_MODE_TOKEN) private readonly dataMode: DataMode,
    @Inject(DATABASE_TOKEN) private readonly db: Database | null,
    @Inject(DATABASE_TRANSACTION_TOKEN)
    private readonly withTransaction: typeof import('@qitu/database').withTransaction,
  ) {
    // 引擎选择处的兜底断言：live 绝不允许零持久化的内存引擎。正常 DI 路径下
    // DatabaseModule 已在 live 缺 DATABASE_URL 时 fail-fast，这里防止有人绕过模块
    // 直接注入 `null`，静默把正式环境切到内存数据。
    if (!this.db && this.dataMode === 'live') {
      throw new DataModeError(
        'live 数据模式不允许内存 Directory 引擎（DATABASE_TOKEN 为空）。' +
          ' live data mode must not use the in-memory Directory engine.',
      );
    }
  }

  /* ==================== User queries ==================== */

  async findUser(userId: string): Promise<DirectoryPersonRef | null> {
    if (this.db) {
      const rows = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (rows.length === 0) return null;
      return this.toPersonRef(rows[0]!);
    }
    return this.memory.findUser(userId);
  }

  async listUsersByRole(role: string): Promise<DirectoryPersonRef[]> {
    if (this.db) {
      const rows = await this.db.select().from(users).where(eq(users.role, role));
      return rows.map((r) => this.toPersonRef(r));
    }
    return this.memory.listUsersByRole(role);
  }

  /* ==================== Guardian ↔ Student ==================== */

  async guardiansOfStudent(studentId: string): Promise<DirectoryPersonRef[]> {
    if (this.db) {
      const links = await this.db
        .select({
          parentUserId: guardianLinks.parentUserId,
          parentEmail: users.email,
          parentDisplayName: users.displayName,
          parentRole: users.role,
        })
        .from(guardianLinks)
        .innerJoin(users, eq(guardianLinks.parentUserId, users.id))
        .where(and(eq(guardianLinks.studentUserId, studentId), eq(guardianLinks.status, 'active')));
      return links.map((link) => ({
        userId: link.parentUserId,
        email: link.parentEmail,
        displayName: link.parentDisplayName,
        role: link.parentRole as any,
      }));
    }
    return this.memory.guardiansOfStudent(studentId);
  }

  async childrenOfParent(parentUserId: string): Promise<DirectoryPersonRef[]> {
    if (this.db) {
      const links = await this.db
        .select({
          studentUserId: guardianLinks.studentUserId,
          studentEmail: users.email,
          studentDisplayName: users.displayName,
          studentRole: users.role,
        })
        .from(guardianLinks)
        .innerJoin(users, eq(guardianLinks.studentUserId, users.id))
        .where(and(eq(guardianLinks.parentUserId, parentUserId), eq(guardianLinks.status, 'active')));
      return links.map((link) => ({
        userId: link.studentUserId,
        email: link.studentEmail,
        displayName: link.studentDisplayName,
        role: link.studentRole as any,
      }));
    }
    return this.memory.childrenOfParent(parentUserId);
  }

  async listGuardianLinks(statusFilter: 'all' | 'active' | 'ended' = 'all'): Promise<GuardianLinkRow[]> {
    if (this.db) {
      // Fetch guardian links with status filter
      const links = await this.db
        .select()
        .from(guardianLinks)
        .where(statusFilter === 'all' ? sql`true` : eq(guardianLinks.status, statusFilter));

      // Fetch all user IDs we need
      const userIds = new Set<string>();
      links.forEach((link) => {
        userIds.add(link.parentUserId);
        userIds.add(link.studentUserId);
      });

      if (userIds.size === 0) return [];

      // Fetch users in one query
      const usersList = await this.db
        .select()
        .from(users)
        .where(sql`${users.id} = ANY(ARRAY[${sql.join(Array.from(userIds).map((id) => sql`${id}`), sql`, `)}])`);

      const usersMap = new Map(usersList.map((u) => [u.id, u]));

      // Join in memory
      return links
        .map((link) => {
          const parent = usersMap.get(link.parentUserId);
          const student = usersMap.get(link.studentUserId);
          if (!parent || !student) return null; // Skip links with missing users
          return {
            linkId: link.id,
            parent: {
              userId: link.parentUserId,
              email: parent.email,
              displayName: parent.displayName,
              role: parent.role as any,
            },
            student: {
              userId: link.studentUserId,
              email: student.email,
              displayName: student.displayName,
              role: student.role as any,
            },
            relationship: link.relationship as GuardianRelationship,
            status: link.status as any,
            createdAt: link.createdAt.toISOString(),
            endedAt: link.endedAt ? link.endedAt.toISOString() : null,
          };
        })
        .filter((link): link is GuardianLinkRow => link !== null);
    }
    return this.memory.listGuardianLinks(statusFilter);
  }

  /* ==================== Mentor ↔ Student ==================== */

  async mentorOfStudent(studentId: string): Promise<DirectoryPersonRef | null> {
    if (this.db) {
      const assignments = await this.db
        .select({
          mentorUserId: mentorAssignments.mentorUserId,
          mentorEmail: users.email,
          mentorDisplayName: users.displayName,
          mentorRole: users.role,
        })
        .from(mentorAssignments)
        .innerJoin(users, eq(mentorAssignments.mentorUserId, users.id))
        .where(
          and(eq(mentorAssignments.studentUserId, studentId), eq(mentorAssignments.status, 'active')),
        )
        .limit(1);
      if (assignments.length === 0) return null;
      const a = assignments[0]!;
      return { userId: a.mentorUserId, email: a.mentorEmail, displayName: a.mentorDisplayName, role: a.mentorRole as any };
    }
    return this.memory.mentorOfStudent(studentId);
  }

  /**
   * 按邮箱取认证凭据（用户身份 + 口令哈希）。
   *
   * 口令哈希是敏感字段，`DirectoryPersonRef` 故意不含它；需要认证时走这个方法，
   * 而不是把哈希扩散进通用的人员投影里。
   */
  async findCredentialByEmail(
    email: string,
  ): Promise<{ user: DirectoryPersonRef; passwordHash: string } | null> {
    if (this.db) {
      // 邮箱唯一索引建在 lower(email) 上，所以这里也用 lower() 比较，
      // 否则大小写不同的输入会绕开索引。
      const rows = await this.db
        .select()
        .from(users)
        .where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      return { user: this.toPersonRef(row), passwordHash: row.passwordHash };
    }
    return this.memory.findCredentialByEmail(email);
  }

  async studentsOfMentor(mentorId: string): Promise<DirectoryPersonRef[]> {
    if (this.db) {
      const assignments = await this.db
        .select({
          studentUserId: mentorAssignments.studentUserId,
          studentEmail: users.email,
          studentDisplayName: users.displayName,
          studentRole: users.role,
        })
        .from(mentorAssignments)
        .innerJoin(users, eq(mentorAssignments.studentUserId, users.id))
        .where(and(eq(mentorAssignments.mentorUserId, mentorId), eq(mentorAssignments.status, 'active')));
      return assignments.map((a) => ({
        userId: a.studentUserId,
        email: a.studentEmail,
        displayName: a.studentDisplayName,
        role: a.studentRole as any,
      }));
    }
    return this.memory.studentsOfMentor(mentorId);
  }

  async unassignedStudents(): Promise<DirectoryPersonRef[]> {
    if (this.db) {
      const allStudents = await this.db.select().from(users).where(eq(users.role, 'student'));
      const activeAssignments = await this.db
        .select({ studentUserId: mentorAssignments.studentUserId })
        .from(mentorAssignments)
        .where(eq(mentorAssignments.status, 'active'));
      const assignedIds = new Set(activeAssignments.map((a) => a.studentUserId));
      return allStudents.filter((s) => !assignedIds.has(s.id)).map((s) => this.toPersonRef(s));
    }
    return this.memory.unassignedStudents();
  }

  async listMentorAssignments(statusFilter: 'all' | 'active' | 'ended' = 'all'): Promise<MentorAssignmentRow[]> {
    if (this.db) {
      // Fetch assignments with status filter
      const assignments = await this.db
        .select()
        .from(mentorAssignments)
        .where(statusFilter === 'all' ? sql`true` : eq(mentorAssignments.status, statusFilter));

      // Fetch all user IDs we need
      const userIds = new Set<string>();
      assignments.forEach((a) => {
        userIds.add(a.studentUserId);
        userIds.add(a.mentorUserId);
      });

      if (userIds.size === 0) return [];

      // Fetch users in one query
      const usersList = await this.db
        .select()
        .from(users)
        .where(sql`${users.id} = ANY(ARRAY[${sql.join(Array.from(userIds).map((id) => sql`${id}`), sql`, `)}])`);

      const usersMap = new Map(usersList.map((u) => [u.id, u]));

      // Join in memory
      return assignments
        .map((assignment) => {
          const student = usersMap.get(assignment.studentUserId);
          const mentor = usersMap.get(assignment.mentorUserId);
          if (!student || !mentor) return null; // Skip assignments with missing users
          return {
            assignmentId: assignment.id,
            student: {
              userId: assignment.studentUserId,
              email: student.email,
              displayName: student.displayName,
              role: student.role as any,
            },
            mentor: {
              userId: assignment.mentorUserId,
              email: mentor.email,
              displayName: mentor.displayName,
              role: mentor.role as any,
            },
            status: assignment.status as any,
            assignedAt: assignment.assignedAt.toISOString(),
            endedAt: assignment.endedAt ? assignment.endedAt.toISOString() : null,
          };
        })
        .filter((assignment): assignment is MentorAssignmentRow => assignment !== null);
    }
    return this.memory.listMentorAssignments(statusFilter);
  }

  /* ==================== Writes ==================== */

  /**
   * 绑定前的公共校验。两个引擎共用，避免行为漂移。
   *
   * 顺序有讲究：先查“自己绑自己”，再查存在性，最后查角色。
   * 若先查存在性，`parentUserId === studentUserId` 这种明显更该报自绑的请求
   * 会在角色校验处报成“角色不符”，前端拿到的错误码就指错了方向。
   */
  private async assertDistinctUsers(userIdA: string, userIdB: string): Promise<void> {
    if (userIdA === userIdB) {
      throw new DirectoryError('SELF_RELATIONSHIP_INVALID');
    }
  }

  private async requireUserOfRole(userId: string, role: string): Promise<DirectoryPersonRef> {
    const user = await this.findUser(userId);
    if (!user) {
      throw new DirectoryError('DIRECTORY_USER_NOT_FOUND');
    }
    if (user.role !== role) {
      throw new DirectoryError('RELATIONSHIP_ROLE_INVALID');
    }
    return user;
  }

  /**
   * 把 Postgres 的约束违约翻译成契约错误码。
   *
   * 上面的预检已经拦住了绝大部分情况，这里是并发下的兼底：两个请求同时通过
   * 预检时，只能靠数据库唯一索引判定谁输，而这不应该表现为 500。
   */
  private translateDbError(error: unknown, conflictCode: DirectoryErrorCode): never {
    const pgCode = (error as { code?: string } | null)?.code;
    if (pgCode === '23505') {
      throw new DirectoryError(conflictCode);
    }
    if (pgCode === '23503') {
      throw new DirectoryError('DIRECTORY_USER_NOT_FOUND');
    }
    throw error;
  }

  async createGuardianLink(
    parentUserId: string,
    studentUserId: string,
    relationship: GuardianRelationship,
    idempotencyKey: string,
    tx?: DirectoryTransaction,
  ): Promise<GuardianLinkRow> {
    await this.assertDistinctUsers(parentUserId, studentUserId);
    const parent = await this.requireUserOfRole(parentUserId, 'parent');
    const student = await this.requireUserOfRole(studentUserId, 'student');
    if (!GUARDIAN_RELATIONSHIPS.includes(relationship)) {
      throw new DirectoryError('RELATIONSHIP_ROLE_INVALID');
    }

    const active = await this.listGuardianLinks('active');
    if (
      active.some(
        (l) => l.parent.userId === parentUserId && l.student.userId === studentUserId,
      )
    ) {
      throw new DirectoryError('GUARDIAN_LINK_ALREADY_ACTIVE');
    }

    if (this.db) {
      const linkId = `guardian-link-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const createdAt = new Date();
      const executor = tx ?? this.db;
      try {
        await executor.insert(guardianLinks).values({
          id: linkId,
          parentUserId,
          studentUserId,
          relationship,
          status: 'active',
          createdAt,
        });
      } catch (error) {
        this.translateDbError(error, 'GUARDIAN_LINK_ALREADY_ACTIVE');
      }

      if (tx) {
        return {
          linkId,
          parent,
          student,
          relationship,
          status: 'active',
          createdAt: createdAt.toISOString(),
          endedAt: null,
        };
      }

      const created = (await this.listGuardianLinks('all')).find((l) => l.linkId === linkId);
      if (!created) {
        throw new DirectoryError('RELATIONSHIP_NOT_FOUND');
      }
      return created;
    }
    return this.memory.createGuardianLink(parentUserId, studentUserId, relationship, idempotencyKey);
  }

  /**
   * 更新监护关系中的 `relationship`。
   *
   * 传入 `tx` 时，UPDATE 落在调用方事务内；并且**不在事务内回读**——回读会走
   * 连接池里的另一条连接，看不到尚未提交的行，最终拿到 `undefined`。此时直接
   * 用已查询到的 `existing` 覆盖 `relationship` 构造返回，保证事务参与者拿到
   * 一致结果。不传 `tx` 时保持旧行为（提交后回读），内存引擎不受影响。
   */
  async updateGuardianLink(
    linkId: string,
    relationship: GuardianRelationship,
    tx?: DirectoryTransaction,
  ): Promise<GuardianLinkRow> {
    if (!GUARDIAN_RELATIONSHIPS.includes(relationship)) {
      throw new DirectoryError('RELATIONSHIP_ROLE_INVALID');
    }
    const existing = (await this.listGuardianLinks('all')).find((l) => l.linkId === linkId);
    if (!existing) {
      throw new DirectoryError('RELATIONSHIP_NOT_FOUND');
    }
    if (existing.status === 'ended') {
      throw new DirectoryError('GUARDIAN_LINK_ENDED');
    }

    if (this.db) {
      const executor = tx ?? this.db;
      await executor
        .update(guardianLinks)
        .set({ relationship })
        .where(eq(guardianLinks.id, linkId));

      if (tx) {
        return { ...existing, relationship };
      }

      const updated = (await this.listGuardianLinks('all')).find((l) => l.linkId === linkId);
      if (!updated) {
        throw new DirectoryError('RELATIONSHIP_NOT_FOUND');
      }
      return updated;
    }
    return this.memory.updateGuardianLink(linkId, relationship);
  }

  /**
   * 结束监护关系（`status = ended` + `endedAt`），保留历史记录而非物理删除。
   *
   * 传入 `tx` 时，UPDATE 落在调用方事务内；并且**不在事务内回读**——回读会走
   * 连接池里的另一条连接，看不到尚未提交的行，最终拿到 `undefined`。此时直接
   * 用已查询到的 `existing` 覆盖 `status` / `endedAt` 构造返回，保证事务参与者
   * 拿到一致结果。不传 `tx` 时保持旧行为（提交后回读），内存引擎不受影响。
   *
   * 已结束的关系按业务错误处理（`GUARDIAN_LINK_ENDED`，控制器映射为 409），
   * 而不是再 UPDATE 一次 `endedAt` 伪造成功——结束是不可逆的状态转换，重复结束
   * 同一关系应显式失败；同一 Idempotency-Key 的重放由 IdempotencyStore 兜住，
   * 不会进入这里。
   */
  async endGuardianLink(
    linkId: string,
    reason: string | null,
    tx?: DirectoryTransaction,
  ): Promise<GuardianLinkRow> {
    const existing = (await this.listGuardianLinks('all')).find((l) => l.linkId === linkId);
    if (!existing) {
      throw new DirectoryError('RELATIONSHIP_NOT_FOUND');
    }
    if (existing.status === 'ended') {
      throw new DirectoryError('GUARDIAN_LINK_ENDED');
    }

    if (this.db) {
      const endedAt = new Date();
      const executor = tx ?? this.db;
      await executor
        .update(guardianLinks)
        .set({ status: 'ended', endedAt })
        .where(eq(guardianLinks.id, linkId));

      if (tx) {
        return { ...existing, status: 'ended', endedAt: endedAt.toISOString() };
      }

      const ended = (await this.listGuardianLinks('all')).find((l) => l.linkId === linkId);
      if (!ended) {
        throw new DirectoryError('RELATIONSHIP_NOT_FOUND');
      }
      return ended;
    }
    return this.memory.endGuardianLink(linkId, reason);
  }

  async createMentorAssignment(
    studentUserId: string,
    mentorUserId: string,
    idempotencyKey: string,
    tx?: DirectoryTransaction,
  ): Promise<MentorAssignmentRow> {
    await this.assertDistinctUsers(studentUserId, mentorUserId);
    const student = await this.requireUserOfRole(studentUserId, 'student');
    const mentor = await this.requireUserOfRole(mentorUserId, 'teacher');

    const active = await this.listMentorAssignments('active');
    if (active.some((a) => a.student.userId === studentUserId)) {
      throw new DirectoryError('MENTOR_ALREADY_ASSIGNED');
    }

    if (this.db) {
      const assignmentId = `mentor-assign-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const assignedAt = new Date();
      const executor = tx ?? this.db;
      try {
        await executor.insert(mentorAssignments).values({
          id: assignmentId,
          studentUserId,
          mentorUserId,
          status: 'active',
          assignedAt,
        });
      } catch (error) {
        this.translateDbError(error, 'MENTOR_ALREADY_ASSIGNED');
      }

      if (tx) {
        return {
          assignmentId,
          student,
          mentor,
          status: 'active',
          assignedAt: assignedAt.toISOString(),
          endedAt: null,
        };
      }

      const created = (await this.listMentorAssignments('all')).find(
        (a) => a.assignmentId === assignmentId,
      );
      if (!created) {
        throw new DirectoryError('RELATIONSHIP_NOT_FOUND');
      }
      return created;
    }
    return this.memory.createMentorAssignment(studentUserId, mentorUserId, idempotencyKey);
  }

  async endMentorAssignment(
    assignmentId: string,
    reason: string | null,
    tx?: DirectoryTransaction,
  ): Promise<MentorAssignmentRow> {
    const existing = (await this.listMentorAssignments('all')).find(
      (a) => a.assignmentId === assignmentId,
    );
    if (!existing) {
      throw new DirectoryError('RELATIONSHIP_NOT_FOUND');
    }
    if (existing.status === 'ended') {
      throw new DirectoryError('RELATIONSHIP_NOT_FOUND');
    }

    if (this.db) {
      const endedAt = new Date();
      const executor = tx ?? this.db;
      await executor
        .update(mentorAssignments)
        .set({ status: 'ended', endedAt })
        .where(eq(mentorAssignments.id, assignmentId));

      if (tx) {
        return { ...existing, status: 'ended', endedAt: endedAt.toISOString() };
      }

      const ended = (await this.listMentorAssignments('all')).find(
        (a) => a.assignmentId === assignmentId,
      );
      if (!ended) {
        throw new DirectoryError('RELATIONSHIP_NOT_FOUND');
      }
      return ended;
    }
    return this.memory.endMentorAssignment(assignmentId, reason);
  }

  /**
   * 原子转交班主任：同一事务内结束旧 active 关系并建立新 active 关系。
   *
   * 可选 `tx` 供控制器把「关系写入 + 审计写入」放进同一个事务。
   * 不传 `tx` 时保持既有兼容行为：自行开启事务并在提交后回读。
   */
  async transferMentor(
    studentUserId: string,
    newMentorUserId: string,
    reason: string | null,
    idempotencyKey: string,
    tx?: DirectoryTransaction,
  ): Promise<{ ended: MentorAssignmentRow; created: MentorAssignmentRow }> {
    await this.assertDistinctUsers(studentUserId, newMentorUserId);
    const student = await this.requireUserOfRole(studentUserId, 'student');
    const newMentor = await this.requireUserOfRole(newMentorUserId, 'teacher');

    const db = this.db;
    if (db) {
      const runTransfer = async (executor: DirectoryTransaction) => {
        const current = await executor
          .select()
          .from(mentorAssignments)
          .where(
            and(
              eq(mentorAssignments.studentUserId, studentUserId),
              eq(mentorAssignments.status, 'active'),
            ),
          )
          .limit(1);
        const currentRow = current[0];
        if (!currentRow) {
          throw new DirectoryError('RELATIONSHIP_NOT_FOUND');
        }

        const oldMentorRows = await executor
          .select()
          .from(users)
          .where(eq(users.id, currentRow.mentorUserId))
          .limit(1);
        const oldMentorRow = oldMentorRows[0];
        if (!oldMentorRow) {
          throw new DirectoryError('DIRECTORY_USER_NOT_FOUND');
        }

        const endedAt = new Date();
        await executor
          .update(mentorAssignments)
          .set({ status: 'ended', endedAt })
          .where(eq(mentorAssignments.id, currentRow.id));

        const newId = `mentor-assign-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const assignedAt = new Date();
        await executor.insert(mentorAssignments).values({
          id: newId,
          studentUserId,
          mentorUserId: newMentorUserId,
          status: 'active',
          assignedAt,
        });

        return { currentRow, oldMentor: this.toPersonRef(oldMentorRow), endedAt, newId, assignedAt };
      };

      if (tx) {
        const { currentRow, oldMentor, endedAt, newId, assignedAt } = await runTransfer(tx);
        return {
          ended: {
            assignmentId: currentRow.id,
            student,
            mentor: oldMentor,
            status: 'ended',
            assignedAt: currentRow.assignedAt.toISOString(),
            endedAt: endedAt.toISOString(),
          },
          created: {
            assignmentId: newId,
            student,
            mentor: newMentor,
            status: 'active',
            assignedAt: assignedAt.toISOString(),
            endedAt: null,
          },
        };
      }

      const ids = await this.withTransaction(db, async (executor) => runTransfer(executor));
      const all = await this.listMentorAssignments('all');
      const ended = all.find((a) => a.assignmentId === ids.currentRow.id);
      const created = all.find((a) => a.assignmentId === ids.newId);
      if (!ended || !created) {
        throw new DirectoryError('RELATIONSHIP_NOT_FOUND');
      }
      return { ended, created };
    }
    return this.memory.transferMentor(studentUserId, newMentorUserId, reason, idempotencyKey);
  }

  /* ==================== Internal ==================== */

  private toPersonRef(row: {
    id: string;
    email: string;
    displayName: string;
    role: string;
  }): DirectoryPersonRef {
    return {
      userId: row.id,
      email: row.email,
      displayName: row.displayName,
      role: row.role as any,
    };
  }

  private memory = new InMemoryDirectory();
}

/**
 * In-memory directory engine: mirrors the seeded DB rows exactly.
 * Used only when `QITU_DATA_MODE=demo|test` in non-production and DATABASE_URL
 * is absent. `live` fails fast instead of falling back here. All pre-existing
 * endpoints must behave identically with this engine vs. the Postgres engine.
 */
class InMemoryDirectory {
  private users: Array<{ id: string; email: string; displayName: string; role: string }> = [
    { id: 'student-demo', email: 'student@qtzx.local', displayName: '演示学生', role: 'student' },
    { id: 'student-demo-2', email: 'student2@qtzx.local', displayName: '演示学生二', role: 'student' },
    { id: 'student-demo-3', email: 'student3@qtzx.local', displayName: '演示学生三', role: 'student' },
    { id: 'student-demo-4', email: 'student4@qtzx.local', displayName: '演示学生四', role: 'student' },
    { id: 'parent-demo', email: 'parent@qtzx.local', displayName: '演示家长', role: 'parent' },
    { id: 'parent-demo-2', email: 'parent2@qtzx.local', displayName: '演示家长二', role: 'parent' },
    { id: 'teacher-demo', email: 'teacher@qtzx.local', displayName: '演示班主任', role: 'teacher' },
    { id: 'teacher-demo-2', email: 'teacher2@qtzx.local', displayName: '演示班主任二', role: 'teacher' },
    { id: 'admin-demo', email: 'admin@qtzx.local', displayName: '演示管理员', role: 'admin' },
  ];

  /**
   * 认证凭据镜像，与 `database/seeds/demo-identities.sql` 的 password_hash 逐字一致
   * （sha256 十六进制）。
   *
   * 放在目录里而不是 auth.service.ts，是为了让两种引擎都从同一个入口取凭据：
   * Postgres 引擎读 users.password_hash，内存引擎读这张镜像。从前 auth 自带一份
   * 硬编码表，结果是「数据库里新增的用户永远登不进来」，而且改口令要改两处。
   */
  private credentials: Record<string, string> = {
    'student@qtzx.local': '703b0a3d6ad75b649a28adde7d83c6251da457549263bc7ff45ec709b0a8448b',
    'student2@qtzx.local': '703b0a3d6ad75b649a28adde7d83c6251da457549263bc7ff45ec709b0a8448b',
    'student3@qtzx.local': '703b0a3d6ad75b649a28adde7d83c6251da457549263bc7ff45ec709b0a8448b',
    'student4@qtzx.local': '703b0a3d6ad75b649a28adde7d83c6251da457549263bc7ff45ec709b0a8448b',
    'parent@qtzx.local': '82e3edf5f5f3a46b5f94579b61817fd9a1f356adcef5ee22da3b96ef775c4860',
    'parent2@qtzx.local': '82e3edf5f5f3a46b5f94579b61817fd9a1f356adcef5ee22da3b96ef775c4860',
    'teacher@qtzx.local': 'cde383eee8ee7a4400adf7a15f716f179a2eb97646b37e089eb8d6d04e663416',
    'teacher2@qtzx.local': 'cde383eee8ee7a4400adf7a15f716f179a2eb97646b37e089eb8d6d04e663416',
    'admin@qtzx.local': '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9',
  };

  findCredentialByEmail(
    email: string,
  ): { user: DirectoryPersonRef; passwordHash: string } | null {
    const normalized = email.toLowerCase();
    const user = this.users.find((u) => u.email.toLowerCase() === normalized);
    const passwordHash = this.credentials[normalized];
    if (!user || !passwordHash) return null;
    return {
      user: {
        userId: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role as DirectoryPersonRef['role'],
      },
      passwordHash,
    };
  }

  private guardianLinks: GuardianLinkRow[] = [
    {
      linkId: 'guardian-link-1',
      parent: { userId: 'parent-demo', email: 'parent@qtzx.local', displayName: '演示家长', role: 'parent' },
      student: { userId: 'student-demo', email: 'student@qtzx.local', displayName: '演示学生', role: 'student' },
      relationship: 'guardian',
      status: 'active',
      createdAt: new Date().toISOString(),
      endedAt: null,
    },
    {
      linkId: 'guardian-link-2',
      parent: { userId: 'parent-demo', email: 'parent@qtzx.local', displayName: '演示家长', role: 'parent' },
      student: { userId: 'student-demo-3', email: 'student3@qtzx.local', displayName: '演示学生三', role: 'student' },
      relationship: 'guardian',
      status: 'active',
      createdAt: new Date().toISOString(),
      endedAt: null,
    },
    {
      linkId: 'guardian-link-3',
      parent: { userId: 'parent-demo-2', email: 'parent2@qtzx.local', displayName: '演示家长二', role: 'parent' },
      student: { userId: 'student-demo-2', email: 'student2@qtzx.local', displayName: '演示学生二', role: 'student' },
      relationship: 'guardian',
      status: 'active',
      createdAt: new Date().toISOString(),
      endedAt: null,
    },
  ];

  private mentorAssignments: MentorAssignmentRow[] = [
    {
      assignmentId: 'mentor-assign-1',
      student: { userId: 'student-demo', email: 'student@qtzx.local', displayName: '演示学生', role: 'student' },
      mentor: { userId: 'teacher-demo', email: 'teacher@qtzx.local', displayName: '演示班主任', role: 'teacher' },
      status: 'active',
      assignedAt: new Date().toISOString(),
      endedAt: null,
    },
    {
      assignmentId: 'mentor-assign-2',
      student: { userId: 'student-demo-3', email: 'student3@qtzx.local', displayName: '演示学生三', role: 'student' },
      mentor: { userId: 'teacher-demo', email: 'teacher@qtzx.local', displayName: '演示班主任', role: 'teacher' },
      status: 'active',
      assignedAt: new Date().toISOString(),
      endedAt: null,
    },
    {
      assignmentId: 'mentor-assign-3',
      student: { userId: 'student-demo-2', email: 'student2@qtzx.local', displayName: '演示学生二', role: 'student' },
      mentor: { userId: 'teacher-demo-2', email: 'teacher2@qtzx.local', displayName: '演示班主任二', role: 'teacher' },
      status: 'active',
      assignedAt: new Date().toISOString(),
      endedAt: null,
    },
    {
      assignmentId: 'mentor-assign-4',
      student: { userId: 'student-demo-4', email: 'student4@qtzx.local', displayName: '演示学生四', role: 'student' },
      mentor: { userId: 'teacher-demo-2', email: 'teacher2@qtzx.local', displayName: '演示班主任二', role: 'teacher' },
      status: 'active',
      assignedAt: new Date().toISOString(),
      endedAt: null,
    },
  ];

  findUser(userId: string): DirectoryPersonRef | null {
    const user = this.users.find((u) => u.id === userId);
    return user ? { userId: user.id, email: user.email, displayName: user.displayName, role: user.role as any } : null;
  }

  listUsersByRole(role: string): DirectoryPersonRef[] {
    return this.users
      .filter((u) => u.role === role)
      .map((u) => ({ userId: u.id, email: u.email, displayName: u.displayName, role: u.role as any }));
  }

  guardiansOfStudent(studentId: string): DirectoryPersonRef[] {
    return this.guardianLinks
      .filter((l) => l.student.userId === studentId && l.status === 'active')
      .map((l) => l.parent);
  }

  childrenOfParent(parentUserId: string): DirectoryPersonRef[] {
    return this.guardianLinks
      .filter((l) => l.parent.userId === parentUserId && l.status === 'active')
      .map((l) => l.student);
  }

  listGuardianLinks(statusFilter: 'all' | 'active' | 'ended'): GuardianLinkRow[] {
    if (statusFilter === 'all') return [...this.guardianLinks];
    return this.guardianLinks.filter((l) => l.status === statusFilter);
  }

  mentorOfStudent(studentId: string): DirectoryPersonRef | null {
    const assignment = this.mentorAssignments.find(
      (a) => a.student.userId === studentId && a.status === 'active',
    );
    return assignment ? assignment.mentor : null;
  }

  studentsOfMentor(mentorId: string): DirectoryPersonRef[] {
    return this.mentorAssignments
      .filter((a) => a.mentor.userId === mentorId && a.status === 'active')
      .map((a) => a.student);
  }

  unassignedStudents(): DirectoryPersonRef[] {
    const assignedIds = new Set(
      this.mentorAssignments.filter((a) => a.status === 'active').map((a) => a.student.userId),
    );
    return this.users
      .filter((u) => u.role === 'student' && !assignedIds.has(u.id))
      .map((u) => ({ userId: u.id, email: u.email, displayName: u.displayName, role: u.role as any }));
  }

  listMentorAssignments(statusFilter: 'all' | 'active' | 'ended'): MentorAssignmentRow[] {
    if (statusFilter === 'all') return [...this.mentorAssignments];
    return this.mentorAssignments.filter((a) => a.status === statusFilter);
  }

  createGuardianLink(
    parentUserId: string,
    studentUserId: string,
    relationship: GuardianRelationship,
    idempotencyKey: string,
  ): GuardianLinkRow {
    // 校验统一由 DirectoryService 做。这里只兜底：不用 `!` 把 null 掩盖成
    // “成功”，因为那正是 `parent: null` 脏数据被存进来的原因。
    const parent = this.findUser(parentUserId);
    const student = this.findUser(studentUserId);
    if (!parent || !student) {
      throw new DirectoryError('DIRECTORY_USER_NOT_FOUND');
    }
    const link: GuardianLinkRow = {
      linkId: `guardian-link-${this.guardianLinks.length + 1}`,
      parent,
      student,
      relationship,
      status: 'active',
      createdAt: new Date().toISOString(),
      endedAt: null,
    };
    this.guardianLinks.push(link);
    return link;
  }

  updateGuardianLink(linkId: string, relationship: GuardianRelationship): GuardianLinkRow {
    const link = this.guardianLinks.find((l) => l.linkId === linkId)!;
    link.relationship = relationship;
    return link;
  }

  endGuardianLink(linkId: string, reason: string | null): GuardianLinkRow {
    const link = this.guardianLinks.find((l) => l.linkId === linkId)!;
    link.status = 'ended';
    link.endedAt = new Date().toISOString();
    return link;
  }

  createMentorAssignment(
    studentUserId: string,
    mentorUserId: string,
    idempotencyKey: string,
  ): MentorAssignmentRow {
    const student = this.findUser(studentUserId);
    const mentor = this.findUser(mentorUserId);
    if (!student || !mentor) {
      throw new DirectoryError('DIRECTORY_USER_NOT_FOUND');
    }
    // Check for existing active assignment
    const existing = this.mentorAssignments.find(
      (a) => a.student.userId === studentUserId && a.status === 'active',
    );
    if (existing) {
      throw new DirectoryError('MENTOR_ALREADY_ASSIGNED');
    }
    const assignment: MentorAssignmentRow = {
      assignmentId: `mentor-assign-${this.mentorAssignments.length + 1}`,
      student,
      mentor,
      status: 'active',
      assignedAt: new Date().toISOString(),
      endedAt: null,
    };
    this.mentorAssignments.push(assignment);
    return assignment;
  }

  endMentorAssignment(assignmentId: string, reason: string | null): MentorAssignmentRow {
    const assignment = this.mentorAssignments.find((a) => a.assignmentId === assignmentId)!;
    assignment.status = 'ended';
    assignment.endedAt = new Date().toISOString();
    return assignment;
  }

  transferMentor(
    studentUserId: string,
    newMentorUserId: string,
    reason: string | null,
    idempotencyKey: string,
  ): { ended: MentorAssignmentRow; created: MentorAssignmentRow } {
    const current = this.mentorAssignments.find(
      (a) => a.student.userId === studentUserId && a.status === 'active',
    );
    if (!current) {
      throw new DirectoryError('RELATIONSHIP_NOT_FOUND');
    }
    const ended = this.endMentorAssignment(current.assignmentId, reason);
    const created = this.createMentorAssignment(studentUserId, newMentorUserId, idempotencyKey);
    return { ended, created };
  }
}
