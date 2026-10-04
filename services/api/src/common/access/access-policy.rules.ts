import type { Role } from '@qitu/contracts';

/**
 * 对象级授权的**纯判定规则**。
 *
 * 这里不查库、没有副作用、也不依赖 Nest：调用方先把「关系解析结果」算好，
 * 再交给这里做角色 × 关系的判定。这样做的原因有两点：
 *
 * 1. 判定矩阵只有一份，不会因为某个控制器自己重写而漂移；
 * 2. 纯函数可以直接单测（见 `access-policy.rules.test.ts`），
 *    数据库支撑的关系解析则留在 `AccessPolicy` 里。
 */

/** 授权主体投影：只保留 `id` 与 `role`，避免会话字段泄漏进策略层。 */
export interface ActorRef {
  id: string;
  role: Role;
}

/**
 * 主体与学生之间**已成立**的关系（只含 active 关系）。
 *
 * 由 `AccessPolicy` 通过 `DirectoryService` 解析后传入，纯规则层不自己查库。
 */
export interface StudentRelationship {
  /** 主体是否为该学生的当前监护人（`guardian_links.status = active`）。 */
  guardianOfStudent: boolean;
  /** 主体是否为该学生的当前班主任（`mentor_assignments.status = active`）。 */
  mentorOfStudent: boolean;
}

/**
 * 主体能否读取某个学生的对象级判定。
 *
 * 判定矩阵：
 * | 角色      | 放行条件                                             |
 * |-----------|------------------------------------------------------|
 * | student   | `studentId` 就是本人                                 |
 * | parent    | 存在指向该学生的 active 监护关系                     |
 * | teacher   | 存在指向该学生的 active 班主任分配（且班主任是本人） |
 * | admin     | **默认拒绝**；个别访问需显式授权（未落地前 fail closed） |
 * | support   | 暂不放行（授权范围未定，按最小可见范围处理）         |
 *
 * 兜底 `default` 一律拒绝：新增角色在明确策略前默认不可读，而不是默认放行。
 */
export function canReadStudentByRelationship(
  actor: ActorRef,
  studentId: string,
  relationship: StudentRelationship,
): boolean {
  switch (actor.role) {
    case 'student':
      return actor.id === studentId;
    case 'parent':
      return relationship.guardianOfStudent;
    case 'teacher':
      return relationship.mentorOfStudent;
    case 'admin':
      // 平台治理放行的是聚合 / 治理视图，不等于可读「个别学生」。
      // 管理员个别访问需要显式授权，授权模型落地前一律拒绝（fail closed）。
      return canAdminReadIndividualStudent();
    case 'support':
      return false;
    default:
      return false;
  }
}

/**
 * 管理员能否读取「个别学生」对象。
 *
 * ADR 0008 决定 6 / 产品文档 7.0 / `docs/admin/permissions.md` 第 5 节要求：管理员查看
 * 个别学生数据必须同时满足「对象级授权范围 + 最小字段 + 目的 / 原因 + 敏感二次确认
 * + 写审计 + 限时有效」。当前这些条件没有持久化与审计支撑
 * （`audit_logs` 业务写入见 `docs/admin/permissions.md` 第 10 节仍未接入），
 * 因此不得以「管理员角色更大」为由默认放行。
 *
 * 这是一个**显式 seam**：显式授权模型落地后在此接入，调用方（`AccessPolicy`
 * 与控制器）无需改动；在那之前恒为 `false`，保证失败关闭。
 */
export function canAdminReadIndividualStudent(): boolean {
  return false;
}
