import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';

import type { AuditEntry } from '../../common/audit/audit-entry';
import { AuditWriter } from '../../common/audit/audit.service';
import { IdempotencyError } from '../../common/idempotency/idempotency.errors';
import type { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import type { DirectoryPersonRef } from '@qitu/contracts';
import type { DirectoryService } from '../directory/directory.service';
import type { PlatformDataService } from '../platform-data/platform-data.service';
import { InMemoryFeedbackAttachmentRegistry } from './feedback.attachments';
import { FeedbackService } from './feedback.service';

/* ------------------------------------------------------------------ *
 * 测试替身
 * ------------------------------------------------------------------ */

function person(userId: string, displayName: string, role: DirectoryPersonRef['role']): DirectoryPersonRef {
  return { userId, email: `${userId}@qtzx.local`, displayName, role };
}

/** 仅用到的目录真源：家长-孩子、孩子-当前班主任。 */
function makeDirectory() {
  const users: Record<string, DirectoryPersonRef> = {
    'student-demo': person('student-demo', '演示学生', 'student'),
    'student-demo-2': person('student-demo-2', '演示学生二', 'student'),
    'parent-demo': person('parent-demo', '演示家长', 'parent'),
    'parent-demo-2': person('parent-demo-2', '演示家长二', 'parent'),
    'teacher-demo': person('teacher-demo', '演示班主任', 'teacher'),
    'teacher-demo-2': person('teacher-demo-2', '演示班主任二', 'teacher'),
  };
  const guardians: Record<string, string[]> = {
    'parent-demo': ['student-demo'],
    'parent-demo-2': ['student-demo-2'],
  };
  const mentors: Record<string, string> = {
    'student-demo': 'teacher-demo',
    'student-demo-2': 'teacher-demo-2',
  };
  const directory = {
    findUser: async (id: string) => users[id] ?? null,
    childrenOfParent: async (pid: string) => (guardians[pid] ?? []).map((id) => users[id]),
    mentorOfStudent: async (sid: string) => (mentors[sid] ? users[mentors[sid]] : null),
    studentsOfMentor: async (tid: string) =>
      Object.entries(mentors)
        .filter(([, mentorId]) => mentorId === tid)
        .map(([studentId]) => users[studentId]),
  };
  return directory as unknown as DirectoryService;
}

/**
 * `IdempotencyStore` 的内存替身：真实实现要连库，这里保持相同的可观察语义——
 * 首次执行并记住 `(scope,key)`，同键同载荷重放，同键异载荷冲突。
 */
class FakeIdempotencyStore {
  private readonly records = new Map<string, { hash: string; body: unknown }>();
  executions = 0;

  async execute<T>(
    scope: string,
    key: string,
    requestHash: string,
    handler: () => Promise<{ status?: number; body: T }>,
  ): Promise<{ status: number; body: T; replayed: boolean }> {
    const id = `${scope}::${key}`;
    const existing = this.records.get(id);
    if (existing !== undefined) {
      if (existing.hash !== requestHash) {
        throw new IdempotencyError('IDEMPOTENCY_CONFLICT', 'conflict');
      }
      return { status: 200, body: existing.body as T, replayed: true };
    }
    this.executions += 1;
    const outcome = await handler();
    this.records.set(id, { hash: requestHash, body: outcome.body });
    return { status: outcome.status ?? 200, body: outcome.body, replayed: false };
  }
}

class FakeAuditWriter {
  readonly entries: AuditEntry[] = [];
  failNext = false;

  async write(entry: AuditEntry): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('audit store unavailable');
    }
    this.entries.push(entry);
  }
}

interface Harness {
  service: FeedbackService;
  idempotency: FakeIdempotencyStore;
  audit: FakeAuditWriter;
  attachments: InMemoryFeedbackAttachmentRegistry;
}

/**
 * 数据模式用 `'live'`：`FeedbackService` 只在 demo/test 注入演示工单，
 * 测试要自己控制初始状态，所以显式关掉种子。
 */
function makeHarness(): Harness {
  const messages: Record<string, { id: string; childId: string; projectTitle: string | null }> = {
    'message-1': { id: 'message-1', childId: 'student-demo', projectTitle: '校园植物观察手册' },
  };
  const projects: Record<string, { projectId: string; title: string; studentId: string }> = {
    'project-demo-001': {
      projectId: 'project-demo-001',
      title: '校园植物观察手册',
      studentId: 'student-demo',
    },
  };
  const platformData = {
    getMessage: (id: string) => messages[id] ?? null,
    getProject: (id: string) => projects[id] ?? null,
  } as unknown as PlatformDataService;

  const idempotency = new FakeIdempotencyStore();
  const audit = new FakeAuditWriter();
  const attachments = new InMemoryFeedbackAttachmentRegistry();
  const service = new FeedbackService(
    makeDirectory(),
    platformData,
    attachments,
    idempotency as unknown as IdempotencyStore,
    audit as unknown as AuditWriter,
    'live',
  );
  return { service, idempotency, audit, attachments };
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    const candidate = error as { getResponse?: () => unknown };
    const response = typeof candidate.getResponse === 'function' ? candidate.getResponse() : error;
    assert.equal(
      (response as { code?: string }).code,
      code,
      `期望错误码 ${code}，实际为 ${JSON.stringify(response)}`,
    );
    return true;
  });
}

function submitBody(overrides: Record<string, unknown> = {}) {
  return {
    source: 'general' as const,
    childId: 'student-demo',
    content: '想了解孩子最近的学习状态',
    messageId: null,
    projectId: null,
    ...overrides,
  };
}

/* ------------------------------------------------------------------ *
 * 用例
 * ------------------------------------------------------------------ */

describe('FeedbackService 授权', () => {
  let harness: Harness;
  beforeEach(() => {
    harness = makeHarness();
  });

  it('家长只能看到自己绑定孩子的工单，越权返回 FEEDBACK_NOT_FOUND', async () => {
    await expectCode(
      harness.service.submitParentFeedback('parent-demo-2', submitBody(), 'k-1'),
      'FEEDBACK_NOT_FOUND',
    );
    // 越权提交不应该留下任何工单
    assert.equal(harness.idempotency.executions, 0);
  });

  it('general 来源允许不关联孩子，并保留家长对象归属', async () => {
    const ticket = await harness.service.submitParentFeedback(
      'parent-demo',
      submitBody({ childId: null }),
      'k-2',
    );
    assert.equal(ticket.childId, null);
    assert.equal(ticket.childDisplayName, '未关联孩子');
    assert.equal(ticket.owner, null);
    assert.equal((await harness.service.getForParent('parent-demo', ticket.id)).id, ticket.id);
    await expectCode(harness.service.getForParent('parent-demo-2', ticket.id), 'FEEDBACK_NOT_FOUND');
  });

  it('message 来源从消息推导孩子，且拒绝与声明不一致的 childId', async () => {
    const ok = await harness.service.submitParentFeedback(
      'parent-demo',
      submitBody({ source: 'message', childId: null, messageId: 'message-1' }),
      'k-3',
    );
    assert.equal(ok.childId, 'student-demo');
    assert.equal(ok.projectTitle, '校园植物观察手册');

    await expectCode(
      harness.service.submitParentFeedback(
        'parent-demo',
        submitBody({ source: 'message', childId: 'student-demo-2', messageId: 'message-1' }),
        'k-4',
      ),
      'FEEDBACK_INVALID',
    );
  });

  it('project 来源从项目推导孩子', async () => {
    const ticket = await harness.service.submitParentFeedback(
      'parent-demo',
      submitBody({ source: 'project', childId: null, projectId: 'project-demo-001' }),
      'k-5',
    );
    assert.equal(ticket.childId, 'student-demo');
    assert.equal(ticket.projectId, 'project-demo-001');
  });

  it('家长不能读取别的孩子的工单详情（404，不泄露存在性）', async () => {
    const ticket = await harness.service.submitParentFeedback('parent-demo', submitBody(), 'k-6');
    await expectCode(harness.service.getForParent('parent-demo-2', ticket.id), 'FEEDBACK_NOT_FOUND');
    // 同一个工单属于 parent-demo 的孩子
    const own = await harness.service.getForParent('parent-demo', ticket.id);
    assert.equal(own.id, ticket.id);
  });

  it('班主任只能看到自己当前学生的工单', async () => {
    await harness.service.submitParentFeedback('parent-demo', submitBody(), 'k-7');
    await harness.service.submitParentFeedback(
      'parent-demo-2',
      submitBody({ childId: 'student-demo-2' }),
      'k-8',
    );

    const teacherRows = await harness.service.listForTeacher('teacher-demo');
    assert.equal(teacherRows.length, 1);
    assert.equal(teacherRows[0]?.studentId, 'student-demo');

    const otherRows = await harness.service.listForTeacher('teacher-demo-2');
    assert.equal(otherRows.length, 1);
    assert.equal(otherRows[0]?.studentId, 'student-demo-2');
  });

  it('非本班班主任回复别的学生工单返回 STUDENT_NOT_ASSIGNED，且不泄露学生字段', async () => {
    const ticket = await harness.service.submitParentFeedback('parent-demo', submitBody(), 'k-9');
    await expectCode(
      harness.service.replyToFeedback(
        'teacher-demo-2',
        ticket.id,
        { content: '我来看看' },
        'r-1',
      ),
      'STUDENT_NOT_ASSIGNED',
    );
  });
});

describe('FeedbackService 状态机', () => {
  let harness: Harness;
  beforeEach(() => {
    harness = makeHarness();
  });

  it('提交后为 processing；班主任回复后为 replied', async () => {
    const ticket = await harness.service.submitParentFeedback('parent-demo', submitBody(), 'k-1');
    assert.equal(ticket.status, 'processing');
    assert.equal(ticket.owner, '演示班主任');

    const replied = await harness.service.replyToFeedback(
      'teacher-demo',
      ticket.id,
      { content: '建议先观察一周' },
      'r-1',
    );
    assert.equal(replied.status, 'replied');
    assert.equal(replied.entries.at(-1)?.kind, 'replied');
    assert.equal(replied.entries.at(-1)?.content, '建议先观察一周');
  });

  it('家长确认解决后为 resolved；此时班主任不能直接回复', async () => {
    const ticket = await harness.service.submitParentFeedback('parent-demo', submitBody(), 'k-1');
    await harness.service.replyToFeedback('teacher-demo', ticket.id, { content: '已处理' }, 'r-1');

    const resolved = await harness.service.confirmParentFeedback(
      'parent-demo',
      ticket.id,
      { resolved: true, note: null },
      'c-1',
    );
    assert.equal(resolved.status, 'resolved');
    assert.equal(resolved.entries.at(-1)?.kind, 'confirmed');
    assert.equal(resolved.entries.at(-1)?.resolved, true);

    await expectCode(
      harness.service.replyToFeedback('teacher-demo', ticket.id, { content: '再补一条' }, 'r-2'),
      'FEEDBACK_TRANSITION_INVALID',
    );
  });

  it('家长确认未解决后重新打开，班主任可以继续回复', async () => {
    const ticket = await harness.service.submitParentFeedback('parent-demo', submitBody(), 'k-1');
    await harness.service.replyToFeedback('teacher-demo', ticket.id, { content: '第一次回复' }, 'r-1');

    const reopened = await harness.service.confirmParentFeedback(
      'parent-demo',
      ticket.id,
      { resolved: false, note: '还是不太明白' },
      'c-1',
    );
    assert.equal(reopened.status, 'reopened');
    assert.equal(reopened.entries.at(-1)?.kind, 'reopened');
    assert.equal(reopened.entries.at(-1)?.resolved, false);

    const repliedAgain = await harness.service.replyToFeedback(
      'teacher-demo',
      ticket.id,
      { content: '换个说法再讲一次' },
      'r-2',
    );
    assert.equal(repliedAgain.status, 'replied');
  });

  it('已解决的工单不允许家长补充', async () => {
    const ticket = await harness.service.submitParentFeedback('parent-demo', submitBody(), 'k-1');
    await harness.service.replyToFeedback('teacher-demo', ticket.id, { content: '已处理' }, 'r-1');
    await harness.service.confirmParentFeedback(
      'parent-demo',
      ticket.id,
      { resolved: true, note: null },
      'c-1',
    );

    await expectCode(
      harness.service.supplementParentFeedback(
        'parent-demo',
        ticket.id,
        { content: '再补充一点' },
        's-1',
      ),
      'FEEDBACK_TRANSITION_INVALID',
    );
  });

  it('processing 状态下「确认未解决」返回 FEEDBACK_TRANSITION_INVALID', async () => {
    const ticket = await harness.service.submitParentFeedback('parent-demo', submitBody(), 'k-1');
    await expectCode(
      harness.service.confirmParentFeedback(
        'parent-demo',
        ticket.id,
        { resolved: false, note: null },
        'c-1',
      ),
      'FEEDBACK_TRANSITION_INVALID',
    );
  });

  it('内容为空或超长返回 FEEDBACK_INVALID', async () => {
    await expectCode(
      harness.service.submitParentFeedback('parent-demo', submitBody({ content: '   ' }), 'k-1'),
      'FEEDBACK_INVALID',
    );
    await expectCode(
      harness.service.submitParentFeedback(
        'parent-demo',
        submitBody({ content: 'x'.repeat(501) }),
        'k-2',
      ),
      'FEEDBACK_INVALID',
    );
  });
});

describe('FeedbackService 幂等与审计', () => {
  let harness: Harness;
  beforeEach(() => {
    harness = makeHarness();
  });

  it('相同幂等键重放不会产生第二张工单', async () => {
    const first = await harness.service.submitParentFeedback('parent-demo', submitBody(), 'same-key');
    const second = await harness.service.submitParentFeedback('parent-demo', submitBody(), 'same-key');
    assert.equal(second.id, first.id);
    assert.equal(harness.idempotency.executions, 1);

    const tickets = await harness.service.listForParent('parent-demo', 'student-demo');
    assert.equal(tickets.length, 1);
  });

  it('相同幂等键、不同载荷返回 IDEMPOTENCY_CONFLICT', async () => {
    await harness.service.submitParentFeedback('parent-demo', submitBody(), 'same-key');
    await expectCode(
      harness.service.submitParentFeedback(
        'parent-demo',
        submitBody({ content: '换一个内容' }),
        'same-key',
      ),
      'IDEMPOTENCY_CONFLICT',
    );
  });

  it('业务写入成功但审计暂时失败时，重放同一幂等键不会追加第二条记录', async () => {
    harness.audit.failNext = true;
    await assert.rejects(
      harness.service.submitParentFeedback('parent-demo', submitBody(), 'retry-key'),
      /audit store unavailable/,
    );

    const retried = await harness.service.submitParentFeedback('parent-demo', submitBody(), 'retry-key');
    const tickets = await harness.service.listForParent('parent-demo', 'student-demo');
    assert.equal(tickets.length, 1);
    assert.equal(tickets[0]?.id, retried.id);
  });

  it('审计只记录过程事实，不落反馈原文', async () => {
    const secret = '孩子最近有点抵触学习，我很担心';
    await harness.service.submitParentFeedback(
      'parent-demo',
      submitBody({ content: secret }),
      'k-1',
    );
    assert.ok(harness.audit.entries.length >= 1);
    assert.ok(!JSON.stringify(harness.audit.entries).includes(secret));
    assert.equal(harness.audit.entries[0]?.action, 'feedback.submit');
    assert.equal(harness.audit.entries[0]?.actorRole, 'parent');
  });
});

describe('FeedbackService 附件归属', () => {
  let harness: Harness;
  beforeEach(() => {
    harness = makeHarness();
  });

  it('未登记或属于他人的附件一律拒绝', async () => {
    harness.attachments.register('att-mine', 'parent-demo');
    harness.attachments.register('att-other', 'parent-demo-2');

    await expectCode(
      harness.service.submitParentFeedback(
        'parent-demo',
        submitBody({ attachmentRefs: ['att-other'] }),
        'k-1',
      ),
      'FEEDBACK_ATTACHMENT_INVALID',
    );
    await expectCode(
      harness.service.submitParentFeedback(
        'parent-demo',
        submitBody({ attachmentRefs: ['att-unknown'] }),
        'k-2',
      ),
      'FEEDBACK_ATTACHMENT_INVALID',
    );
  });

  it('登记且属于当前账号的附件可以写入工单', async () => {
    harness.attachments.register('att-mine', 'parent-demo');
    const ticket = await harness.service.submitParentFeedback(
      'parent-demo',
      submitBody({ attachmentRefs: ['att-mine'] }),
      'k-1',
    );
    assert.deepEqual(ticket.entries[0]?.attachmentRefs, ['att-mine']);
  });

  it('班主任回复时同样校验附件归属', async () => {
    const ticket = await harness.service.submitParentFeedback('parent-demo', submitBody(), 'k-1');
    harness.attachments.register('att-parent', 'parent-demo');

    await expectCode(
      harness.service.replyToFeedback(
        'teacher-demo',
        ticket.id,
        { content: '回复', attachmentRefs: ['att-parent'] },
        'r-1',
      ),
      'FEEDBACK_ATTACHMENT_INVALID',
    );
  });
});
