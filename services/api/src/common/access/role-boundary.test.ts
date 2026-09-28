import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException } from '@nestjs/common';
import type { CurrentUser } from '@qitu/contracts';
import { requireRole } from './request-auth';
import type { AuthService } from '../../modules/identity-auth/auth.service';

/**
 * 角色闸门的回归测试（T8 / ADR 0008）。
 *
 * 这一组只验证「粗粒度角色边界」：管理员不能调用班主任日常接口，班主任也不能
 * 调用管理员治理接口。对象级判定（能否读某个具体学生）由 `access-policy.rules.test.ts`
 * 覆盖；两者合起来保证「前端隐藏入口」不是唯一防线。
 */

const cookie = 'qitu_session=test-token';

function authReturning(user: CurrentUser): AuthService {
  return {
    getSession: () => ({
      user,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }),
  } as unknown as AuthService;
}

const admin = authReturning({
  id: 'a1',
  email: 'admin@qitu.local',
  displayName: '平台管理员',
  role: 'admin',
});

const teacher = authReturning({
  id: 't1',
  email: 'teacher@qitu.local',
  displayName: '班主任',
  role: 'teacher',
});

test('管理员不能调用班主任日常接口（后端角色闸门 403）', () => {
  assert.throws(
    () => requireRole(admin, cookie, 'teacher', '仅班主任可操作'),
    ForbiddenException,
  );
});

test('班主任不能调用管理员治理接口（反向闸门同样 403）', () => {
  assert.throws(
    () => requireRole(teacher, cookie, 'admin', '仅管理员可操作'),
    ForbiddenException,
  );
});

test('角色匹配时正常放行', () => {
  assert.equal(requireRole(teacher, cookie, 'teacher', '仅班主任可操作').id, 't1');
  assert.equal(requireRole(admin, cookie, 'admin', '仅管理员可操作').id, 'a1');
});
