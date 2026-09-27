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
 * | admin     | 可管理平台（敏感读取另走 `assertSensitiveRead`）     |
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
      return true;
    case 'support':
      return false;
    default:
      return false;
  }
}
