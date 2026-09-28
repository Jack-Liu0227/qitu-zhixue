import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Role } from '@qitu/contracts';
import {
  assertCanGovernTemplate,
  assertStudentCanReadTemplate,
  assertTemplateStatusTransition,
  canGovernTemplate,
  canStudentReadTemplate,
  resolveTemplateCreationScope,
} from './templates.policy';
import type { ProjectTemplateRecord, TemplateStatus } from './templates.types';

function template(overrides: Partial<ProjectTemplateRecord> = {}): ProjectTemplateRecord {
  const now = new Date('2026-01-01T00:00:00.000Z');
  return {
    id: 'tpl-1',
    schoolId: null,
    slug: 'mini-robot',
    title: '迷你机器人',
    summary: 'summary',
    domain: null,
    ageRange: null,
    difficulty: null,
    estimatedDurationMinutes: null,
    requiredMaterials: [],
    learningObjectives: [],
    outcomeForm: null,
    safetyNotes: null,
    status: 'draft',
    createdBy: 'admin-1',
    verifiedBy: null,
    verifiedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('模板状态机', () => {
  it('允许 draft/review → published，拒绝 published → draft 与 archived 迁出', () => {
    assert.doesNotThrow(() => assertTemplateStatusTransition('draft', 'published'));
    assert.doesNotThrow(() => assertTemplateStatusTransition('review', 'published'));
    assert.doesNotThrow(() => assertTemplateStatusTransition('published', 'archived'));
    for (const [from, to] of [
      ['published', 'draft'],
      ['archived', 'published'],
      ['archived', 'draft'],
    ] as [TemplateStatus, TemplateStatus][]) {
      assert.throws(
        () => assertTemplateStatusTransition(from, to),
        (error: unknown) => {
          const http = error as { getStatus?: () => number; getResponse?: () => { code?: string } };
          assert.equal(http.getStatus?.(), 409);
          assert.equal(http.getResponse?.().code, 'TEMPLATE_TRANSITION_INVALID');
          return true;
        },
      );
    }
  });
});

describe('学生读取作用域', () => {
  it('平台模板对任意学校已发布可见', () => {
    assert.equal(canStudentReadTemplate(template({ status: 'published' }), 'school-b'), true);
  });

  it('未发布模板一律不可见', () => {
    assert.equal(canStudentReadTemplate(template({ status: 'draft' }), null), false);
    assert.equal(canStudentReadTemplate(template({ status: 'review' }), 'school-a'), false);
  });

  it('校属模板只对本校可见，他校 / 无学校 403', () => {
    const schoolTemplate = template({ status: 'published', schoolId: 'school-a' });
    assert.equal(canStudentReadTemplate(schoolTemplate, 'school-a'), true);
    assert.equal(canStudentReadTemplate(schoolTemplate, 'school-b'), false);
    assert.equal(canStudentReadTemplate(schoolTemplate, null), false);
    assert.throws(() => assertStudentCanReadTemplate(schoolTemplate, 'school-b'));
  });
});

describe('治理作用域', () => {
  it('admin 管平台与所有学校；teacher 只管本校；其余拒绝', () => {
    assert.equal(canGovernTemplate({ role: 'admin' }, template(), null), true);
    assert.equal(canGovernTemplate({ role: 'admin' }, template({ schoolId: 'school-a' }), null), true);
    assert.equal(
      canGovernTemplate({ role: 'teacher' }, template({ schoolId: 'school-a' }), 'school-a'),
      true,
    );
    assert.equal(
      canGovernTemplate({ role: 'teacher' }, template({ schoolId: 'school-b' }), 'school-a'),
      false,
    );
    assert.equal(
      canGovernTemplate({ role: 'teacher' }, template({ schoolId: null }), 'school-a'),
      false,
    );
    assert.equal(canGovernTemplate({ role: 'student' }, template(), null), false);
    assert.throws(() => assertCanGovernTemplate({ role: 'student' }, template(), null), (error) => {
      assert.equal((error as { getStatus: () => number }).getStatus(), 403);
      return true;
    });
  });
});

describe('新建模板归属解析', () => {
  it('admin 可建平台模板或指定学校', () => {
    assert.equal(resolveTemplateCreationScope({ role: 'admin' }, null, 'school-a'), null);
    assert.equal(resolveTemplateCreationScope({ role: 'admin' }, 'school-b', null), 'school-b');
  });

  it('teacher 强制绑定本校，未绑定学校或指定他校 403', () => {
    assert.equal(resolveTemplateCreationScope({ role: 'teacher' }, undefined, 'school-a'), 'school-a');
    assert.equal(resolveTemplateCreationScope({ role: 'teacher' }, 'school-a', 'school-a'), 'school-a');
    assert.throws(() => resolveTemplateCreationScope({ role: 'teacher' }, 'school-b', 'school-a'));
    assert.throws(() => resolveTemplateCreationScope({ role: 'teacher' }, undefined, null));
  });

  it('学生 / 家长不能创建模板', () => {
    for (const role of ['student', 'parent'] as Role[]) {
      assert.throws(() => resolveTemplateCreationScope({ role }, null, null), (error) => {
        assert.equal((error as { getStatus: () => number }).getStatus(), 403);
        return true;
      });
    }
  });
});
