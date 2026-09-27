import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Headers,
  Inject,
  ConflictException,
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Database } from '@qitu/database';
import type {
  GuardianLinkListPageData,
  GuardianLinkMutationResponse,
  CreateGuardianLinkRequest,
  UpdateGuardianLinkRequest,
  EndGuardianLinkRequest,
  MentorAssignmentListPageData,
  MentorAssignmentMutationResponse,
  CreateMentorAssignmentRequest,
  EndMentorAssignmentRequest,
  TransferMentorRequest,
  TransferMentorResponse,
  AdminStudentStatsPageData,
  AdminStudentStatsRange,
} from '@qitu/contracts';
import { DirectoryService, DirectoryError } from '../directory/directory.service';
import type { DirectoryErrorCode } from '../directory/directory.service';
import { requireRole, pickFields } from '../../common/access/request-auth';
import {
  hashIdempotentInput,
  IdempotencyError,
  IdempotencyStore,
  throwHttpForIdempotencyError,
} from '../../common/idempotency';
import { AuditWriter } from '../../common/audit';
import { DATABASE_TOKEN, DATABASE_TRANSACTION_TOKEN } from '../../database';
import { AuthService } from '../identity-auth/auth.service';

const SESSION_COOKIE = 'qitu_session';

/** 各领域错误码对应的默认中文提示。 */
const DIRECTORY_ERROR_MESSAGES: Record<DirectoryErrorCode, string> = {
  DIRECTORY_USER_NOT_FOUND: '目标用户不存在',
  RELATIONSHIP_ROLE_INVALID: '关系两端角色不合法',
  SELF_RELATIONSHIP_INVALID: '不能把自己绑定为自己的监护人或班主任',
  RELATIONSHIP_NOT_FOUND: '关系不存在',
  GUARDIAN_LINK_ALREADY_ACTIVE: '该监护关系已存在',
  GUARDIAN_LINK_ENDED: '该监护关系已结束，不能再修改',
  MENTOR_ALREADY_ASSIGNED: '该学生已有当前班主任，请使用「换班主任」',
};

/**
 * 把目录层的领域错误翻译成 HTTP 状态码。
 *
 * 放在一处而不是每个写接口各写一遍 try/catch：先前的写法导致只有
 * 「第二个班主任」和「重复监护关系」两条路径被映射，其余校验错误全变成
 * 500，而且数据库唯一索引/外键报的错也没人接。
 */
function throwHttpForDirectoryError(error: unknown): never {
  if (error instanceof DirectoryError) {
    const body = { code: error.code, message: DIRECTORY_ERROR_MESSAGES[error.code] };
    switch (error.code) {
      case 'DIRECTORY_USER_NOT_FOUND':
      case 'RELATIONSHIP_NOT_FOUND':
        throw new NotFoundException(body);
      case 'GUARDIAN_LINK_ALREADY_ACTIVE':
      case 'GUARDIAN_LINK_ENDED':
      case 'MENTOR_ALREADY_ASSIGNED':
        throw new ConflictException(body);
      default:
        throw new BadRequestException(body);
    }
  }
  throw error;
}

/**
 * Directory admin controller: relationship binding and management.
 * Admin-only. All writes require Idempotency-Key.
 */
@Controller('admin')
export class DirectoryAdminController {
  constructor(
    private readonly directory: DirectoryService,
    private readonly authService: AuthService,
    private readonly idempotency: IdempotencyStore,
    private readonly audit: AuditWriter,
    @Inject(DATABASE_TOKEN) private readonly db: Database | null,
    @Inject(DATABASE_TRANSACTION_TOKEN)
    private readonly withTransaction: typeof import('@qitu/database').withTransaction,
  ) {}

  /* ==================== Guardian Links ==================== */

  @Get('guardian-links')
  async listGuardianLinks(
    @Headers('cookie') cookieHeader: string | undefined,
    @Query('status') status?: string,
  ): Promise<{ data: GuardianLinkListPageData }> {
    requireRole(this.authService, cookieHeader, 'admin', '该操作仅向管理员开放');

    const statusFilter = status === 'active' || status === 'ended' ? status : 'all';
    const items = await this.directory.listGuardianLinks(statusFilter);

    // 获取可用候选。
    //
    // 注意：这里**不能**按“已绑定”过滤。一个家长可以监护多个孩子，一个孩子也
    // 可以有多位监护人，所以候选集必须是不依赖对方的全集——契约注释里说的
    // “已剔除重复绑定”只能由前端在选定了另一端之后自己算。
    // （先前这里真的算了两个过滤集合，但算完就丢掉不用，还会在脏数据上 NullPointer。）
    const allParents = await this.directory.listUsersByRole('parent');
    const allStudents = await this.directory.listUsersByRole('student');

    const activeLinks = items.filter((l) => l.status === 'active');
    const activeCount = activeLinks.length;
    const endedCount = items.filter((l) => l.status === 'ended').length;
    const coveredStudents = new Set(activeLinks.map((l) => l.student.userId));
    const coveredStudentPercent = allStudents.length > 0
      ? Math.round((coveredStudents.size / allStudents.length) * 100)
      : 0;

    return {
      data: {
        items,
        availableParents: allParents,
        availableStudents: allStudents,
        totals: {
          activeCount,
          endedCount,
          coveredStudentPercent,
        },
        dataSource: 'demo',
      },
    };
  }

  @Post('guardian-links')
  async createGuardianLink(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ): Promise<{ data: GuardianLinkMutationResponse }> {
    const admin = requireRole(this.authService, cookieHeader, 'admin', '该操作仅向管理员开放');

    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: '缺少 Idempotency-Key 请求头',
      });
    }

    const input = pickFields<CreateGuardianLinkRequest>(body, [
      'parentUserId',
      'studentUserId',
      'relationship',
    ]);

    if (!input.parentUserId || !input.studentUserId || !input.relationship) {
      throw new BadRequestException('parentUserId, studentUserId, and relationship are required');
    }

    const scope = 'admin.guardian-links.create';
    const requestHash = hashIdempotentInput(scope, {}, input);

    try {
      const result = await this.idempotency.execute(
        scope,
        idempotencyKey,
        requestHash,
        async () => {
          const db = this.db;
          if (!db) {
            throw new ServiceUnavailableException(
              '关系写入不可用：未配置 DATABASE_URL，无法保证事务内审计',
            );
          }

          const response = await this.withTransaction(db, async (tx) => {
            const link = await this.directory.createGuardianLink(
              input.parentUserId,
              input.studentUserId,
              input.relationship,
              idempotencyKey,
              tx,
            );

            await this.audit.write(
              {
                actorId: admin.id,
                actorRole: 'admin',
                action: 'guardian_link.create',
                targetType: 'guardian_link',
                targetId: link.linkId,
                idempotencyKey: `${scope}:${idempotencyKey}`,
                detail: {
                  parent: {
                    userId: link.parent.userId,
                    displayName: link.parent.displayName,
                    role: link.parent.role,
                  },
                  student: {
                    userId: link.student.userId,
                    displayName: link.student.displayName,
                    role: link.student.role,
                  },
                  relationship: link.relationship,
                },
              },
              tx,
            );

            return {
              link,
              changedAt: new Date().toISOString(),
            } satisfies GuardianLinkMutationResponse;
          });

          return { status: 201, body: response };
        },
      );

      // 首次与重放都返回同一信封形状；重放不会再次调用 DirectoryService。
      return { data: result.body };
    } catch (error) {
      // IdempotencyError（同 key 不同 payload / 并发处理中）→ 409 / 400；
      // DirectoryError → 沿用既有 404 / 409 / 400 映射。业务错误码保持不变：
      // handler 抛错时由 IdempotencyService 记为 failed（可同 hash 重试），
      // 不会被当成成功记录。
      if (error instanceof IdempotencyError) {
        throwHttpForIdempotencyError(error);
      }
      throwHttpForDirectoryError(error);
    }
  }

  @Patch('guardian-links/:linkId')
  async updateGuardianLink(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('linkId') linkId: string,
    @Body() body: unknown,
  ): Promise<{ data: GuardianLinkMutationResponse }> {
    const admin = requireRole(this.authService, cookieHeader, 'admin', '该操作仅向管理员开放');

    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: '缺少 Idempotency-Key 请求头',
      });
    }

    const input = pickFields<UpdateGuardianLinkRequest>(body, ['relationship']);

    if (!input.relationship) {
      throw new BadRequestException('relationship is required');
    }

    // scope 内联资源 id：同一 Idempotency-Key 换一个 linkId 不会被误判为重放。
    const scope = `admin.guardian-links.update:${linkId}`;
    const requestHash = hashIdempotentInput(scope, { linkId }, input);

    try {
      const result = await this.idempotency.execute(
        scope,
        idempotencyKey,
        requestHash,
        async () => {
          const db = this.db;
          if (!db) {
            throw new ServiceUnavailableException(
              '关系写入不可用：未配置 DATABASE_URL，无法保证事务内审计',
            );
          }

          const response = await this.withTransaction(db, async (tx) => {
            // 更新与审计同事务：审计写入失败会让 UPDATE 一并回滚，
            // 且由 IdempotencyService 记为 failed（可同载荷重试）。
            const link = await this.directory.updateGuardianLink(linkId, input.relationship, tx);

            await this.audit.write(
              {
                actorId: admin.id,
                actorRole: 'admin',
                action: 'guardian_link.update',
                targetType: 'guardian_link',
                targetId: linkId,
                // 审计幂等键统一命名空间，避免与其他 scope 碰撞；重放不会再写一条。
                idempotencyKey: `${scope}:${idempotencyKey}`,
                // 只记录关系变更的最小事实；不含 email/凭据，降低未成年人数据暴露。
                detail: {
                  relationship: link.relationship,
                },
              },
              tx,
            );

            return {
              link,
              changedAt: new Date().toISOString(),
            } satisfies GuardianLinkMutationResponse;
          });

          return { status: 200, body: response };
        },
      );

      // 首次与重放返回同一信封；重放不会再次调用 DirectoryService，也不会重复审计。
      return { data: result.body };
    } catch (error) {
      if (error instanceof IdempotencyError) {
        throwHttpForIdempotencyError(error);
      }
      throwHttpForDirectoryError(error);
    }
  }

  @Post('guardian-links/:linkId/end')
  async endGuardianLink(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('linkId') linkId: string,
    @Body() body: unknown,
  ): Promise<{ data: GuardianLinkMutationResponse }> {
    const admin = requireRole(this.authService, cookieHeader, 'admin', '该操作仅向管理员开放');

    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: '缺少 Idempotency-Key 请求头',
      });
    }

    const input = pickFields<EndGuardianLinkRequest>(body, ['reason']);
    // 缺省与显式 null 视为同一载荷，避免 `{}` 与 `{reason:null}` 被误判为不同指纹。
    const reason = input.reason ?? null;

    // scope 内联资源 id：同一 Idempotency-Key 换一个 linkId 不会被误判为重放；
    // 指纹同时包含 linkId 与 reason，改结束原因重放会触发 409。
    const scope = `admin.guardian-links.end:${linkId}`;
    const requestHash = hashIdempotentInput(scope, { linkId }, { reason });

    try {
      const result = await this.idempotency.execute(
        scope,
        idempotencyKey,
        requestHash,
        async () => {
          const db = this.db;
          if (!db) {
            throw new ServiceUnavailableException(
              '关系写入不可用：未配置 DATABASE_URL，无法保证事务内审计',
            );
          }

          const response = await this.withTransaction(db, async (tx) => {
            // 结束与审计同事务：审计写入失败会让 UPDATE 一并回滚，
            // 且由 IdempotencyService 记为 failed（可同载荷重试）。
            const link = await this.directory.endGuardianLink(linkId, reason, tx);

            await this.audit.write(
              {
                actorId: admin.id,
                actorRole: 'admin',
                action: 'guardian_link.end',
                targetType: 'guardian_link',
                targetId: linkId,
                // 审计幂等键统一命名空间，避免与其他 scope 碰撞；重放不会再写一条。
                idempotencyKey: `${scope}:${idempotencyKey}`,
                // 只记录结束原因的最小事实；不含 email/凭据，降低未成年人数据暴露。
                detail: { reason },
              },
              tx,
            );

            return {
              link,
              changedAt: new Date().toISOString(),
            } satisfies GuardianLinkMutationResponse;
          });

          return { status: 200, body: response };
        },
      );

      // 首次与重放返回同一信封；重放不会再次调用 DirectoryService，也不会重复审计。
      return { data: result.body };
    } catch (error) {
      if (error instanceof IdempotencyError) {
        throwHttpForIdempotencyError(error);
      }
      throwHttpForDirectoryError(error);
    }
  }

  /* ==================== Mentor Assignments ==================== */

  @Get('mentor-assignments')
  async listMentorAssignments(
    @Headers('cookie') cookieHeader: string | undefined,
    @Query('status') status?: string,
  ): Promise<{ data: MentorAssignmentListPageData }> {
    requireRole(this.authService, cookieHeader, 'admin', '该操作仅向管理员开放');

    const statusFilter = status === 'active' || status === 'ended' ? status : 'all';
    const items = await this.directory.listMentorAssignments(statusFilter);

    const unassignedStudents = await this.directory.unassignedStudents();
    const availableMentors = await this.directory.listUsersByRole('teacher');

    const activeCount = items.filter((a) => a.status === 'active').length;
    const endedCount = items.filter((a) => a.status === 'ended').length;
    const allStudents = await this.directory.listUsersByRole('student');
    const coveredStudentPercent = allStudents.length > 0
      ? Math.round((activeCount / allStudents.length) * 100)
      : 0;

    return {
      data: {
        items,
        unassignedStudents,
        availableMentors,
        totals: {
          activeCount,
          endedCount,
          coveredStudentPercent,
        },
        dataSource: 'demo',
      },
    };
  }

  @Post('mentor-assignments')
  async createMentorAssignment(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ): Promise<{ data: MentorAssignmentMutationResponse }> {
    const admin = requireRole(this.authService, cookieHeader, 'admin', '该操作仅向管理员开放');

    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: '缺少 Idempotency-Key 请求头',
      });
    }

    const input = pickFields<CreateMentorAssignmentRequest>(body, [
      'studentUserId',
      'mentorUserId',
    ]);

    if (!input.studentUserId || !input.mentorUserId) {
      throw new BadRequestException('studentUserId and mentorUserId are required');
    }

    const scope = 'admin.mentor-assignments.create';
    const requestHash = hashIdempotentInput(scope, {}, input);

    try {
      const result = await this.idempotency.execute(
        scope,
        idempotencyKey,
        requestHash,
        async () => {
          const db = this.db;
          if (!db) {
            throw new ServiceUnavailableException(
              '关系写入不可用：未配置 DATABASE_URL，无法保证事务内审计',
            );
          }

          const response = await this.withTransaction(db, async (tx) => {
            const assignment = await this.directory.createMentorAssignment(
              input.studentUserId,
              input.mentorUserId,
              idempotencyKey,
              tx,
            );

            await this.audit.write(
              {
                actorId: admin.id,
                actorRole: 'admin',
                action: 'mentor_assignment.create',
                targetType: 'mentor_assignment',
                targetId: assignment.assignmentId,
                idempotencyKey: `${scope}:${idempotencyKey}`,
                detail: {
                  student: {
                    userId: assignment.student.userId,
                    displayName: assignment.student.displayName,
                    role: assignment.student.role,
                  },
                  mentor: {
                    userId: assignment.mentor.userId,
                    displayName: assignment.mentor.displayName,
                    role: assignment.mentor.role,
                  },
                },
              },
              tx,
            );

            return {
              assignment,
              changedAt: new Date().toISOString(),
            } satisfies MentorAssignmentMutationResponse;
          });

          return { status: 201, body: response };
        },
      );

      return { data: result.body };
    } catch (error) {
      if (error instanceof IdempotencyError) {
        throwHttpForIdempotencyError(error);
      }
      throwHttpForDirectoryError(error);
    }
  }

  @Post('mentor-assignments/:assignmentId/end')
  async endMentorAssignment(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('assignmentId') assignmentId: string,
    @Body() body: unknown,
  ): Promise<{ data: MentorAssignmentMutationResponse }> {
    const admin = requireRole(this.authService, cookieHeader, 'admin', '该操作仅向管理员开放');

    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: '缺少 Idempotency-Key 请求头',
      });
    }

    const input = pickFields<EndMentorAssignmentRequest>(body, ['reason']);
    const reason = input.reason ?? null;
    const scope = `admin.mentor-assignments.end:${assignmentId}`;
    const requestHash = hashIdempotentInput(scope, { assignmentId }, { reason });

    try {
      const result = await this.idempotency.execute(
        scope,
        idempotencyKey,
        requestHash,
        async () => {
          const db = this.db;
          if (!db) {
            throw new ServiceUnavailableException(
              '关系写入不可用：未配置 DATABASE_URL，无法保证事务内审计',
            );
          }

          const response = await this.withTransaction(db, async (tx) => {
            const assignment = await this.directory.endMentorAssignment(
              assignmentId,
              reason,
              tx,
            );

            await this.audit.write(
              {
                actorId: admin.id,
                actorRole: 'admin',
                action: 'mentor_assignment.end',
                targetType: 'mentor_assignment',
                targetId: assignmentId,
                idempotencyKey: `${scope}:${idempotencyKey}`,
                detail: { reason },
              },
              tx,
            );

            return {
              assignment,
              changedAt: new Date().toISOString(),
            } satisfies MentorAssignmentMutationResponse;
          });

          return { status: 200, body: response };
        },
      );

      return { data: result.body };
    } catch (error) {
      if (error instanceof IdempotencyError) {
        throwHttpForIdempotencyError(error);
      }
      throwHttpForDirectoryError(error);
    }
  }

  @Post('mentor-assignments/transfer')
  async transferMentor(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ): Promise<{ data: TransferMentorResponse }> {
    const admin = requireRole(this.authService, cookieHeader, 'admin', '该操作仅向管理员开放');

    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: '缺少 Idempotency-Key 请求头',
      });
    }

    const input = pickFields<TransferMentorRequest>(body, [
      'studentUserId',
      'mentorUserId',
      'reason',
    ]);

    if (!input.studentUserId || !input.mentorUserId) {
      throw new BadRequestException('studentUserId and mentorUserId are required');
    }

    const reason = input.reason ?? null;
    const scope = 'admin.mentor-assignments.transfer';
    const requestHash = hashIdempotentInput(scope, {}, {
      studentUserId: input.studentUserId,
      mentorUserId: input.mentorUserId,
      reason,
    });

    try {
      const result = await this.idempotency.execute(
        scope,
        idempotencyKey,
        requestHash,
        async () => {
          const db = this.db;
          if (!db) {
            throw new ServiceUnavailableException(
              '关系写入不可用：未配置 DATABASE_URL，无法保证事务内审计',
            );
          }

          const response = await this.withTransaction(db, async (tx) => {
            const { ended, created } = await this.directory.transferMentor(
              input.studentUserId,
              input.mentorUserId,
              reason,
              idempotencyKey,
              tx,
            );

            await this.audit.write(
              {
                actorId: admin.id,
                actorRole: 'admin',
                action: 'mentor_assignment.transfer',
                targetType: 'mentor_assignment',
                targetId: input.studentUserId,
                idempotencyKey: `${scope}:${idempotencyKey}`,
                detail: {
                  student: {
                    userId: ended.student.userId,
                    displayName: ended.student.displayName,
                    role: ended.student.role,
                  },
                  endedMentor: {
                    userId: ended.mentor.userId,
                    displayName: ended.mentor.displayName,
                    role: ended.mentor.role,
                  },
                  createdMentor: {
                    userId: created.mentor.userId,
                    displayName: created.mentor.displayName,
                    role: created.mentor.role,
                  },
                  endedAssignmentId: ended.assignmentId,
                  createdAssignmentId: created.assignmentId,
                  reason,
                },
              },
              tx,
            );

            return { ended, created } satisfies TransferMentorResponse;
          });

          return { status: 200, body: response };
        },
      );

      return { data: result.body };
    } catch (error) {
      if (error instanceof IdempotencyError) {
        throwHttpForIdempotencyError(error);
      }
      throwHttpForDirectoryError(error);
    }
  }

  /* ==================== Student Statistics ==================== */

  @Get('students/statistics')
  async getStudentStatistics(
    @Headers('cookie') cookieHeader: string | undefined,
    @Query('range') range?: string,
  ): Promise<{ data: AdminStudentStatsPageData }> {
    requireRole(this.authService, cookieHeader, 'admin', '该操作仅向管理员开放');

    const rangeValue: AdminStudentStatsRange =
      range === '7d' || range === '30d' ? range : 'all';

    // This is demo data - in production would query actual activity logs
    const allStudents = await this.directory.listUsersByRole('student');
    const activeAssignments = await this.directory.listMentorAssignments('active');
    const activeLinks = await this.directory.listGuardianLinks('active');

    const mentorMap = new Map(activeAssignments.map((a) => [a.student.userId, a.mentor]));
    const guardianMap = new Map<string, number>();
    activeLinks.forEach((l) => {
      guardianMap.set(l.student.userId, (guardianMap.get(l.student.userId) || 0) + 1);
    });

    const rows = allStudents.map((student) => ({
      studentId: student.userId,
      displayName: student.displayName,
      gradeLabel: null,
      classLabel: null,
      activeDays: 0,
      sessionsThisWeek: 0,
      minutesThisWeek: 0,
      tasksCompleted: 0,
      currentProjectTitle: null,
      currentStage: null,
      lastActivityAt: null,
      hasMentor: mentorMap.has(student.userId),
      hasGuardian: (guardianMap.get(student.userId) || 0) > 0,
    }));

    const mentorCoveredPercent = allStudents.length > 0
      ? Math.round((activeAssignments.length / allStudents.length) * 100)
      : 0;
    const studentsWithGuardians = new Set(activeLinks.map((l) => l.student.userId));
    const guardianCoveredPercent = allStudents.length > 0
      ? Math.round((studentsWithGuardians.size / allStudents.length) * 100)
      : 0;
    const unboundStudentCount = rows.filter((r) => !r.hasMentor && !r.hasGuardian).length;

    return {
      data: {
        range: rangeValue,
        totals: {
          studentCount: allStudents.length,
          activeStudentCount: 0,
          sessions: 0,
          minutes: 0,
          tasksCompleted: 0,
          mentorCoveredPercent,
          guardianCoveredPercent,
          unboundStudentCount,
        },
        activity: [],
        stageDistribution: [],
        rows,
        generatedAt: new Date().toISOString(),
        dataSource: 'demo',
      },
    };
  }
}
