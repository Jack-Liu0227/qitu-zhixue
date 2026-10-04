import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canAdminReadIndividualStudent,
  canReadStudentByRelationship,
} from './access-policy.rules';

/**
 * `AccessPolicy` 判定矩阵的纯函数单测。
 *
 * 本包已通过 `pnpm test` 运行本目录的纯规则单测（编译到 `.tmp/test-dist` 后用
 * `node --test`，随 turbo test / CI 运行），覆盖 T8 的失败关闭回归；
 * 关系解析（DirectoryService）的集成测试等测试运行器覆盖更广后补。
 */

const noRelationship = { guardianOfStudent: false, mentorOfStudent: false };

test('student 只能读取自己', () => {
  assert.equal(
    canReadStudentByRelationship({ id: 's1', role: 'student' }, 's1', noRelationship),
    true,
  );
  assert.equal(
    canReadStudentByRelationship({ id: 's1', role: 'student' }, 's2', noRelationship),
    false,
  );
});

test('parent 只有存在 active 监护关系时才能读取孩子', () => {
  assert.equal(
    canReadStudentByRelationship({ id: 'p1', role: 'parent' }, 's1', {
      guardianOfStudent: true,
      mentorOfStudent: false,
    }),
    true,
  );
  assert.equal(
    canReadStudentByRelationship({ id: 'p1', role: 'parent' }, 's1', noRelationship),
    false,
  );
});

test('teacher 只有被分配为学生当前班主任时才能读取', () => {
  assert.equal(
    canReadStudentByRelationship({ id: 't1', role: 'teacher' }, 's1', {
      guardianOfStudent: false,
      mentorOfStudent: true,
    }),
    true,
  );
  assert.equal(
    canReadStudentByRelationship({ id: 't1', role: 'teacher' }, 's1', noRelationship),
    false,
  );
});

test('admin 个别学生访问在显式授权模型落地前一律拒绝（fail closed）', () => {
  // ADR 0008 决定 6 / 产品文档 7.0 / docs/shared/PERMISSIONS.md §5：管理员查看个别学生
  // 数据必须同时满足「对象级范围 + 最小字段 + 原因 + 二次确认 + 审计 + 限时」。
  // 这些能力尚未落地，所以这里必须拒绝，而不是默认放行——否则「前端隐藏入口」
  // 就成了唯一防线（见 ADR 0008「前端隐藏不构成授权」）。
  assert.equal(canAdminReadIndividualStudent(), false);
  assert.equal(
    canReadStudentByRelationship({ id: 'a1', role: 'admin' }, 's1', noRelationship),
    false,
  );
  // 即使存在监护 / 班主任关系，管理员也不会因此获得个别学生读取权。
  assert.equal(
    canReadStudentByRelationship({ id: 'a1', role: 'admin' }, 's1', {
      guardianOfStudent: true,
      mentorOfStudent: true,
    }),
    false,
  );
});

test('support 未定范围一律拒绝', () => {
  assert.equal(
    canReadStudentByRelationship({ id: 'x1', role: 'support' }, 's1', {
      guardianOfStudent: true,
      mentorOfStudent: true,
    }),
    false,
  );
});
