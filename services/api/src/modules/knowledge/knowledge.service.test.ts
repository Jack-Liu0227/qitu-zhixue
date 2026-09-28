import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { KnowledgeActorContext } from './knowledge.scope-policy';
import { KnowledgeService } from './knowledge.service';
import {
  assertHttpError,
  makeActor,
  makeDocument,
  makeKnowledgeHarness,
} from './knowledge.test-helpers';

const CONTEXTS: Record<string, KnowledgeActorContext> = {
  'admin-1': { actorId: 'admin-1', role: 'admin', schoolId: 'school-a' },
  'teacher-a': { actorId: 'teacher-a', role: 'teacher', schoolId: 'school-a' },
  'teacher-b': { actorId: 'teacher-b', role: 'teacher', schoolId: 'school-b' },
  'student-1': { actorId: 'student-1', role: 'student', schoolId: 'school-a' },
  'student-2': { actorId: 'student-2', role: 'student', schoolId: 'school-a' },
};

const PROJECT_ACCESS = {
  'student-1': ['proj-1'],
  'teacher-a': ['proj-1'],
};

function harness(): ReturnType<typeof makeKnowledgeHarness> {
  return makeKnowledgeHarness({ contexts: CONTEXTS, projectAccess: PROJECT_ACCESS });
}

/* ==================== 幂等写入 ==================== */

describe('KnowledgeService 写入幂等', () => {
  it('同键同载荷重放：只执行一次、只落一笔审计', async () => {
    const { service, store, audit, idempotency } = harness();
    const student = makeActor('student-1', 'student');
    const input = {
      scope: 'student' as const,
      ownerUserId: 'student-1',
      title: '我的笔记',
      content: '光合作用的关键步骤',
      source: 'student_note',
    };

    const first = await service.upsertDocument(student, input, 'key-1');
    const second = await service.upsertDocument(student, input, 'key-1');

    assert.equal(first.outcome, 'created');
    assert.equal(first.replayed, false);
    assert.equal(second.outcome, 'created');
    assert.equal(second.replayed, true);
    assert.equal(first.document.id, second.document.id);
    assert.equal(idempotency.executions, 1);
    assert.equal(audit.entries.length, 1);
    assert.equal(audit.entries[0]?.action, 'knowledge.document.create');
    assert.equal((await store.listVerifiedCandidates({ actorId: 'student-1', schoolId: 'school-a', projectId: null })).length, 0);
  });

  it('同键异载荷返回 409 幂等冲突', async () => {
    const { service } = harness();
    const student = makeActor('student-1', 'student');
    await service.upsertDocument(
      student,
      { scope: 'student', ownerUserId: 'student-1', title: 'A', content: '一', source: 'seed' },
      'key-1',
    );
    await assertHttpError(
      () =>
        service.upsertDocument(
          student,
          { scope: 'student', ownerUserId: 'student-1', title: 'B', content: '二', source: 'seed' },
          'key-1',
        ),
      409,
      'IDEMPOTENCY_CONFLICT',
    );
  });

  it('内容与元数据都不变时 unchanged，不写库也不写审计', async () => {
    const { service, audit } = harness();
    const admin = makeActor('admin-1', 'admin');
    const input = { scope: 'system' as const, title: '系统知识', content: '内容', source: 'seed' };
    const created = await service.upsertDocument(admin, input, 'k-create');
    const again = await service.upsertDocument(admin, { ...input, id: created.document.id }, 'k-noop');
    assert.equal(again.outcome, 'unchanged');
    assert.equal(audit.entries.length, 1);
  });
});

/* ==================== 修订语义 ==================== */

describe('KnowledgeService 修订 / 校验生命周期', () => {
  it('正文变更升版本并回到 draft，重新校验后回到 verified', async () => {
    const { service } = harness();
    const admin = makeActor('admin-1', 'admin');

    const created = await service.upsertDocument(
      admin,
      { scope: 'system', title: 'T', content: '第一版', source: 'seed' },
      'k1',
    );
    assert.equal(created.document.version, 'v1');
    assert.equal(created.document.status, 'draft');

    const verified = await service.verifyDocument(admin, created.document.id, 'k-verify-1');
    assert.equal(verified.document.status, 'verified');
    assert.equal(verified.document.verifiedAt !== null, true);

    const revised = await service.upsertDocument(
      admin,
      { id: created.document.id, scope: 'system', title: 'T', content: '第二版', source: 'seed' },
      'k2',
    );
    assert.equal(revised.outcome, 'revised');
    assert.equal(revised.document.version, 'v2');
    assert.equal(revised.document.status, 'draft');
    assert.equal(revised.document.verifiedAt, null);
  });

  it('仅元数据变更不升版本、不重置校验状态', async () => {
    const { service } = harness();
    const admin = makeActor('admin-1', 'admin');
    const created = await service.upsertDocument(
      admin,
      { scope: 'system', title: '旧标题', content: '正文', source: 'seed' },
      'k1',
    );
    await service.verifyDocument(admin, created.document.id, 'k-verify');

    const renamed = await service.upsertDocument(
      admin,
      { id: created.document.id, scope: 'system', title: '新标题', content: '正文', source: 'seed' },
      'k2',
    );
    assert.equal(renamed.outcome, 'revised');
    assert.equal(renamed.document.version, 'v1');
    assert.equal(renamed.document.status, 'verified');
    assert.equal(renamed.document.verifiedAt !== null, true);
  });

  it('作用域绑定在修订时不可变', async () => {
    const { service } = harness();
    const admin = makeActor('admin-1', 'admin');
    const created = await service.upsertDocument(
      admin,
      { scope: 'system', title: 'T', content: '正文', source: 'seed' },
      'k1',
    );
    await assertHttpError(
      () =>
        service.upsertDocument(
          admin,
          {
            id: created.document.id,
            scope: 'school',
            schoolId: 'school-a',
            title: 'T',
            content: '正文',
            source: 'seed',
          },
          'k2',
        ),
      400,
      'KNOWLEDGE_SCOPE_INVALID',
    );
  });

  it('重复校验是幂等空操作，不重复写审计', async () => {
    const { service, audit } = harness();
    const admin = makeActor('admin-1', 'admin');
    const created = await service.upsertDocument(
      admin,
      { scope: 'system', title: 'T', content: '正文', source: 'seed' },
      'k1',
    );
    await service.verifyDocument(admin, created.document.id, 'v1');
    const auditsAfterFirst = audit.entries.length;

    const second = await service.verifyDocument(admin, created.document.id, 'v2');
    assert.equal(second.outcome, 'unchanged');
    assert.equal(second.document.status, 'verified');
    assert.equal(audit.entries.length, auditsAfterFirst);
  });
});

/* ==================== 输入与来源守卫 ==================== */

describe('KnowledgeService 输入与来源守卫', () => {
  it('原始对话 / 语音来源被拒绝', async () => {
    const { service } = harness();
    const student = makeActor('student-1', 'student');
    await assertHttpError(
      () =>
        service.upsertDocument(
          student,
          {
            scope: 'student',
            ownerUserId: 'student-1',
            title: 'T',
            content: 'C',
            source: 'tutor_turn:abc',
          },
          'k1',
        ),
      400,
      'KNOWLEDGE_SOURCE_FORBIDDEN',
    );
    await assertHttpError(
      () =>
        service.upsertDocument(
          student,
          {
            scope: 'student',
            ownerUserId: 'student-1',
            title: 'T',
            content: 'C',
            source: 'seed',
            sourceRef: 'tutor_raw_transcript:r1',
          },
          'k2',
        ),
      400,
      'KNOWLEDGE_SOURCE_FORBIDDEN',
    );
  });

  it('跨校写校本知识被拒绝', async () => {
    const { service } = harness();
    const teacherB = makeActor('teacher-b', 'teacher');
    await assertHttpError(
      () =>
        service.upsertDocument(
          teacherB,
          {
            scope: 'school',
            schoolId: 'school-a',
            title: 'T',
            content: 'C',
            source: 'seed',
          },
          'k1',
        ),
      403,
      'KNOWLEDGE_FORBIDDEN',
    );
  });

  it('作用域绑定缺失时 scope_invalid', async () => {
    const { service } = harness();
    const admin = makeActor('admin-1', 'admin');
    await assertHttpError(
      () =>
        service.upsertDocument(
          admin,
          { scope: 'school', title: 'T', content: 'C', source: 'seed' },
          'k1',
        ),
      400,
      'KNOWLEDGE_SCOPE_INVALID',
    );
  });
});

/* ==================== 检索授权隔离 ==================== */

describe('KnowledgeService 检索作用域隔离与 verified-only', () => {
  function seed(store: ReturnType<typeof makeKnowledgeHarness>['store']): void {
    store.seed(makeDocument({ id: 'sys', scope: 'system', content: 'topic system' }));
    store.seed(makeDocument({ id: 'sch-a', scope: 'school', schoolId: 'school-a', content: 'topic school a' }));
    store.seed(makeDocument({ id: 'sch-b', scope: 'school', schoolId: 'school-b', content: 'topic school b' }));
    store.seed(makeDocument({ id: 'stu-1', scope: 'student', ownerUserId: 'student-1', content: 'topic student one' }));
    store.seed(makeDocument({ id: 'stu-2', scope: 'student', ownerUserId: 'student-2', content: 'topic student two' }));
    store.seed(makeDocument({ id: 'proj-1', scope: 'project', projectId: 'proj-1', content: 'topic project one' }));
    store.seed(makeDocument({ id: 'proj-2', scope: 'project', projectId: 'proj-2', content: 'topic project two' }));
    store.seed(makeDocument({ id: 'draft', scope: 'system', status: 'draft', content: 'topic draft' }));
  }

  async function searchIds(
    service: KnowledgeService,
    actorReturn: ReturnType<typeof makeActor>,
    projectId?: string,
  ): Promise<string[]> {
    const result = await service.search(actorReturn, { text: 'topic', projectId, limit: 8 });
    return result.evidence.map((item) => item.document.id).sort();
  }

  it('学生只看到系统 / 本校 / 本人 / 可访问项目，排除他校、他人与草稿', async () => {
    const setup = harness();
    seed(setup.store);
    assert.deepEqual(
      await searchIds(setup.service, makeActor('student-1', 'student'), 'proj-1'),
      ['proj-1', 'sch-a', 'stu-1', 'sys'],
    );
  });

  it('他校教师看不到本校知识', async () => {
    const setup = harness();
    seed(setup.store);
    assert.deepEqual(await searchIds(setup.service, makeActor('teacher-b', 'teacher')), ['sch-b', 'sys']);
  });

  it('管理员不自动获得学生私有知识', async () => {
    const setup = harness();
    seed(setup.store);
    assert.deepEqual(await searchIds(setup.service, makeActor('admin-1', 'admin')), ['sch-a', 'sys']);
  });

  it('未授权项目即使显式请求也不返回该项目知识', async () => {
    const setup = harness();
    seed(setup.store);
    assert.deepEqual(
      await searchIds(setup.service, makeActor('student-1', 'student'), 'proj-2'),
      ['sch-a', 'stu-1', 'sys'],
    );
  });

  it('草稿在通过校验前不可检索，校验后才进入检索', async () => {
    const setup = harness();
    const student = makeActor('student-1', 'student');
    const created = await setup.service.upsertDocument(
      student,
      {
        scope: 'student',
        ownerUserId: 'student-1',
        title: '光合作用',
        content: 'topic 光合作用把光能转成化学能',
        source: 'student_note',
      },
      'k1',
    );
    assert.deepEqual(await searchIds(setup.service, student), []);

    await setup.service.verifyDocument(student, created.document.id, 'v1');
    assert.deepEqual(await searchIds(setup.service, student), [created.document.id]);
  });

  it('证据投影有界且标记 active', async () => {
    const setup = harness();
    const admin = makeActor('admin-1', 'admin');
    const longContent = 'topic '.repeat(200);
    const doc = await setup.service.upsertDocument(
      admin,
      { scope: 'system', title: '长文', content: longContent, source: 'seed' },
      'k1',
    );
    await setup.service.verifyDocument(admin, doc.document.id, 'v1');
    const result = await setup.service.search(admin, { text: 'topic', limit: 4 });
    assert.equal(result.evidence.length, 1);
    assert.equal(result.evidence[0]?.document.active, true);
    assert.ok((result.evidence[0]?.document.content.length ?? 0) <= 361);
  });
});

/* ==================== 单篇读取授权 ==================== */

describe('KnowledgeService 单篇读取授权', () => {
  it('他人学生私有文档返回 404，不泄露存在性', async () => {
    const setup = harness();
    setup.store.seed(
      makeDocument({ id: 'stu-1', scope: 'student', ownerUserId: 'student-1', content: '私密' }),
    );
    await assertHttpError(
      () => setup.service.getDocument(makeActor('student-2', 'student'), 'stu-1'),
      404,
      'KNOWLEDGE_NOT_FOUND',
    );
  });

  it('作者可读取自己的草稿，他人 404', async () => {
    const setup = harness();
    const student = makeActor('student-1', 'student');
    const created = await setup.service.upsertDocument(
      student,
      { scope: 'student', ownerUserId: 'student-1', title: 'T', content: 'C', source: 'seed' },
      'k1',
    );
    const own = await setup.service.getDocument(student, created.document.id);
    assert.equal(own.status, 'draft');
    await assertHttpError(
      () => setup.service.getDocument(makeActor('student-2', 'student'), created.document.id),
      404,
      'KNOWLEDGE_NOT_FOUND',
    );
  });
});
