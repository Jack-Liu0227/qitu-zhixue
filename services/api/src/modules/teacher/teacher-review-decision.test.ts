import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CurrentUser } from '@qitu/contracts';
import type { AuditEntry } from '../../common/audit/audit-entry';
import type { AuditWriter } from '../../common/audit/audit.service';
import type { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { IdempotencyError } from '../../common/idempotency/idempotency.errors';
import type { DirectoryService } from '../directory/directory.service';
import type { PlatformDataService } from '../platform-data/platform-data.service';
import { InMemoryWorksStore } from '../works/works.store';
import { TeacherController } from './teacher.controller';
import { TutorService } from '../ai-tutor/tutor.service';
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
 * 服务层：只读边界
 * ------------------------------------------------------------------ */

describe('teacher learning permissions are read-only', () => {
  it('current and former teachers cannot approve, reject or change an artifact; no writes or audit mutations', async () => {
    const h = makeHarness(); h.reviews.seed(seedReview());
    for (const actor of [MENTOR, OTHER_TEACHER]) {
      for (const decision of ['approved', 'changes_requested', 'rejected'] as const) {
        await assertHttpError(() => h.service.decideReview(actor, 'mr-1', { decision }), 403, 'TEACHER_LEARNING_READ_ONLY');
      }
    }
    assert.equal((await h.reviews.findReviewById('mr-1'))?.status, 'requested');
    assert.equal(h.reviews.writeCalls, 0); assert.equal(h.audit.entries.length, 0);
    assert.equal((await h.service.requireAssignedReview(MENTOR, 'mr-1')).id, 'mr-1');
    await assertHttpError(() => h.service.requireAssignedReview(OTHER_TEACHER, 'mr-1'), 403);
  });

  it('HTTP actions cannot replay a cached historical approval or intervention', async () => {
    const h = makeHarness(); h.reviews.seed(seedReview());
    let executions = 0;
    const keys = { execute: async () => { executions++; return { body: { status: 'approved' }, replayed: true }; } } as unknown as IdempotencyStore;
    const controller = new TeacherController(h.service,
      { getSession: () => ({ user: MENTOR }) } as unknown as AuthService, {} as FeedbackService, keys);
    for (const key of ['old-approved-key', undefined]) {
      await assertHttpError(() => controller.decideReview('qitu_session=fixture', key, 'mr-1', { decision: 'approved' }), 403, 'TEACHER_LEARNING_READ_ONLY');
    }
    await assertHttpError(() => h.service.recordInterventionAction(MENTOR.id, 'issue', 'resolve'), 403, 'TEACHER_LEARNING_READ_ONLY');
    assert.equal(executions, 0); assert.equal(h.reviews.writeCalls, 0);
  });

  it('legacy tutor intervention cannot reset a session or authorize progression, including admin callers', async () => {
    for (const role of ['teacher', 'admin'] as const) {
      for (const actionType of ['线下点拨', '降低难度', '定向放行'] as const) {
        await assertHttpError(() => TutorService.prototype.applyTeacherIntervention.call(
          {} as TutorService, 'session', MENTOR.id, { actionType }, role, 'historical-key'),
        403, 'TEACHER_LEARNING_READ_ONLY');
      }
    }
  });

  it('student cannot enter the legacy teacher decision route', async () => {
    const h = makeHarness();
    const controller = new TeacherController(h.service,
      { getSession: () => ({ user: STUDENT_ACTOR }) } as unknown as AuthService,
      {} as FeedbackService, new FakeIdempotencyStore() as unknown as IdempotencyStore);
    await assertHttpError(() => controller.decideReview('qitu_session=fixture', 'key', 'mr-1', { decision: 'approved' }), 403);
  });
});
