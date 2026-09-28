import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  canReadKnowledgeDocument,
  evaluateKnowledgeWrite,
  isReservedKnowledgeSource,
  validateKnowledgeScopeShape,
  type KnowledgeActorContext,
  type KnowledgeReadContext,
} from './knowledge.scope-policy';
import type { KnowledgeScopeFields } from './knowledge.types';

/* ==================== 工厂 ==================== */

function actor(overrides: Partial<KnowledgeActorContext> = {}): KnowledgeActorContext {
  return { actorId: 'user-1', role: 'student', schoolId: 'school-a', ...overrides };
}

function readContext(
  actorContext: KnowledgeActorContext,
  overrides: Partial<KnowledgeReadContext> = {},
): KnowledgeReadContext {
  return { actor: actorContext, projectId: null, projectAccessible: false, ...overrides };
}

const SYSTEM: KnowledgeScopeFields = {
  scope: 'system',
  schoolId: null,
  ownerUserId: null,
  projectId: null,
};

/* ==================== scope 隔离 ==================== */

describe('knowledge 作用域隔离', () => {
  it('system 知识对所有已认证主体可读', () => {
    for (const role of ['student', 'teacher', 'parent', 'admin', 'support'] as const) {
      assert.equal(
        canReadKnowledgeDocument(
          { scope: 'system', status: 'verified', schoolId: null, ownerUserId: null, projectId: null },
          readContext(actor({ role, schoolId: null })),
        ),
        true,
        `${role} 应可读系统知识`,
      );
    }
  });

  it('school 知识仅同校可读：同校通过、他校 / 无校拒绝', () => {
    const document = {
      scope: 'school' as const,
      status: 'verified' as const,
      schoolId: 'school-a',
      ownerUserId: null,
      projectId: null,
    };
    assert.equal(canReadKnowledgeDocument(document, readContext(actor({ schoolId: 'school-a' }))), true);
    assert.equal(canReadKnowledgeDocument(document, readContext(actor({ schoolId: 'school-b' }))), false);
    assert.equal(canReadKnowledgeDocument(document, readContext(actor({ schoolId: null }))), false);
  });

  it('project 知识仅项目可访问者可读：须同时命中 projectId 且授权通过', () => {
    const document = {
      scope: 'project' as const,
      status: 'verified' as const,
      schoolId: null,
      ownerUserId: null,
      projectId: 'proj-1',
    };
    assert.equal(
      canReadKnowledgeDocument(
        document,
        readContext(actor(), { projectId: 'proj-1', projectAccessible: true }),
      ),
      true,
    );
    // 授权未通过
    assert.equal(
      canReadKnowledgeDocument(
        document,
        readContext(actor(), { projectId: 'proj-1', projectAccessible: false }),
      ),
      false,
    );
    // 请求了另一个项目
    assert.equal(
      canReadKnowledgeDocument(
        document,
        readContext(actor(), { projectId: 'proj-2', projectAccessible: true }),
      ),
      false,
    );
  });

  it('student 私有知识仅本人可读，监护 / 班主任 / 管理员均拒绝', () => {
    const document = {
      scope: 'student' as const,
      status: 'verified' as const,
      schoolId: null,
      ownerUserId: 'student-1',
      projectId: null,
    };
    assert.equal(
      canReadKnowledgeDocument(document, readContext(actor({ actorId: 'student-1', role: 'student' }))),
      true,
    );
    for (const viewer of [
      actor({ actorId: 'parent-1', role: 'parent' }),
      actor({ actorId: 'teacher-1', role: 'teacher' }),
      actor({ actorId: 'admin-1', role: 'admin' }),
    ]) {
      assert.equal(
        canReadKnowledgeDocument(document, readContext(viewer)),
        false,
        `${viewer.role} 不应读到学生私有知识`,
      );
    }
  });

  it('未知作用域 fail closed', () => {
    const document = {
      scope: 'unknown' as unknown as 'system',
      status: 'verified' as const,
      schoolId: null,
      ownerUserId: null,
      projectId: null,
    };
    assert.equal(canReadKnowledgeDocument(document, readContext(actor())), false);
  });
});

/* ==================== verified-only ==================== */

describe('knowledge 仅已校验知识可读', () => {
  for (const status of ['draft', 'archived'] as const) {
    it(`${status} 即使作用域匹配也不可读`, () => {
      assert.equal(
        canReadKnowledgeDocument(
          { scope: 'system', status, schoolId: null, ownerUserId: null, projectId: null },
          readContext(actor()),
        ),
        false,
      );
    });
  }
});

/* ==================== 写权限矩阵 ==================== */

describe('knowledge 写权限矩阵', () => {
  it('system：仅管理员可写', () => {
    assert.equal(evaluateKnowledgeWrite(actor({ role: 'admin' }), SYSTEM, false).allowed, true);
    for (const role of ['teacher', 'student', 'parent', 'support'] as const) {
      assert.equal(
        evaluateKnowledgeWrite(actor({ role }), SYSTEM, false).allowed,
        false,
        `${role} 不应可写系统知识`,
      );
    }
  });

  it('school：本校教师 / 管理员可写，他校教师拒绝', () => {
    const school: KnowledgeScopeFields = {
      scope: 'school',
      schoolId: 'school-a',
      ownerUserId: null,
      projectId: null,
    };
    assert.equal(
      evaluateKnowledgeWrite(actor({ role: 'teacher', schoolId: 'school-a' }), school, false).allowed,
      true,
    );
    assert.equal(
      evaluateKnowledgeWrite(actor({ role: 'teacher', schoolId: 'school-b' }), school, false).allowed,
      false,
    );
    assert.equal(evaluateKnowledgeWrite(actor({ role: 'admin', schoolId: null }), school, false).allowed, true);
    assert.equal(evaluateKnowledgeWrite(actor({ role: 'student' }), school, false).allowed, false);
  });

  it('project：可访问项目的教师 / 学生与管理员可写', () => {
    const project: KnowledgeScopeFields = {
      scope: 'project',
      schoolId: null,
      ownerUserId: null,
      projectId: 'proj-1',
    };
    assert.equal(evaluateKnowledgeWrite(actor({ role: 'student' }), project, true).allowed, true);
    assert.equal(evaluateKnowledgeWrite(actor({ role: 'student' }), project, false).allowed, false);
    assert.equal(evaluateKnowledgeWrite(actor({ role: 'teacher' }), project, true).allowed, true);
    assert.equal(evaluateKnowledgeWrite(actor({ role: 'parent' }), project, true).allowed, false);
    assert.equal(evaluateKnowledgeWrite(actor({ role: 'admin' }), project, false).allowed, true);
  });

  it('student：仅本人可写', () => {
    const own: KnowledgeScopeFields = {
      scope: 'student',
      schoolId: null,
      ownerUserId: 'student-1',
      projectId: null,
    };
    assert.equal(
      evaluateKnowledgeWrite(actor({ actorId: 'student-1', role: 'student' }), own, false).allowed,
      true,
    );
    assert.equal(
      evaluateKnowledgeWrite(actor({ actorId: 'student-2', role: 'student' }), own, false).allowed,
      false,
    );
  });

  it('作用域与绑定字段不一致时 scope_invalid', () => {
    const decision = evaluateKnowledgeWrite(actor({ role: 'admin' }), {
      scope: 'school',
      schoolId: null,
      ownerUserId: null,
      projectId: null,
    }, false);
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, 'scope_invalid');
  });
});

/* ==================== 结构校验 & 来源守卫 ==================== */

describe('knowledge 作用域结构与来源校验', () => {
  it('校验各作用域必填 / 互斥字段', () => {
    assert.equal(validateKnowledgeScopeShape(SYSTEM).valid, true);
    assert.equal(
      validateKnowledgeScopeShape({
        scope: 'school',
        schoolId: null,
        ownerUserId: null,
        projectId: null,
      }).valid,
      false,
    );
    assert.equal(
      validateKnowledgeScopeShape({
        scope: 'student',
        schoolId: null,
        ownerUserId: null,
        projectId: null,
      }).valid,
      false,
    );
    assert.equal(
      validateKnowledgeScopeShape({
        scope: 'system',
        schoolId: 'school-a',
        ownerUserId: null,
        projectId: null,
      }).valid,
      false,
    );
  });

  it('原始对话 / 语音来源被拒绝', () => {
    assert.equal(isReservedKnowledgeSource('tutor_turn:abc', null), true);
    assert.equal(isReservedKnowledgeSource('tutor_conversation:c1', null), true);
    assert.equal(isReservedKnowledgeSource('tutor_raw_transcript:r1', null), true);
    assert.equal(isReservedKnowledgeSource('voice_raw:v1', null), true);
    assert.equal(isReservedKnowledgeSource('seed', 'tutor_raw_audio:a1'), true);
    assert.equal(isReservedKnowledgeSource('seed', 'curriculum:plan-1'), false);
  });
});
