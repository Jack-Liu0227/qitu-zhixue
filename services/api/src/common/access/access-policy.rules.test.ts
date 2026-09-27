import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canReadStudentByRelationship } from './access-policy.rules';

/**
 * `AccessPolicy` 判定矩阵的纯函数单测。
 *
 * 目前仓库尚未接入 TS 测试运行器（`pnpm test` 仍是占位脚本），
 * 因此这里只覆盖不依赖 Nest / 数据库的纯规则；关系解析（DirectoryService）
 * 的集成测试等测试运行器落地后补。
 *
 * 本地可临时编译后运行（项目 `tsconfig` 已是 `noEmit: false`，
 * `tsc -p tsconfig.json` 即可产出可执行 JS）：
 *   cd services/api
 *   npx tsc -p tsconfig.json --outDir /tmp/qitu-access
 *   node --test /tmp/qitu-access/common/access/access-policy.rules.test.js
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

test('admin 平台治理放行，support 未定范围一律拒绝', () => {
  assert.equal(
    canReadStudentByRelationship({ id: 'a1', role: 'admin' }, 's1', noRelationship),
    true,
  );
  assert.equal(
    canReadStudentByRelationship({ id: 'x1', role: 'support' }, 's1', {
      guardianOfStudent: true,
      mentorOfStudent: true,
    }),
    false,
  );
});
