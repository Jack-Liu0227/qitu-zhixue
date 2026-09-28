import type { Role } from '@qitu/contracts';
import {
  RESERVED_RAW_TUTOR_SOURCE_PREFIXES,
  type KnowledgeDocument,
  type KnowledgeScopeFields,
} from './knowledge.types';

/**
 * 知识作用域的**纯判定规则**（不查库、无副作用、不依赖 Nest）。
 *
 * 判定所需的关系事实（学校归属、项目可访问性）由服务层 / `KnowledgeScopeAuthorizer`
 * 先解析好再传入；规则层只做「角色 × 作用域 × 关系」的矩阵判定，保证只有一份实现，
 * 且可以脱离数据库直接单测。
 */

/** 授权主体的最小投影。 */
export interface KnowledgeActorContext {
  actorId: string;
  role: Role;
  /** 服务端解析出的学校归属；平台账号可为 `null`。 */
  schoolId: string | null;
}

/** 读取判定上下文。 */
export interface KnowledgeReadContext {
  actor: KnowledgeActorContext;
  /** 本次请求显式关联的项目（可选）。 */
  projectId: string | null;
  /** 该主体是否确实能访问上述项目（由 authorizer 解析，默认 fail closed）。 */
  projectAccessible: boolean;
}

export type KnowledgeWriteDenialReason = 'forbidden' | 'scope_invalid' | 'source_forbidden';

export interface KnowledgeWriteDecision {
  allowed: boolean;
  reason: KnowledgeWriteDenialReason | null;
  message: string | null;
}

const ALLOW: KnowledgeWriteDecision = { allowed: true, reason: null, message: null };

function deny(reason: KnowledgeWriteDenialReason, message: string): KnowledgeWriteDecision {
  return { allowed: false, reason, message };
}

function present(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * 作用域与绑定字段的一致性校验。
 *
 * | scope   | 必填            | 必须为空           |
 * |---------|-----------------|--------------------|
 * | system  | —               | school/owner/project |
 * | school  | schoolId        | owner/project      |
 * | project | projectId       | —                  |
 * | student | ownerUserId     | —                  |
 */
export function validateKnowledgeScopeShape(
  fields: KnowledgeScopeFields,
): { valid: boolean; message: string | null } {
  switch (fields.scope) {
    case 'system':
      if (fields.schoolId !== null || fields.ownerUserId !== null || fields.projectId !== null) {
        return { valid: false, message: '系统知识不得绑定学校 / 个人 / 项目' };
      }
      return { valid: true, message: null };
    case 'school':
      if (!present(fields.schoolId)) {
        return { valid: false, message: '校本知识必须绑定 schoolId' };
      }
      if (fields.ownerUserId !== null || fields.projectId !== null) {
        return { valid: false, message: '校本知识不得绑定个人 / 项目' };
      }
      return { valid: true, message: null };
    case 'project':
      if (!present(fields.projectId)) {
        return { valid: false, message: '项目知识必须绑定 projectId' };
      }
      return { valid: true, message: null };
    case 'student':
      if (!present(fields.ownerUserId)) {
        return { valid: false, message: '学生私有知识必须绑定 ownerUserId' };
      }
      return { valid: true, message: null };
    default:
      return { valid: false, message: '未知知识作用域' };
  }
}

/** 是否命中「原始对话 / 语音不得进入共享知识路径」的保留来源。 */
export function isReservedKnowledgeSource(
  source: string,
  sourceRef: string | null | undefined,
): boolean {
  const haystacks = [source, sourceRef ?? ''];
  return haystacks.some((value) =>
    RESERVED_RAW_TUTOR_SOURCE_PREFIXES.some((prefix) => value.startsWith(prefix)),
  );
}

/**
 * 主体能否**读取**该知识文档。
 *
 * 硬约束：
 * - 只有 `verified` 文档可被检索 / 读取；
 * - `school` 必须同校；`project` 必须明确可访问；`student` 仅本人；
 * - 未知作用域与未知角色一律拒绝（fail closed）。
 */
export function canReadKnowledgeDocument(
  document: Pick<KnowledgeDocument, 'scope' | 'status' | 'schoolId' | 'ownerUserId' | 'projectId'>,
  context: KnowledgeReadContext,
): boolean {
  if (document.status !== 'verified') return false;
  switch (document.scope) {
    case 'system':
      return true;
    case 'school':
      return (
        present(document.schoolId) &&
        present(context.actor.schoolId) &&
        document.schoolId === context.actor.schoolId
      );
    case 'project':
      return (
        present(context.projectId) &&
        document.projectId === context.projectId &&
        context.projectAccessible
      );
    case 'student':
      return present(document.ownerUserId) && document.ownerUserId === context.actor.actorId;
    default:
      return false;
  }
}

/**
 * 主体能否**维护**（新建 / 修订 / 校验）某个作用域的文档。
 *
 * - `system`：仅平台管理员；
 * - `school`：管理员，或本校教师（教师的 `schoolId` 必须与目标学校一致）；
 * - `project`：管理员，或可访问该项目的教师 / 学生；
 * - `student`：仅学生本人。
 */
export function evaluateKnowledgeWrite(
  actor: KnowledgeActorContext,
  fields: KnowledgeScopeFields,
  projectAccessible: boolean,
): KnowledgeWriteDecision {
  const shape = validateKnowledgeScopeShape(fields);
  if (!shape.valid) {
    return deny('scope_invalid', shape.message ?? '作用域绑定字段不合法');
  }

  switch (fields.scope) {
    case 'system':
      return actor.role === 'admin'
        ? ALLOW
        : deny('forbidden', '仅管理员可维护平台系统知识');
    case 'school':
      if (actor.role !== 'admin' && actor.role !== 'teacher') {
        return deny('forbidden', '仅本校教师或管理员可维护校本知识');
      }
      if (actor.role === 'teacher' && actor.schoolId !== fields.schoolId) {
        return deny('forbidden', '不能维护其他学校的知识');
      }
      return ALLOW;
    case 'project':
      if (actor.role === 'admin') return ALLOW;
      if ((actor.role === 'teacher' || actor.role === 'student') && projectAccessible) {
        return ALLOW;
      }
      return deny('forbidden', '无权维护该项目知识');
    case 'student':
      if (actor.role === 'student' && actor.actorId === fields.ownerUserId) return ALLOW;
      return deny('forbidden', '仅学生本人可维护私有知识');
    default:
      return deny('scope_invalid', '未知知识作用域');
  }
}
