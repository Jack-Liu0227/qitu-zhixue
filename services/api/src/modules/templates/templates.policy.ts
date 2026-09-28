import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { CurrentUser } from '@qitu/contracts';
import type { ProjectTemplateRecord, TemplateStatus } from './templates.types';

/**
 * 模板库的**纯策略函数**集合（无 Nest / 无数据库依赖，可直接单测）。
 *
 * 三件事在这里收敛为唯一一份实现：
 * 1. 状态机：模板 / 版本只允许合法迁移；
 * 2. 读取作用域：学生只能读「已发布 + 平台或本校」；
 * 3. 治理作用域：admin 管平台 + 全校；teacher 只管本校；其余拒绝。
 *
 * 控制器与服务层都调用这里，避免出现第二份判定导致漂移。
 */

const FORBIDDEN_MESSAGE = '无权访问该资源';

/** 允许的状态迁移。`published` 是学生可见的终态；`archived` 不可再迁出。 */
const STATUS_TRANSITIONS: Record<TemplateStatus, readonly TemplateStatus[]> = {
  draft: ['review', 'published', 'archived'],
  review: ['draft', 'published', 'archived'],
  published: ['archived'],
  archived: [],
};

export class TemplateStatusError extends ConflictException {
  constructor(message: string) {
    super({ code: 'TEMPLATE_TRANSITION_INVALID', message });
    this.name = 'TemplateStatusError';
  }
}

/** 断言 `from → to` 是合法迁移，否则 409 + 稳定错误码。 */
export function assertTemplateStatusTransition(
  from: TemplateStatus,
  to: TemplateStatus,
): void {
  if (!STATUS_TRANSITIONS[from].includes(to)) {
    throw new TemplateStatusError(`模板状态不允许从 ${from} 迁移到 ${to}`);
  }
}

/** 某模板是否对指定学校的学生可见（只读已发布）。 */
export function canStudentReadTemplate(
  template: ProjectTemplateRecord,
  viewerSchoolId: string | null,
): boolean {
  if (template.status !== 'published') return false;
  if (template.schoolId === null) return true;
  return viewerSchoolId !== null && template.schoolId === viewerSchoolId;
}

/** 断言学生可读；不可读一律 403，且不因资源是否存在而改变（由调用方先查再判）。 */
export function assertStudentCanReadTemplate(
  template: ProjectTemplateRecord,
  viewerSchoolId: string | null,
): void {
  if (!canStudentReadTemplate(template, viewerSchoolId)) {
    throw new ForbiddenException(FORBIDDEN_MESSAGE);
  }
}

/**
 * 治理端能否编辑某模板。
 *
 * - `admin`：平台模板与校级模板都可编辑；
 * - `teacher`：只能编辑**本校**（schoolId 非空且等于其 schoolId）的模板；
 * - 其余角色：403。
 */
export function canGovernTemplate(
  actor: Pick<CurrentUser, 'role'>,
  template: Pick<ProjectTemplateRecord, 'schoolId'>,
  actorSchoolId: string | null,
): boolean {
  if (actor.role === 'admin') return true;
  if (actor.role === 'teacher') {
    return (
      template.schoolId !== null &&
      actorSchoolId !== null &&
      template.schoolId === actorSchoolId
    );
  }
  return false;
}

export function assertCanGovernTemplate(
  actor: Pick<CurrentUser, 'role'>,
  template: Pick<ProjectTemplateRecord, 'schoolId'>,
  actorSchoolId: string | null,
): void {
  if (!canGovernTemplate(actor, template, actorSchoolId)) {
    throw new ForbiddenException(FORBIDDEN_MESSAGE);
  }
}

/**
 * 解析「新建模板」的归属学校：
 * - admin 可显式指定 `null`（平台）或某学校；未指定默认平台；
 * - teacher 一律绑定自己的 schoolId，不能创建平台模板，也不能指定他校；
 * - 其余角色 403。
 *
 * 返回 `null` 表示平台共享模板。
 */
export function resolveTemplateCreationScope(
  actor: Pick<CurrentUser, 'role'>,
  requestedSchoolId: string | null | undefined,
  actorSchoolId: string | null,
): string | null {
  if (actor.role === 'admin') {
    return requestedSchoolId ?? null;
  }
  if (actor.role === 'teacher') {
    if (actorSchoolId === null) {
      throw new ForbiddenException('班主任账号未绑定学校，无法创建模板');
    }
    if (requestedSchoolId != null && requestedSchoolId !== actorSchoolId) {
      throw new ForbiddenException(FORBIDDEN_MESSAGE);
    }
    return actorSchoolId;
  }
  throw new ForbiddenException(FORBIDDEN_MESSAGE);
}
