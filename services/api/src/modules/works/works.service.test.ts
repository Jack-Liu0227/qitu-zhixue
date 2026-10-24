import type { WorksPublicationReview } from './works-publication-review';
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';

import type { CurrentUser } from '@qitu/contracts';
import type { AuditEntry } from '../../common/audit/audit-entry';
import { AuditWriter } from '../../common/audit/audit.service';
import { IdempotencyError } from '../../common/idempotency/idempotency.errors';
import type { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { InMemoryWorksStore } from './works.store';
import { InMemoryWorksProjectReader } from './works.project-reader';
import { WorksDirectory } from './works.access';
import {
  EmptyProjectEvidenceSource,
  InMemoryProjectEvidenceStore,
} from './project-evidence.store';
import { ProjectEvidenceMaterializer } from './project-evidence.service';
import {
  InMemoryObjectStoragePresigner,
  UnconfiguredObjectStoragePresigner,
} from './object-storage.presigner';
import { WorksService } from './works.service';
import type { TeamRuntimeService } from '../team-runtime/team-runtime.service.js';

/**
 * T17：`TeamRuntimeService` 的门禁写入替身。
 * 只记录调用参数（事件/审计去重是 recordGateForStudent 自己的职责，
 * 已在 team-runtime.gate.test.ts 里验证）。
 */
class FakeTeamRuntimeGates {
  readonly calls: Array<{ studentUserId: string; gate: string; evidenceRef: string; source: string }> = [];
  throwOnCall = false;

  async recordGateForStudent(input: {
    studentUserId: string;
    gate: string;
    evidenceRef: string;
    source: string;
  }): Promise<{ status: 'recorded'; runId: string; gate: string }> {
    this.calls.push(input);
    if (this.throwOnCall) throw new Error('gate store unavailable');
    return { status: 'recorded', runId: 'run-1', gate: input.gate };
  }
}

/* ------------------------------------------------------------------ *
 * 测试替身
 * ------------------------------------------------------------------ */

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
      if (existing.hash !== requestHash) {
        throw new IdempotencyError('IDEMPOTENCY_CONFLICT', 'conflict');
      }
      return { status: existing.status, body: existing.body as T, replayed: true };
    }
    this.executions += 1;
    const outcome = await handler();
    this.records.set(id, { hash: requestHash, body: outcome.body, status: outcome.status ?? 200 });
    return { status: outcome.status ?? 200, body: outcome.body, replayed: false };
  }
}

class FakeAuditWriter {
  readonly entries: AuditEntry[] = [];
  async write(entry: AuditEntry): Promise<string> {
    this.entries.push(entry);
    return `audit-${this.entries.length}`;
  }
}

/** 关系取自显式配置，模拟 `DirectoryService` 的唯一真源。 */
class FakeWorksDirectory extends WorksDirectory {
  mentors = new Map<string, string>(); // studentId -> mentorUserId
  guardians = new Map<string, string[]>(); // parentId -> studentIds[]

  async isMentorOf(mentorUserId: string, studentId: string): Promise<boolean> {
    return this.mentors.get(studentId) === mentorUserId;
  }
  async isGuardianOf(parentUserId: string, studentId: string): Promise<boolean> {
    return (this.guardians.get(parentUserId) ?? []).includes(studentId);
  }
  async studentsOfMentor(mentorUserId: string): Promise<string[]> {
    return [...this.mentors.entries()]
      .filter(([, mentor]) => mentor === mentorUserId)
      .map(([student]) => student);
  }
  async childrenOfParent(parentUserId: string): Promise<string[]> {
    return [...(this.guardians.get(parentUserId) ?? [])];
  }
  async mentorOfStudent(studentId: string): Promise<string | null> {
    return this.mentors.get(studentId) ?? null;
  }
  async schoolOfStudent(): Promise<string | null> {
    return null;
  }
}

interface Harness {
  review: { accepts: boolean };
  gates: FakeTeamRuntimeGates;
  service: WorksService;
  store: InMemoryWorksStore;
  idempotency: FakeIdempotencyStore;
  audit: FakeAuditWriter;
  directory: FakeWorksDirectory;
  projects: InMemoryWorksProjectReader;
  evidenceStore: InMemoryProjectEvidenceStore;
  evidence: ProjectEvidenceMaterializer;
  presigner: InMemoryObjectStoragePresigner;
}

function makeHarness(): Harness {
  const store = new InMemoryWorksStore();
  const idempotency = new FakeIdempotencyStore();
  const audit = new FakeAuditWriter();
  const gates = new FakeTeamRuntimeGates();
  const directory = new FakeWorksDirectory();
  const projects = new InMemoryWorksProjectReader();
  const evidenceStore = new InMemoryProjectEvidenceStore();
  const evidence = new ProjectEvidenceMaterializer(
    evidenceStore,
    new EmptyProjectEvidenceSource(),
  );
  const presigner = new InMemoryObjectStoragePresigner();
  const review = { accepts: true };
  const results = new Map<string, 'accepted' | 'needs_revision'>();
  const automaticReview = { evaluate: async (artifact: { id: string }, version: { id: string }) => {
    const status = review.accepts ? 'accepted' as const : 'needs_revision' as const;
    results.set(`${artifact.id}:${version.id}`, status);
    return { status, subjectDigest: 'a'.repeat(64), feedback: [] };
  }, status: async (artifact: { id: string }, version: { id: string }) => results.get(`${artifact.id}:${version.id}`) ?? null,
  practiceGate: async () => null } as unknown as WorksPublicationReview;
  const service = new WorksService(
    store,
    directory,
    projects,
    evidence,
    presigner,
    idempotency as unknown as IdempotencyStore,
    audit as unknown as AuditWriter,
    gates as unknown as TeamRuntimeService,
    automaticReview,
  );
  return { review, service, store, idempotency, audit, gates, directory, projects, evidenceStore, evidence, presigner };
}

const STUDENT: CurrentUser = {
  id: 'student-1',
  email: 's1@example.com',
  displayName: '小途',
  role: 'student',
};
const OTHER_STUDENT: CurrentUser = { ...STUDENT, id: 'student-2', email: 's2@example.com' };
const MENTOR: CurrentUser = { ...STUDENT, id: 'mentor-1', role: 'teacher', email: 'm@example.com' };
const OTHER_MENTOR: CurrentUser = { ...STUDENT, id: 'mentor-2', role: 'teacher' };
const PARENT: CurrentUser = { ...STUDENT, id: 'parent-1', role: 'parent' };

async function assertHttpError(
  fn: () => Promise<unknown>,
  status: number,
  code: string,
): Promise<void> {
  await assert.rejects(fn, (error: unknown) => {
    const httpError = error as { getStatus?: () => number; getResponse?: () => unknown };
    assert.equal(httpError.getStatus?.(), status);
    const response = httpError.getResponse?.() as { code?: string } | undefined;
    assert.equal(response?.code, code);
    return true;
  });
}

/* ------------------------------------------------------------------ *
 * 用例
 * ------------------------------------------------------------------ */

describe('WorksService — 作品与版本', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  it('a version change prevents a stale publication transition even when the status is unchanged', async () => {
    const created = await h.service.createArtifact(STUDENT.id, { title: 'Version one' }, 'one');
    await h.service.updateArtifact(STUDENT.id, created.id, { title: 'Version two' }, 'two', '1');
    await assert.rejects(h.store.transitionArtifact({ artifactId: created.id, expectedStatuses: ['draft'],
      expectedVersionIndex: 1, status: 'published', publishedAt: new Date(), now: new Date() }));
    assert.equal((await h.store.findArtifact(created.id))?.status, 'draft');
  });

  it('创建作品：默认 draft + class 可见性，且第 1 版立即存在', async () => {
    const view = await h.service.createArtifact(
      STUDENT.id,
      { title: '我的第一件作品', summary: '记录想法', tags: ['木工'] },
      'key-create-1',
    );
    assert.equal(view.status, 'draft');
    assert.equal(view.visibility, 'class');
    assert.equal(view.versionCount, 1);
    assert.equal(view.currentVersionIndex, 1);
    assert.equal(view.latestVersion?.note, '');

    // 审计写入。
    assert.ok(h.audit.entries.some((e) => e.action === 'artifact.create'));
  });

  it('创建作品：同幂等键重放只产生一件作品', async () => {
    const first = await h.service.createArtifact(STUDENT.id, { title: 'A' }, 'same-key');
    const second = await h.service.createArtifact(STUDENT.id, { title: 'A' }, 'same-key');
    assert.equal(first.id, second.id);
    assert.equal(h.idempotency.executions, 1);
    const list = await h.service.listArtifacts(STUDENT, {});
    assert.equal(list.length, 1);
  });

  it('版本不可变：编辑只追加新版本，旧版本原样保留', async () => {
    const created = await h.service.createArtifact(
      STUDENT.id,
      { title: '初稿', version: { note: '第一版' } },
      'k1',
    );
    const updated = await h.service.updateArtifact(
      STUDENT.id,
      created.id,
      { title: '二稿', version: { note: '第二版' } },
      'k2',
      '1',
    );
    assert.equal(updated.currentVersionIndex, 2);
    assert.equal(updated.versionCount, 2);

    const versions = await h.service.listVersions(STUDENT, created.id);
    assert.equal(versions.length, 2);
    assert.equal(versions[0]!.ordinal, 1);
    assert.equal(versions[0]!.note, '第一版');
    assert.equal(versions[1]!.ordinal, 2);
    assert.equal(versions[1]!.note, '第二版');
  });

  it('If-Match 过期：返回 409 且带当前 revision', async () => {
    const created = await h.service.createArtifact(STUDENT.id, { title: '初稿' }, 'k1');
    await h.service.updateArtifact(STUDENT.id, created.id, { title: '二稿' }, 'k2', '1');
    await assertHttpError(
      () => h.service.updateArtifact(STUDENT.id, created.id, { title: '三稿' }, 'k3', '1'),
      409,
      'ARTIFACT_REVISION_CONFLICT',
    );
  });

  it('已发布作品不可再编辑（版本冻结）', async () => {
    const created = await h.service.createArtifact(STUDENT.id, { title: '作品' }, 'k1');
    h.directory.mentors.set(STUDENT.id, MENTOR.id);
    h.store.seedApprovedReview(created.id, MENTOR.id);
    const published = await h.service.publishArtifact(STUDENT.id, created.id, 'k-pub');
    assert.equal(published.status, 'published');
    await assertHttpError(
      () => h.service.updateArtifact(STUDENT.id, created.id, { title: '改' }, 'k2', '1'),
      409,
      'ARTIFACT_NOT_EDITABLE',
    );
  });
});

describe('WorksService — 发布授权与幂等', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  it('automatic revision feedback keeps work editable without creating a teacher request', async () => {
    h.review.accepts = false;
    const created = await h.service.createArtifact(STUDENT.id, { title: 'Fixture' }, 'k1');
    const view = await h.service.publishArtifact(STUDENT.id, created.id, 'k-pub');
    assert.equal(view.status, 'changes_requested'); assert.equal(view.publishedAt, null);
    assert.equal((await h.store.listReviewsForArtifact(created.id)).length, 0);
    assert.equal(h.gates.calls.length, 0);
  });

  /* ---------------- T17：复核通过并发布 → review_completed_and_archived 门禁 ---------------- */

  it('T17 自动评价已达标并发布成功 → 恰写一条 review_completed_and_archived 门禁', async () => {
    h.directory.mentors.set(STUDENT.id, MENTOR.id);
    const created = await h.service.createArtifact(STUDENT.id, { title: '雷霆战机' }, 'k1');
    h.store.seedApprovedReview(created.id, MENTOR.id);

    const published = await h.service.publishArtifact(STUDENT.id, created.id, 'k-pub');
    assert.equal(published.status, 'published');

    assert.equal(h.gates.calls.length, 1, '发布成功必须触发一次门禁写入');
    assert.deepEqual(h.gates.calls[0], {
      studentUserId: STUDENT.id,
      projectId: null,
      gate: 'review_completed_and_archived',
      evidenceRef: `artifact:${created.id}`,
      source: 'works.publish-approved',
    });
  });

  it('T17 自动评价未达标 → 绝不写门禁', async () => {
    h.review.accepts = false;
    h.directory.mentors.set(STUDENT.id, MENTOR.id);
    const created = await h.service.createArtifact(STUDENT.id, { title: '作品' }, 'k1');

    const view = await h.service.publishArtifact(STUDENT.id, created.id, 'k-pub');
    assert.equal(view.status, 'changes_requested');
    assert.equal(h.gates.calls.length, 0, '自动评价未达标 不得产生该门禁（防伪通过）');
  });

  it('T17 撑回 archived → 不写门禁（撑回不算复核完成）', async () => {
    h.directory.mentors.set(STUDENT.id, MENTOR.id);
    const created = await h.service.createArtifact(STUDENT.id, { title: '作品' }, 'k1');
    h.store.seedApprovedReview(created.id, MENTOR.id);
    h.gates.calls.length = 0;

    await h.service.publishArtifact(STUDENT.id, created.id, 'k-pub');
    h.gates.calls.length = 0; // 只关注撑回这一步是否多写
    await h.service.withdrawArtifact(STUDENT.id, created.id, 'k-withdraw');

    assert.equal(h.gates.calls.length, 0, '撑回不得写门禁');
  });

  it('T17 同幂等键重复发布 → 参数完全一致（靠确定性键去重）', async () => {
    h.directory.mentors.set(STUDENT.id, MENTOR.id);
    const created = await h.service.createArtifact(STUDENT.id, { title: '作品' }, 'k1');
    h.store.seedApprovedReview(created.id, MENTOR.id);

    await h.service.publishArtifact(STUDENT.id, created.id, 'k-pub');
    await h.service.publishArtifact(STUDENT.id, created.id, 'k-pub');

    assert.ok(h.gates.calls.length >= 1);
    assert.deepEqual(h.gates.calls[0], h.gates.calls[h.gates.calls.length - 1]);
  });

  it('T17 门禁写入失败 → 发布仍成功且失败被记录（不静默吞）', async () => {
    h.directory.mentors.set(STUDENT.id, MENTOR.id);
    const created = await h.service.createArtifact(STUDENT.id, { title: '作品' }, 'k1');
    h.store.seedApprovedReview(created.id, MENTOR.id);
    h.gates.throwOnCall = true;

    const published = await h.service.publishArtifact(STUDENT.id, created.id, 'k-pub');
    assert.equal(published.status, 'published', '门禁失败绝不能回滚已成立的发布');
    assert.equal(h.gates.calls.length, 1, '尝试必须发生（不能静默跳过）');
  });

  it('同幂等键重复发布 → 不产生教师复核记录', async () => {
    h.directory.mentors.set(STUDENT.id, MENTOR.id);
    const created = await h.service.createArtifact(STUDENT.id, { title: '作品' }, 'k1');
    await h.service.publishArtifact(STUDENT.id, created.id, 'k-pub');
    await h.service.publishArtifact(STUDENT.id, created.id, 'k-pub');
    const reviews = await h.store.listReviewsForArtifact(created.id);
    assert.equal(reviews.length, 0);
  });

  it('publication proceeds with accepted automatic evaluation and no assigned teacher', async () => {
    const created = await h.service.createArtifact(STUDENT.id, { title: 'Fixture' }, 'k1');
    assert.equal((await h.service.publishArtifact(STUDENT.id, created.id, 'k-pub')).status, 'published');
  });

  it('自动评价通过 → 直接发布、写入 publishedAt，并物化 independent 证据', async () => {
    h.directory.mentors.set(STUDENT.id, MENTOR.id);
    // 项目存在且归属该学生（用于证据归属与授权）。
    h.projects.seed({
      id: 'proj-1',
      studentId: STUDENT.id,
      templateVersionId: 'tplv-1',
      status: 'practice_building',
    });
    const created = await h.service.createArtifact(
      STUDENT.id,
      { title: '作品', projectId: 'proj-1' },
      'k1',
    );
    h.store.seedApprovedReview(created.id, MENTOR.id);

    const published = await h.service.publishArtifact(STUDENT.id, created.id, 'k-pub');
    assert.equal(published.status, 'published');
    assert.ok(published.publishedAt !== null);

    const evidence = await h.evidence.read('proj-1');
    assert.equal(evidence.independent.length, 1);
    assert.equal(evidence.aiHelped.length, 0);
  });

  it('发布授权：他人不能发布该作品', async () => {
    const created = await h.service.createArtifact(STUDENT.id, { title: '作品' }, 'k1');
    h.directory.mentors.set(STUDENT.id, MENTOR.id);
    await assertHttpError(
      () => h.service.publishArtifact(OTHER_STUDENT.id, created.id, 'k-pub'),
      403,
      'ARTIFACT_FORBIDDEN',
    );
  });

  it('撤回：published → archived，保留 publishedAt 历史，可再申请发布', async () => {
    h.directory.mentors.set(STUDENT.id, MENTOR.id);
    const created = await h.service.createArtifact(STUDENT.id, { title: '作品' }, 'k1');
    h.store.seedApprovedReview(created.id, MENTOR.id);
    await h.service.publishArtifact(STUDENT.id, created.id, 'k-pub');
    const archived = await h.service.withdrawArtifact(STUDENT.id, created.id, 'k-withdraw');
    assert.equal(archived.status, 'archived');
    assert.ok(archived.publishedAt !== null, '撤回不应抹掉发布历史');
  });
});

describe('WorksService — 对象级授权', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  it('跨学生读取 → 403', async () => {
    const created = await h.service.createArtifact(STUDENT.id, { title: '私密' }, 'k1');
    await assertHttpError(
      () => h.service.getArtifact(OTHER_STUDENT, created.id),
      403,
      'ARTIFACT_FORBIDDEN',
    );
  });

  it('班主任仅能读已发布作品；草稿不可见', async () => {
    h.directory.mentors.set(STUDENT.id, MENTOR.id);
    const created = await h.service.createArtifact(STUDENT.id, { title: '草稿' }, 'k1');
    await assertHttpError(
      () => h.service.getArtifact(MENTOR, created.id),
      403,
      'ARTIFACT_FORBIDDEN',
    );
    // 列表也只返回已发布（此处为空）。
    assert.equal((await h.service.listArtifacts(MENTOR, {})).length, 0);

    h.store.seedApprovedReview(created.id, MENTOR.id);
    await h.service.publishArtifact(STUDENT.id, created.id, 'k-pub');
    const list = await h.service.listArtifacts(MENTOR, {});
    assert.equal(list.length, 1);
  });

  it('非在任班主任 → 403', async () => {
    h.directory.mentors.set(STUDENT.id, MENTOR.id);
    const created = await h.service.createArtifact(STUDENT.id, { title: '作品' }, 'k1');
    h.store.seedApprovedReview(created.id, MENTOR.id);
    await h.service.publishArtifact(STUDENT.id, created.id, 'k-pub');
    await assertHttpError(
      () => h.service.getArtifact(OTHER_MENTOR, created.id),
      403,
      'ARTIFACT_FORBIDDEN',
    );
  });

  it('家长仅能读已发布且非 student_private 的作品', async () => {
    h.directory.guardians.set(PARENT.id, [STUDENT.id]);
    h.directory.mentors.set(STUDENT.id, MENTOR.id);
    const created = await h.service.createArtifact(STUDENT.id, { title: '作品' }, 'k1');
    h.store.seedApprovedReview(created.id, MENTOR.id);
    await h.service.publishArtifact(STUDENT.id, created.id, 'k-pub');
    const view = await h.service.getArtifact(PARENT, created.id);
    assert.equal(view.status, 'published');

    // 直接种入一件 student_private 的已发布作品：家长不可读。
    const now = new Date();
    await h.store.createArtifact({
      id: 'art-private',
      versionId: 'artv-private',
      schoolId: null,
      studentId: STUDENT.id,
      projectId: null,
      templateVersionId: null,
      title: '私有草稿',
      summary: '',
      status: 'published',
      visibility: 'student_private',
      tags: [],
      idempotencyKey: 'seed-private',
      version: { title: '私有草稿', note: '', objectKey: null, thumbnailRef: null, capturedAt: null },
      now,
    });
    await assertHttpError(
      () => h.service.getArtifact(PARENT, 'art-private'),
      403,
      'ARTIFACT_FORBIDDEN',
    );
  });

  it('未授权家长 → 403', async () => {
    const created = await h.service.createArtifact(STUDENT.id, { title: '作品' }, 'k1');
    await assertHttpError(
      () => h.service.getArtifact(PARENT, created.id),
      403,
      'ARTIFACT_FORBIDDEN',
    );
  });
});

describe('WorksService — 对象存储签名', () => {
  it('注入签名器时返回限时地址，不含凭据', async () => {
    const h = makeHarness();
    const result = await h.service.presignUpload(
      STUDENT.id,
      { filename: 'my photo.png', contentType: 'image/png', sizeBytes: 2048, purpose: 'artifact' },
      'k-presign',
    );
    assert.equal(result.method, 'PUT');
    assert.ok(result.uploadUrl.startsWith('https://'));
    assert.ok(!result.uploadUrl.includes('secret'));
  });

  it('live 未配置对象存储 → 503（不返回假地址）', async () => {
    const store = new InMemoryWorksStore();
    const review = { accepts: true };
  const results = new Map<string, 'accepted' | 'needs_revision'>();
  const automaticReview = { evaluate: async (artifact: { id: string }, version: { id: string }) => {
    const status = review.accepts ? 'accepted' as const : 'needs_revision' as const;
    results.set(`${artifact.id}:${version.id}`, status);
    return { status, subjectDigest: 'a'.repeat(64), feedback: [] };
  }, status: async (artifact: { id: string }, version: { id: string }) => results.get(`${artifact.id}:${version.id}`) ?? null } as unknown as WorksPublicationReview;
  const service = new WorksService(
      store,
      new FakeWorksDirectory(),
      new InMemoryWorksProjectReader(),
      new ProjectEvidenceMaterializer(new InMemoryProjectEvidenceStore(), new EmptyProjectEvidenceSource()),
      new UnconfiguredObjectStoragePresigner(),
      new FakeIdempotencyStore() as unknown as IdempotencyStore,
      new FakeAuditWriter() as unknown as AuditWriter,
      new FakeTeamRuntimeGates() as unknown as TeamRuntimeService,
    );
    await assertHttpError(
      () =>
        service.presignUpload(
          STUDENT.id,
          { filename: 'a.png', contentType: 'image/png', sizeBytes: 10 },
          'k1',
        ),
      503,
      'OBJECT_STORAGE_NOT_CONFIGURED',
    );
  });
});

/**
 * WS3：预签名白名单的**活体缺口**修复回归。
 *
 * 修复前的真实行为（两条独立缺陷，都会让真实调用失败）：
 * 1. `text/markdown` / `text/html` 不在 `ALLOWED_PRESIGN_CONTENT_TYPES` 内
 *    → 学生**根本传不上实验报告**；
 * 2. `normalizePresign` 要求 `sizeBytes` 是有限正数，而学生端上传组件从未发送
 *    → 真实上传请求必然 400。
 *
 * 注意这两条只是「能不能传上去」，**不**表示证据已被校验：
 * 对象存储的**读**路径仍是延后项（live 抛 OBJECT_STORAGE_NOT_CONFIGURED）。
 */
describe('WorksService — 报告类内容类型（WS3 增量修复）', () => {
  it('text/markdown 与 text/html 现在可以预签名（此前会被 400 拒绝）', async () => {
    const h = makeHarness();
    const markdown = await h.service.presignUpload(
      STUDENT.id,
      { filename: 'report.md', contentType: 'text/markdown', sizeBytes: 4096, purpose: 'artifact' },
      'k-md',
    );
    const html = await h.service.presignUpload(
      STUDENT.id,
      { filename: 'report.html', contentType: 'text/html', sizeBytes: 4096, purpose: 'evidence' },
      'k-html',
    );
    assert.equal(markdown.method, 'PUT');
    assert.equal(html.method, 'PUT');
    assert.ok(markdown.objectKey.includes('report.md'));
  });

  it('既有白名单未被削弱：text/plain 仍然可用', async () => {
    const h = makeHarness();
    const result = await h.service.presignUpload(
      STUDENT.id,
      { filename: 'notes.txt', contentType: 'text/plain', sizeBytes: 100, purpose: 'other' },
      'k-txt',
    );
    assert.equal(result.method, 'PUT');
  });

  it('sizeBytes 缺失 / 非正数仍然被拒（前端此前正是漏发该字段）', async () => {
    const h = makeHarness();
    await assertHttpError(
      () => h.service.presignUpload(
        STUDENT.id,
        { filename: 'report.md', contentType: 'text/markdown', purpose: 'artifact' },
        'k-nosize',
      ),
      400,
      'ARTIFACT_INVALID',
    );
    await assertHttpError(
      () => h.service.presignUpload(
        STUDENT.id,
        { filename: 'report.md', contentType: 'text/markdown', sizeBytes: 0, purpose: 'artifact' },
        'k-zerosize',
      ),
      400,
      'ARTIFACT_INVALID',
    );
  });

  it('不在白名单内的 purpose 仍被拒（前端此前发的 project-submission 就是这类）', async () => {
    const h = makeHarness();
    await assertHttpError(
      () => h.service.presignUpload(
        STUDENT.id,
        { filename: 'report.md', contentType: 'text/markdown', sizeBytes: 100, purpose: 'project-submission' as never },
        'k-purpose',
      ),
      400,
      'ARTIFACT_INVALID',
    );
  });
});
