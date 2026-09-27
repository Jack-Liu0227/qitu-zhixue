import {
  ForbiddenException,
  Injectable,
  NotImplementedException,
  UnauthorizedException,
} from '@nestjs/common';
import type { CurrentUser } from '@qitu/contracts';
import { AuthService } from '../../modules/identity-auth/auth.service';
import { DirectoryService } from '../../modules/directory/directory.service';
import { readCookie, SESSION_COOKIE } from './request-auth';
import type { StudentRelationship } from './access-policy.rules';
import { canReadStudentByRelationship } from './access-policy.rules';

/**
 * `AccessPolicy` —— 后端**对象级授权的唯一入口**。
 *
 * 设计约束（ADR 0002 / `docs/PERMISSIONS.md`）：
 * - 前端隐藏按钮不构成授权；每个对象级读/写都必须先经过这里。
 * - 判定顺序：会话 → 角色 → 关系成立 → 可见性。越权统一抛 403，
 *   且**不得**通过响应差异泄露资源是否存在（存在 / 不存在都返回同一句 403）。
 * - 关系解析只读 `DirectoryService` 的 active `guardian_links` /
 *   `mentor_assignments`，不在授权层另建一份名单。
 *
 * 与现有 `request-auth.ts` 的关系：
 * - `request-auth.ts` 的 `requireAnyRole` / `requireRole(authService, cookie, role, msg)`
 *   继续保留，未迁移的控制器无需改动；`AccessPolicy` 是新的、对象级感知的入口。
 * - 会话 cookie 解析复用 `request-auth.ts` 的 `readCookie` / `SESSION_COOKIE`，
 *   避免出现两份 cookie 解析实现。
 *
 * 本任务**不**实现（明确的交接点）：
 * - 审计写入：敏感读取审批、原始对话 / 语音访问留痕；
 * - 幂等：写接口的 `Idempotency-Key` 处理（由各写模块负责）；
 * - 控制器迁移：仍使用 `request-auth` 的控制器不做批量替换。
 * 上述三项需要单独的任务与评审，不能在这层“顺手”补上。
 */

/** 已认证主体。当前就是契约里的公开用户投影。 */
export type Actor = CurrentUser;

/** 统一的越权文案：不管资源是否存在，呼出同一句，避免信息泄露。 */
const FORBIDDEN_MESSAGE = '无权访问该资源';

/** 敏感读取的种类。**接口先占位**，具体资源类型在审批流程落地时再扩展。 */
export type SensitiveResourceType =
  'student_raw_conversation' | 'student_voice' | 'student_profile_pii' | 'audit_log';

export interface SensitiveReadRequest {
  resourceType: SensitiveResourceType;
  resourceId: string;
  /** 访问原因。审批流程落地前不消费该字段，但接口保留。 */
  reason?: string;
  /** 是否已完成二次确认。审批流程落地前不消费该字段，但接口保留。 */
  confirmed?: boolean;
}

@Injectable()
export class AccessPolicy {
  constructor(
    private readonly authService: AuthService,
    private readonly directory: DirectoryService,
  ) {}

  /* ==================== 会话与角色 ==================== */

  /**
   * 从会话 cookie 解析当前主体。未登录 / 会话失效抛 401。
   *
   * 这是所有对象级判定的第一步：没有主体就没有授权。
   */
  requireActor(cookieHeader: string | undefined): Actor {
    const token = readCookie(cookieHeader, SESSION_COOKIE);
    if (token === undefined) throw new UnauthorizedException('请先登录');
    return this.authService.getSession(token).user;
  }

  /**
   * 角色校验：已登录但角色不符抛 403（不是 401）。
   *
   * 角色只是粗粒度闸门；真正的对象级判定继续走
   * `canReadStudent` / `canReadChild`。
   */
  requireRole(actor: Actor, role: Actor['role']): Actor {
    if (actor.role !== role) throw new ForbiddenException(FORBIDDEN_MESSAGE);
    return actor;
  }

  /* ==================== 学生（对象级读） ==================== */

  /**
   * 主体能否读取该学生。返回布尔值，**不抛异常**。
   *
   * 判定：student 本人 / parent 的 active 监护关系 / teacher 的 active 班主任分配 /
   * admin 平台治理放行；support 与未知角色一律拒绝。
   */
  async canReadStudent(actor: Actor, studentId: string): Promise<boolean> {
    const relationship = await this.resolveStudentRelationship(actor, studentId);
    return canReadStudentByRelationship(actor, studentId, relationship);
  }

  /**
   * 断言主体可读该学生；否则统一 403。
   *
   * 学生不存在与越权返回同一种 403 —— 调用方若需要区分“不存在”，
   * 只能在**通过授权之后**再查一次并返回 404，绝不能在这里先泄露存在性。
   */
  async assertCanReadStudent(actor: Actor, studentId: string): Promise<void> {
    if (!(await this.canReadStudent(actor, studentId))) {
      throw new ForbiddenException(FORBIDDEN_MESSAGE);
    }
  }

  /**
   * 家长视角的“能否读取某个孩子”。
   *
   * 与 `canReadStudent` 共用同一套关系解析，避免两处判定漂移：
   * parent 走 active 监护关系，admin 平台治理放行，其余拒绝。
   */
  async canReadChild(actor: Actor, childId: string): Promise<boolean> {
    return this.canReadStudent(actor, childId);
  }

  /** 断言家长可读该孩子；否则统一 403，不区分孩子是否存在。 */
  async assertCanReadChild(actor: Actor, childId: string): Promise<void> {
    await this.assertCanReadStudent(actor, childId);
  }

  /* ==================== 项目（尚未实现） ==================== */

  /**
   * 项目读授权。**项目模块尚未实现**，因此不允许放行。
   *
   * 明确返回 501「未配置」，而不是默认放行或伪装成 403：
   * 默认放行会让任何调用方在项目模块落地前误以为已授权。
   */
  async assertCanReadProject(_actor: Actor, _projectId: string): Promise<never> {
    throw this.projectPolicyNotConfigured('读取');
  }

  /** 项目写授权。同样因项目模块未实现而拒绝放行（501）。 */
  async assertCanWriteProject(_actor: Actor, _projectId: string): Promise<never> {
    throw this.projectPolicyNotConfigured('写入');
  }

  /* ==================== 敏感读取（接口保留，暂不放行） ==================== */

  /**
   * 敏感数据读取。**接口保留，但当前一律拒绝**。
   *
   * 产品与 `docs/PERMISSIONS.md` 要求：管理员查看原始对话 / 语音等敏感数据，
   * 必须走「说明原因 → 二次确认 → 写审计 → 限时范围」。审计链路尚未实现，
   * 因此这里不能放行；等审批 + 审计落地后，在此处接入并保持调用方不变。
   */
  async assertSensitiveRead(_actor: Actor, _request: SensitiveReadRequest): Promise<never> {
    throw new NotImplementedException(
      '敏感数据访问审批尚未接入：需先实现「说明原因 → 二次确认 → 写审计 → 限时范围」，本接口拒绝放行',
    );
  }

  /* ==================== 内部 ==================== */

  /**
   * 只解析当前角色真正需要的关系，避免无谓查询：
   * - parent → 自己的 active 监护关系；
   * - teacher → 自己的 active 班主任分配；
   * - student / admin / support → 不需要关系，交给纯规则判定。
   */
  private async resolveStudentRelationship(
    actor: Actor,
    studentId: string,
  ): Promise<StudentRelationship> {
    if (actor.role === 'parent') {
      const children = await this.directory.childrenOfParent(actor.id);
      return {
        guardianOfStudent: children.some((child) => child.userId === studentId),
        mentorOfStudent: false,
      };
    }
    if (actor.role === 'teacher') {
      const students = await this.directory.studentsOfMentor(actor.id);
      return {
        guardianOfStudent: false,
        mentorOfStudent: students.some((student) => student.userId === studentId),
      };
    }
    return { guardianOfStudent: false, mentorOfStudent: false };
  }

  private projectPolicyNotConfigured(action: '读取' | '写入'): NotImplementedException {
    return new NotImplementedException(`项目${action}访问策略尚未配置：项目模块未实现，拒绝放行`);
  }
}
