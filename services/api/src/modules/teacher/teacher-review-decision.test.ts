import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';

import type { CurrentUser } from '@qitu/contracts';
import type { AuditEntry } from '../../common/audit/audit-entry';
import type { AuditWriter } from '../../common/audit/audit.service';
import type { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { IdempotencyError } from '../../common/idempotency/idempotency.errors';
import type { DirectoryService } from '../directory/directory.service';
import type { PlatformDataService } from '../platform-data/platform-data.service';
import { InMemoryWorksStore } from '../works/works.store';
import { TeacherController } from './teacher.controller';
import type { AuthService } from '../identity-auth/auth.service';
import type { FeedbackService } from '../feedback/feedback.service';
import {
  InMemoryTeacherReviewRepository,
  TeacherService,
  TEACHER_REVIEW_ERROR_CODES,
  type TeacherReviewRecord,
  type TeacherReviewRepository,
} from './teacher.service';

/* ------------------------------------------------------------------ *
 * 替身
 * ------------------------------------------------------------------ */

class FakeAuditWriter {
  readonly entries: AuditEntry[] = [];
  async write(entry: AuditEntry): Promise<string> {
    this.entries.push(entry);
    return `audit-${this.entries.length}`;
  }
}

class FakeIdempotencyStore {
  private readonly records = new Map<string, { hash: string; body: unknown; status: number }>();
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
      if (existing.hash !== requestHash) throw new IdempotencyError('IDEMPOTENCY_CONFLICT', 'conflict');
      return { status: existing.status, body: existing.body as T, replayed: true };
    }
    this.executions += 1;
    const outcome = await handler();
    this.records.set(id, { hash: requestHash, body: outcome.body, status: outcome.status ?? 200 });
    return { status: outcome.status ?? 200, body: outcome.body, replayed: false };
  }
}

/** 记录写入调用次数的内存存储（证明「重放 0 写入」而不是只看返回值）。 */
class CountingReviewRepository extends InMemoryTeacherReviewRepository {
  writeCalls = 0;

  override async applyDecision(
    input: Parameters<InMemoryTeacherReviewRepository['applyDecision']>[0],
  ): Promise<'applied' | 'stale'> {
    this.writeCalls += 1;
    return super.applyDecision(input);
  }
}

const MENTOR: CurrentUser = { id: 'mentor-1', email: 'm@e.com', displayName: '班主任', role: 'teacher' };
const OTHER_TEACHER: CurrentUser = { id: 'mentor-2', email: 'm2@e.com', displayName: '另一个班主任', role: 'teacher' };
const STUDENT_ACTOR: CurrentUser = { id: 'student-1', email: 's@e.com', displayName: '学生', role: 'student' };

const ARTIFACT_ID = 'artf-thunder-fighter';

function seedReview(overrides: Partial<TeacherReviewRecord> = {}): TeacherReviewRecord {
  const now = new Date('2026-10-10T00:00:00.000Z');
  return {
    id: 'mr-1',
    schoolId: 'school-1',
    studentUserId: 'stu-1',
    mentorUserId: 'mentor-1',
    projectId: 'proj-1',
    artifactRef: ARTIFACT_ID,
    kind: 'artifact',
    status: 'requested',
    decision: null,
    comment: null,
    idempotencyKey: 'student.artifact.publish:stu-1:artf-1:review',
    requestedAt: now,
    reviewedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

interface Harness {
  service: TeacherService;
  reviews: CountingReviewRepository;
  audit: FakeAuditWriter;
}

/**
 * `mentorIdByStudent` 就是 `mentor_assignments(status='active')` 的替身：
 * 只有表里仍指向该班主任时，`studentsOfMentor` 才返回这个学生。
 */
function makeHarness(mentorIdByStudent: Record<string, string> = { 'stu-1': 'mentor-1' }): Harness {
  const audit = new FakeAuditWriter();
  const reviews = new CountingReviewRepository(audit as unknown as AuditWriter);
  const directory = {
    async studentsOfMentor(mentorUserId: string) {
      return Object.entries(mentorIdByStudent)
        .filter(([, mentor]) => mentor === mentorUserId)
        .map(([studentId]) => ({
          userId: studentId,
          displayName: studentId,
          email: `${studentId}@e.com`,
          role: 'student' as const,
        }));
    },
  } as unknown as DirectoryService;
  const platformData = {} as PlatformDataService;
  const service = new TeacherService(directory, platformData, undefined, reviews);
  return { service, reviews, audit };
}

async function assertHttpError(fn: () => Promise<unknown>, status: number, code?: string): Promise<void> {
  await assert.rejects(fn, (error: unknown) => {
    const httpError = error as { getStatus?: () => number; getResponse?: () => { code?: string } };
    assert.equal(httpError.getStatus?.(), status, `期望 HTTP ${status}`);
    if (code !== undefined) assert.equal(httpError.getResponse?.()?.code, code);
    return true;
  });
}

/* ------------------------------------------------------------------ *
 * 服务层：审批真源
 * ------------------------------------------------------------------ */

describe('班主任复核审批 — 服务层', () => {
  it('当前班主任 approve：status/decision/reviewedAt 落值正确，审计恰 1 条', async () => {
    const { service, reviews, audit } = makeHarness();
    reviews.seed(seedReview());

    const response = await service.decideReview(MENTOR, 'mr-1', {
      decision: 'approved',
      comment: '碰撞检测讲清楚了，可以发布。',
    });

    assert.equal(response.status, 'approved');
    assert.equal(response.decision, 'approved');
    assert.equal(response.idempotentReplay, false);
    assert.equal(response.reviewedAt, response.updatedAt);
    assert.ok(Date.parse(response.reviewedAt) > 0, 'reviewedAt 必须是服务端时间戳');

    const stored = await reviews.findReviewById('mr-1');
    assert.ok(stored !== null);
    assert.equal(stored.status, 'approved');
    assert.equal(stored.decision, 'approved');
    assert.equal(stored.comment, '碰撞检测讲清楚了，可以发布。');
    assert.ok(stored.reviewedAt instanceof Date);

    // 归属与门禁谓词字段必须原样保留：发布分支靠 artifact_ref + status 读这行。
    assert.equal(stored.kind, 'artifact');
    assert.equal(stored.artifactRef, ARTIFACT_ID);
    assert.equal(stored.projectId, 'proj-1');
    assert.equal(stored.studentUserId, 'stu-1');
    assert.equal(stored.mentorUserId, 'mentor-1');
    assert.equal(stored.idempotencyKey, 'student.artifact.publish:stu-1:artf-1:review');

    assert.equal(audit.entries.length, 1, '审批必须留下恰好一条审计');
    const entry = audit.entries[0]!;
    assert.equal(entry.action, 'mentor_review.decision');
    assert.equal(entry.targetType, 'mentor_review');
    assert.equal(entry.targetId, 'mr-1');
    assert.equal(entry.actorId, 'mentor-1');
    assert.equal(entry.actorRole, 'teacher');
    const detail = entry.detail as Record<string, unknown>;
    assert.equal(detail.reviewId, 'mr-1');
    assert.equal(detail.studentUserId, 'stu-1');
    assert.equal(detail.kind, 'artifact');
    assert.equal(detail.decision, 'approved');
    // 未成年人数据最小化：审计里不出现学生原始对话，只记班主任反馈的长度。
    assert.equal(typeof detail.commentLength, 'number');
    assert.equal('comment' in detail, false);
  });

  it('非该复核归属的班主任（同班但行不属于他）→ 403，0 写入 0 审计', async () => {
    const { service, reviews, audit } = makeHarness({ 'stu-1': 'mentor-1' });
    reviews.seed(seedReview({ id: 'mr-9', mentorUserId: 'mentor-9' }));

    await assertHttpError(
      () => service.decideReview(MENTOR, 'mr-9', { decision: 'approved' }),
      403,
      TEACHER_REVIEW_ERROR_CODES.NOT_OWNER,
    );
    assert.equal(reviews.writeCalls, 0);
    assert.equal(audit.entries.length, 0);
    const stored = await reviews.findReviewById('mr-9');
    assert.equal(stored?.status, 'requested', '被拒请求不得改动复核行');
  });

  it('换了班主任：行里的 mentor 仍是自己，但已不是该生当前班主任 → 403，0 写入', async () => {
    // mentor_assignments 已把 stu-1 指给 mentor-2；mentor-1 手里那条 mr-1 不能再批。
    const { service, reviews, audit } = makeHarness({ 'stu-1': 'mentor-2' });
    reviews.seed(seedReview());

    await assertHttpError(
      () => service.decideReview(MENTOR, 'mr-1', { decision: 'approved' }),
      403,
      'STUDENT_NOT_ASSIGNED',
    );
    assert.equal(reviews.writeCalls, 0);
    assert.equal(audit.entries.length, 0);
  });

  it('复核不存在 → 404 REVIEW_NOT_FOUND', async () => {
    const { service, reviews } = makeHarness();
    await assertHttpError(
      () => service.decideReview(MENTOR, 'mr-missing', { decision: 'approved' }),
      404,
      TEACHER_REVIEW_ERROR_CODES.NOT_FOUND,
    );
    assert.equal(reviews.writeCalls, 0);
  });

  it('同决定重复提交 → 幂等重放：DB 仍 1 行、审计仍 1 条、0 次写入', async () => {
    const { service, reviews, audit } = makeHarness();
    reviews.seed(seedReview());

    const first = await service.decideReview(MENTOR, 'mr-1', { decision: 'approved', comment: '通过' });
    assert.equal(first.idempotentReplay, false);
    assert.equal(reviews.writeCalls, 1);
    assert.equal(audit.entries.length, 1);

    const second = await service.decideReview(MENTOR, 'mr-1', { decision: 'approved', comment: '通过' });
    assert.equal(second.idempotentReplay, true);
    assert.equal(second.status, 'approved');
    assert.equal(reviews.writeCalls, 1, '重放不得再次写库');
    assert.equal(audit.entries.length, 1, '重放不得再次审计');

    const stored = await reviews.findReviewById('mr-1');
    assert.equal(stored?.comment, '通过', '重放不得覆盖已有 comment');
  });

  it('已 approved 再提交 changes_requested → 409，行保持 approved', async () => {
    const { service, reviews, audit } = makeHarness();
    reviews.seed(seedReview());
    await service.decideReview(MENTOR, 'mr-1', { decision: 'approved' });
    const auditBefore = audit.entries.length;

    await assertHttpError(
      () => service.decideReview(MENTOR, 'mr-1', { decision: 'changes_requested', comment: '改一下' }),
      409,
      TEACHER_REVIEW_ERROR_CODES.DECISION_CONFLICT,
    );
    const stored = await reviews.findReviewById('mr-1');
    assert.equal(stored?.status, 'approved');
    assert.equal(stored?.comment, null);
    assert.equal(reviews.writeCalls, 1);
    assert.equal(audit.entries.length, auditBefore);
  });

  it('已 rejected 再提交 approved → 409（终态不可篡改）', async () => {
    const { service, reviews } = makeHarness();
    reviews.seed(seedReview({ status: 'rejected', decision: 'rejected', reviewedAt: new Date() }));
    await assertHttpError(
      () => service.decideReview(MENTOR, 'mr-1', { decision: 'approved' }),
      409,
      TEACHER_REVIEW_ERROR_CODES.DECISION_CONFLICT,
    );
  });

  it('changes_requested 不是终态：学生改完后同一班主任可以 approve', async () => {
    const { service, reviews } = makeHarness();
    reviews.seed(seedReview());
    const first = await service.decideReview(MENTOR, 'mr-1', { decision: 'changes_requested', comment: '补上发射冷却' });
    assert.equal(first.status, 'changes_requested');
    const second = await service.decideReview(MENTOR, 'mr-1', { decision: 'approved', comment: '现在可以了' });
    assert.equal(second.status, 'approved');
    assert.equal(second.idempotentReplay, false);
  });

  it('并发：CAS 失败的一方重读后走幂等重放，绝不第二次写', async () => {
    // 另一个事务先落定为 approved：本方读到 requested，CAS 失败，重读后不得再写。
    const shared = new InMemoryTeacherReviewRepository();
    shared.seed(seedReview());
    let reads = 0;
    let writes = 0;
    const racing = {
      async findReviewById(id: string) {
        reads += 1;
        // 第一次读（权限/终态判定前）：requested；CAS 失败后的重读：approved。
        if (reads === 1) return shared.findReviewById(id);
        const winner = await shared.findReviewById(id);
        return winner === null ? null : { ...winner, status: 'approved', decision: 'approved' };
      },
      async applyDecision() {
        writes += 1;
        return 'stale' as const;
      },
    };
    const service = new TeacherService(
      {
        async studentsOfMentor() {
          return [{ userId: 'stu-1', displayName: 'stu-1', email: 's@e.com', role: 'student' as const }];
        },
      } as unknown as DirectoryService,
      {} as PlatformDataService,
      undefined,
      racing as unknown as TeacherReviewRepository,
    );

    const response = await service.decideReview(MENTOR, 'mr-1', { decision: 'approved' });
    assert.equal(response.idempotentReplay, true);
    assert.equal(response.status, 'approved');
    assert.equal(writes, 1, 'CAS 只能试一次，不得重试覆盖');

    // 反之：并发落定成不同决定时必须 409，不能静默改成胜者。
    reads = 0;
    const loser = {
      async findReviewById(id: string) {
        reads += 1;
        const base = await shared.findReviewById(id);
        if (base === null) return null;
        return reads === 1 ? base : { ...base, status: 'rejected', decision: 'rejected' };
      },
      async applyDecision() {
        return 'stale' as const;
      },
    };
    const losingService = new TeacherService(
      {
        async studentsOfMentor() {
          return [{ userId: 'stu-1', displayName: 'stu-1', email: 's@e.com', role: 'student' as const }];
        },
      } as unknown as DirectoryService,
      {} as PlatformDataService,
      undefined,
      loser as unknown as TeacherReviewRepository,
    );
    await assertHttpError(
      () => losingService.decideReview(MENTOR, 'mr-1', { decision: 'approved' }),
      409,
      TEACHER_REVIEW_ERROR_CODES.DECISION_CONFLICT,
    );
  });

  it('存储缺位时诚实 503，不在内存里假装批复成功', async () => {
    const service = new TeacherService(
      {
        async studentsOfMentor() {
          return [{ userId: 'stu-1', displayName: 'stu-1', email: 's@e.com', role: 'student' as const }];
        },
      } as unknown as DirectoryService,
      {} as PlatformDataService,
    );
    await assertHttpError(
      () => service.decideReview(MENTOR, 'mr-1', { decision: 'approved' }),
      503,
      TEACHER_REVIEW_ERROR_CODES.UNAVAILABLE,
    );
  });
});

/* ------------------------------------------------------------------ *
 * 控制器层：角色闸门、幂等键、body 白名单
 * ------------------------------------------------------------------ */

function makeController(harness: Harness, actor: CurrentUser) {
  const auth = { getSession: () => ({ user: actor }) } as unknown as AuthService;
  const idempotency = new FakeIdempotencyStore();
  const controller = new TeacherController(
    harness.service,
    auth,
    {} as FeedbackService,
    idempotency as unknown as IdempotencyStore,
  );
  return { controller, idempotency };
}

describe('班主任复核审批 — 控制器', () => {
  let harness: Harness;
  beforeEach(() => {
    harness = makeHarness();
    harness.reviews.seed(seedReview());
  });

  it('student 调用 → 403（角色级，进不到服务层）', async () => {
    const { controller, idempotency } = makeController(harness, STUDENT_ACTOR);
    await assertHttpError(
      () => controller.decideReview('qitu_session=t', 'key-1', 'mr-1', { decision: 'approved' }),
      403,
    );
    assert.equal(idempotency.executions, 0);
    assert.equal(harness.reviews.writeCalls, 0);
  });

  it('缺 Idempotency-Key → 400 IDEMPOTENCY_KEY_REQUIRED 且 0 写入', async () => {
    const { controller } = makeController(harness, MENTOR);
    await assertHttpError(
      () => controller.decideReview('qitu_session=t', undefined, 'mr-1', { decision: 'approved' }),
      400,
      'IDEMPOTENCY_KEY_REQUIRED',
    );
    await assertHttpError(
      () => controller.decideReview('qitu_session=t', '   ', 'mr-1', { decision: 'approved' }),
      400,
      'IDEMPOTENCY_KEY_REQUIRED',
    );
    assert.equal(harness.reviews.writeCalls, 0);
  });

  it('body 里带 idempotencyKey 不生效 → 400（未知字段；键只认请求头）', async () => {
    const { controller } = makeController(harness, MENTOR);
    await assertHttpError(
      () => controller.decideReview('qitu_session=t', 'key-1', 'mr-1', { decision: 'approved', idempotencyKey: 'body-key' }),
      400,
      TEACHER_REVIEW_ERROR_CODES.REQUEST_INVALID,
    );
    assert.equal(harness.reviews.writeCalls, 0);
    assert.equal(harness.audit.entries.length, 0);
  });

  it('body 直写 studentUserId / mentorUserId / projectId / kind → 400', async () => {
    const { controller } = makeController(harness, MENTOR);
    for (const field of ['studentUserId', 'mentorUserId', 'projectId', 'kind', 'artifactRef', 'status']) {
      await assertHttpError(
        () => controller.decideReview('qitu_session=t', `key-${field}`, 'mr-1', { decision: 'approved', [field]: 'x' }),
        400,
        TEACHER_REVIEW_ERROR_CODES.REQUEST_INVALID,
      );
    }
    assert.equal(harness.reviews.writeCalls, 0);
  });

  it('decision 缺失或不在枚举内 → 400', async () => {
    const { controller } = makeController(harness, MENTOR);
    for (const body of [{}, { decision: 'approved_by_admin' }, { decision: 1 }, null, [1]]) {
      await assertHttpError(
        () => controller.decideReview('qitu_session=t', 'key-1', 'mr-1', body),
        400,
        TEACHER_REVIEW_ERROR_CODES.REQUEST_INVALID,
      );
    }
  });

  it('comment 超长 → 400', async () => {
    const { controller } = makeController(harness, MENTOR);
    await assertHttpError(
      () => controller.decideReview('qitu_session=t', 'key-1', 'mr-1', { decision: 'approved', comment: 'x'.repeat(2001) }),
      400,
      TEACHER_REVIEW_ERROR_CODES.REQUEST_INVALID,
    );
  });

  it('同键同载荷重放：不重复执行 handler；同键不同载荷 → 409 IDEMPOTENCY_CONFLICT', async () => {
    const { controller, idempotency } = makeController(harness, MENTOR);
    const first = await controller.decideReview('qitu_session=t', 'key-1', 'mr-1', { decision: 'approved' });
    assert.equal(first.data.idempotentReplay, false);
    const replay = await controller.decideReview('qitu_session=t', 'key-1', 'mr-1', { decision: 'approved' });
    assert.equal(replay.data.reviewId, first.data.reviewId);
    assert.equal(idempotency.executions, 1, '同键同载荷只执行一次');

    await assertHttpError(
      () => controller.decideReview('qitu_session=t', 'key-1', 'mr-1', { decision: 'rejected' }),
      409,
      'IDEMPOTENCY_CONFLICT',
    );
  });
});

/* ------------------------------------------------------------------ *
 * 与作品发布的闭环（不改 works，只证明门禁查询能被满足）
 * ------------------------------------------------------------------ */

describe('班主任复核审批 → 作品发布门禁闭环', () => {
  /**
   * 发布分支的查询谓词（真源）：
   * - Postgres：`services/api/src/modules/works/works.store.postgres.ts:255-268`
   *   `WHERE artifact_ref = <artifactId> AND status = 'approved'
   *    ORDER BY created_at DESC LIMIT 1`
   * - 内存等价实现：`works.store.ts:341-346`（同谓词）
   * 这里用**真实的** `InMemoryWorksStore.findApprovedReviewForArtifact` 跑那条谓词，
   * 输入是审批后的行（字段逐条对齐），而不是自造的判断。
   */
  it('approved 之后，findApprovedReviewForArtifact 能读到该行', async () => {
    const { service, reviews } = makeHarness();
    reviews.seed(seedReview());
    await service.decideReview(MENTOR, 'mr-1', { decision: 'approved', comment: '可以发布' });
    const decided = await reviews.findReviewById('mr-1');
    assert.ok(decided !== null);

    // 用真实的 works store 承载审批后的行，再跑发布分支的查询。
    const worksStore = new InMemoryWorksStore();
    await worksStore.createMentorReview({
      id: decided.id,
      schoolId: decided.schoolId,
      studentId: decided.studentUserId,
      mentorUserId: decided.mentorUserId,
      projectId: decided.projectId,
      artifactId: decided.artifactRef!,
      status: decided.status as 'approved',
      idempotencyKey: decided.idempotencyKey,
      now: decided.updatedAt,
    });

    const approved = await worksStore.findApprovedReviewForArtifact(ARTIFACT_ID);
    assert.ok(approved !== null, '发布分支必须能查到已批准的复核行');
    assert.equal(approved.id, 'mr-1');
    assert.equal(approved.kind, 'artifact', 'kind 必须保持 artifact，不得被审批改写');
    assert.equal(approved.status, 'approved');

    // 未批准的另一个作品不会误命中（谓词按 artifact_ref 精确匹配）。
    assert.equal(await worksStore.findApprovedReviewForArtifact('artf-other'), null);
  });

  it('changes_requested（非 approved）不会被发布分支当成通过证据', async () => {
    const worksStore = new InMemoryWorksStore();
    await worksStore.createMentorReview({
      id: 'mr-2',
      schoolId: 'school-1',
      studentId: 'stu-1',
      mentorUserId: 'mentor-1',
      projectId: 'proj-1',
      artifactId: ARTIFACT_ID,
      status: 'changes_requested',
      idempotencyKey: 'idem-mr-2',
      now: new Date(),
    });
    assert.equal(await worksStore.findApprovedReviewForArtifact(ARTIFACT_ID), null);
  });
});
