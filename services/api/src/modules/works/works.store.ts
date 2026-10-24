import type { ArtifactStatus } from './artifact-state-machine';

/**
 * 作品 / 版本 / 班主任复核的持久化边界。
 *
 * 服务层只依赖本抽象；`demo` / `test` 走内存实现，`live` 走
 * `PostgresWorksStore`（见 `works.store.postgres.ts`）。所有写操作由实现保证
 * 原子性与版本不可变（`(artifact_id, ordinal)` 唯一 + 追加而非原地改写）。
 *
 * 重要边界：本存储**不写** `projects` 表。作品模块只读取项目阶段，绝不修改
 * `ProjectStatus` / `progressPercent` / `currentStageIndex`，模板冻结引用只读不写。
 */

export type ArtifactVisibility =
  | 'student_private'
  | 'mentor_visible'
  | 'class'
  | 'school'
  | 'public';

/** 未成年人数据最小化：学生新建作品默认 `class`（产品硬规则 5.4.7）。 */
export const DEFAULT_ARTIFACT_VISIBILITY: ArtifactVisibility = 'class';

export type MentorReviewStatus =
  | 'requested'
  | 'in_review'
  | 'approved'
  | 'changes_requested'
  | 'rejected';

export interface ArtifactVersionRecord {
  id: string;
  artifactId: string;
  /** 从 1 开始，单调递增；`(artifactId, ordinal)` 唯一且不可变。 */
  ordinal: number;
  title: string;
  note: string;
  /** 对象存储不透明引用，不含任何凭据。 */
  objectKey: string | null;
  thumbnailRef: string | null;
  capturedAt: Date | null;
  createdAt: Date;
}

export interface ArtifactRecord {
  id: string;
  schoolId: string | null;
  studentId: string;
  projectId: string | null;
  templateVersionId: string | null;
  title: string;
  summary: string;
  status: ArtifactStatus;
  visibility: ArtifactVisibility;
  currentVersionIndex: number;
  tags: string[];
  idempotencyKey: string;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MentorReviewRecord {
  id: string;
  schoolId: string | null;
  studentId: string;
  mentorUserId: string;
  projectId: string | null;
  artifactId: string;
  kind: 'artifact';
  status: MentorReviewStatus;
  decision: string | null;
  comment: string | null;
  idempotencyKey: string;
  requestedAt: Date;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateArtifactInput {
  id: string;
  versionId: string;
  schoolId: string | null;
  studentId: string;
  projectId: string | null;
  templateVersionId: string | null;
  title: string;
  summary: string;
  status?: ArtifactStatus;
  visibility?: ArtifactVisibility;
  tags: string[];
  idempotencyKey: string;
  version: {
    title: string;
    note: string;
    objectKey: string | null;
    thumbnailRef: string | null;
    capturedAt: Date | null;
  };
  now: Date;
}

export interface AppendArtifactVersionInput {
  artifactId: string;
  /** CAS：期望的当前版本号；不匹配抛 `WorksStoreConflictError`。 */
  expectedRevision: number;
  title: string;
  note: string;
  objectKey: string | null;
  thumbnailRef: string | null;
  capturedAt: Date | null;
  now: Date;
}

export interface TransitionArtifactInput {
  expectedVersionIndex?: number;
  artifactId: string;
  /** CAS：只有当前状态在集合内才迁移。 */
  expectedStatuses: readonly ArtifactStatus[];
  status: ArtifactStatus;
  /** `undefined` = 不改动 `published_at`。 */
  publishedAt?: Date | null;
  now: Date;
}

export interface ArtifactListFilter {
  /** 只允许查询这些学生（服务于对象级授权，调用方先解析关系）。 */
  studentIds: readonly string[];
  statuses?: readonly ArtifactStatus[];
  projectId?: string | null;
}

export interface CreateMentorReviewInput {
  id: string;
  schoolId: string | null;
  studentId: string;
  mentorUserId: string;
  projectId: string | null;
  artifactId: string;
  status: MentorReviewStatus;
  idempotencyKey: string;
  now: Date;
}

/** CAS 失败 / 唯一约束冲突时抛出，由服务层翻译成 409。 */
export class WorksStoreConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorksStoreConflictError';
  }
}

export abstract class WorksStore {
  abstract createArtifact(input: CreateArtifactInput): Promise<ArtifactRecord>;
  abstract findArtifact(id: string): Promise<ArtifactRecord | null>;
  abstract listArtifacts(filter: ArtifactListFilter): Promise<ArtifactRecord[]>;
  abstract listVersions(artifactId: string): Promise<ArtifactVersionRecord[]>;
  abstract appendVersion(
    input: AppendArtifactVersionInput,
  ): Promise<{ artifact: ArtifactRecord; version: ArtifactVersionRecord }>;
  abstract transitionArtifact(input: TransitionArtifactInput): Promise<ArtifactRecord>;

  abstract createMentorReview(input: CreateMentorReviewInput): Promise<MentorReviewRecord>;
  abstract findActiveReviewForArtifact(
    artifactId: string,
  ): Promise<MentorReviewRecord | null>;
  abstract findApprovedReviewForArtifact(
    artifactId: string,
  ): Promise<MentorReviewRecord | null>;
  abstract listReviewsForArtifact(artifactId: string): Promise<MentorReviewRecord[]>;

  /**
   * P2 生产者只读端口：按版本 id 取版本行（含所属作品）。
   *
   * 只读、不引入任何写能力。生产者据此确认「证据引用指向一条**真实**版本行」，
   * 这是「门禁证据必须可查证」的前提（客户端无法自证）。
   */
  abstract findVersionById(
    versionId: string,
  ): Promise<{ artifact: ArtifactRecord; version: ArtifactVersionRecord } | null>;

  /**
   * P2 生产者只读端口：按对象 key 反查版本行。
   *
   * 视频/文档上传只交回一个不透明 `objectKey`，因此必须能反向查证它属于
   * **哪一件作品的哪一个版本、哪个学生**——否则「拿别人的作品当证据」无法拦截。
   */
  abstract findVersionByObjectKey(
    objectKey: string,
  ): Promise<{ artifact: ArtifactRecord; version: ArtifactVersionRecord } | null>;
}

function cloneArtifact(record: ArtifactRecord): ArtifactRecord {
  return { ...record, tags: [...record.tags] };
}

function cloneVersion(record: ArtifactVersionRecord): ArtifactVersionRecord {
  return { ...record };
}

function cloneReview(record: MentorReviewRecord): MentorReviewRecord {
  return { ...record };
}

/**
 * 内存实现：仅用于 `demo` / `test`。live 模式由模块工厂保证不会落到这里。
 *
 * 与 `InMemoryExplorationStore` 同思路：它**不是** live 持久化，只提供与
 * Postgres 实现一致的可观察语义，供业务规则单测。
 */
export class InMemoryWorksStore extends WorksStore {
  private readonly artifacts = new Map<string, ArtifactRecord>();
  private readonly versions = new Map<string, ArtifactVersionRecord[]>();
  private readonly reviews = new Map<string, MentorReviewRecord>();

  async createArtifact(input: CreateArtifactInput): Promise<ArtifactRecord> {
    const status = input.status ?? 'draft';
    const record: ArtifactRecord = {
      id: input.id,
      schoolId: input.schoolId,
      studentId: input.studentId,
      projectId: input.projectId,
      templateVersionId: input.templateVersionId,
      title: input.title,
      summary: input.summary,
      status,
      visibility: input.visibility ?? DEFAULT_ARTIFACT_VISIBILITY,
      currentVersionIndex: 1,
      tags: [...input.tags],
      idempotencyKey: input.idempotencyKey,
      publishedAt: null,
      createdAt: input.now,
      updatedAt: input.now,
    };
    this.artifacts.set(record.id, record);
    this.versions.set(record.id, [
      {
        id: input.versionId,
        artifactId: record.id,
        ordinal: 1,
        title: input.version.title,
        note: input.version.note,
        objectKey: input.version.objectKey,
        thumbnailRef: input.version.thumbnailRef,
        capturedAt: input.version.capturedAt,
        createdAt: input.now,
      },
    ]);
    return cloneArtifact(record);
  }

  async findArtifact(id: string): Promise<ArtifactRecord | null> {
    const record = this.artifacts.get(id);
    return record === undefined ? null : cloneArtifact(record);
  }

  async listArtifacts(filter: ArtifactListFilter): Promise<ArtifactRecord[]> {
    const allowed = new Set(filter.studentIds);
    const statuses = filter.statuses === undefined ? null : new Set(filter.statuses);
    const out: ArtifactRecord[] = [];
    for (const record of this.artifacts.values()) {
      if (!allowed.has(record.studentId)) continue;
      if (statuses !== null && !statuses.has(record.status)) continue;
      if (filter.projectId !== undefined && filter.projectId !== null && record.projectId !== filter.projectId) {
        continue;
      }
      out.push(cloneArtifact(record));
    }
    return out.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async listVersions(artifactId: string): Promise<ArtifactVersionRecord[]> {
    const rows = this.versions.get(artifactId) ?? [];
    return rows.map(cloneVersion).sort((a, b) => a.ordinal - b.ordinal);
  }

  async appendVersion(
    input: AppendArtifactVersionInput,
  ): Promise<{ artifact: ArtifactRecord; version: ArtifactVersionRecord }> {
    const record = this.artifacts.get(input.artifactId);
    if (record === undefined) throw new WorksStoreConflictError('artifact not found');
    if (record.currentVersionIndex !== input.expectedRevision) {
      throw new WorksStoreConflictError(
        `artifact revision mismatch: expected ${input.expectedRevision}, actual ${record.currentVersionIndex}`,
      );
    }
    const nextOrdinal = input.expectedRevision + 1;
    const version: ArtifactVersionRecord = {
      id: `${input.artifactId}-v${nextOrdinal}-${input.now.getTime()}`,
      artifactId: input.artifactId,
      ordinal: nextOrdinal,
      title: input.title,
      note: input.note,
      objectKey: input.objectKey,
      thumbnailRef: input.thumbnailRef,
      capturedAt: input.capturedAt,
      createdAt: input.now,
    };
    const rows = this.versions.get(input.artifactId) ?? [];
    if (rows.some((row) => row.ordinal === nextOrdinal)) {
      throw new WorksStoreConflictError('artifact version ordinal already exists');
    }
    rows.push(version);
    this.versions.set(input.artifactId, rows);
    record.currentVersionIndex = nextOrdinal;
    record.title = input.title;
    record.updatedAt = input.now;
    this.artifacts.set(record.id, record);
    return { artifact: cloneArtifact(record), version: cloneVersion(version) };
  }

  async transitionArtifact(input: TransitionArtifactInput): Promise<ArtifactRecord> {
    const record = this.artifacts.get(input.artifactId);
    if (record === undefined) throw new WorksStoreConflictError('artifact not found');
    if (input.expectedVersionIndex !== undefined && record.currentVersionIndex !== input.expectedVersionIndex) {
      throw new WorksStoreConflictError('artifact version changed during evaluation');
    }

    if (!input.expectedStatuses.includes(record.status)) {
      throw new WorksStoreConflictError(
        `artifact status mismatch: expected ${input.expectedStatuses.join('|')}, actual ${record.status}`,
      );
    }
    record.status = input.status;
    if (input.publishedAt !== undefined) record.publishedAt = input.publishedAt;
    record.updatedAt = input.now;
    this.artifacts.set(record.id, record);
    return cloneArtifact(record);
  }

  async createMentorReview(input: CreateMentorReviewInput): Promise<MentorReviewRecord> {
    for (const review of this.reviews.values()) {
      if (review.idempotencyKey === input.idempotencyKey) return cloneReview(review);
    }
    const record: MentorReviewRecord = {
      id: input.id,
      schoolId: input.schoolId,
      studentId: input.studentId,
      mentorUserId: input.mentorUserId,
      projectId: input.projectId,
      artifactId: input.artifactId,
      kind: 'artifact',
      status: input.status,
      decision: null,
      comment: null,
      idempotencyKey: input.idempotencyKey,
      requestedAt: input.now,
      reviewedAt: null,
      createdAt: input.now,
      updatedAt: input.now,
    };
    this.reviews.set(record.id, record);
    return cloneReview(record);
  }

  async findActiveReviewForArtifact(artifactId: string): Promise<MentorReviewRecord | null> {
    const rows = [...this.reviews.values()].filter(
      (review) =>
        review.artifactId === artifactId &&
        (review.status === 'requested' || review.status === 'in_review'),
    );
    return rows.length === 0 ? null : cloneReview(rows[rows.length - 1]!);
  }

  async findApprovedReviewForArtifact(artifactId: string): Promise<MentorReviewRecord | null> {
    const rows = [...this.reviews.values()].filter(
      (review) => review.artifactId === artifactId && review.status === 'approved',
    );
    return rows.length === 0 ? null : cloneReview(rows[rows.length - 1]!);
  }

  async listReviewsForArtifact(artifactId: string): Promise<MentorReviewRecord[]> {
    return [...this.reviews.values()]
      .filter((review) => review.artifactId === artifactId)
      .map(cloneReview)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async findReviewById(id: string): Promise<MentorReviewRecord | null> {
    const row = this.reviews.get(id);
    return row ? cloneReview(row) : null;
  }

  async listReviewsForStudent(studentId: string, mentorId: string, offset: number, limit: number): Promise<MentorReviewRecord[]> {
    return [...this.reviews.values()].filter((row) => row.studentId === studentId && row.mentorUserId === mentorId)
      .sort((left, right) => right.requestedAt.getTime() - left.requestedAt.getTime() || right.id.localeCompare(left.id))
      .slice(offset, offset + limit).map(cloneReview);
  }

  async applyReviewDecision(input: { reviewId: string; expectedStatus: string; status: MentorReviewRecord['status'];
    decision: string; comment: string | null; reviewedAt: Date }, audit: () => Promise<unknown>): Promise<'applied' | 'stale'> {
    const current = this.reviews.get(input.reviewId);
    if (!current || current.status !== input.expectedStatus) return 'stale';
    const next = { ...current, status: input.status, decision: input.decision, comment: input.comment,
      reviewedAt: input.reviewedAt, updatedAt: input.reviewedAt };
    this.reviews.set(current.id, next);
    try { await audit(); } catch (error) {
      if (this.reviews.get(current.id) === next) this.reviews.set(current.id, current);
      throw error;
    }
    return 'applied';
  }

  async findVersionById(
    versionId: string,
  ): Promise<{ artifact: ArtifactRecord; version: ArtifactVersionRecord } | null> {
    for (const [artifactId, rows] of this.versions.entries()) {
      const version = rows.find((row) => row.id === versionId);
      if (version === undefined) continue;
      const artifact = this.artifacts.get(artifactId);
      if (artifact === undefined) continue;
      return { artifact: cloneArtifact(artifact), version: cloneVersion(version) };
    }
    return null;
  }

  async findVersionByObjectKey(
    objectKey: string,
  ): Promise<{ artifact: ArtifactRecord; version: ArtifactVersionRecord } | null> {
    const wanted = objectKey.trim();
    if (wanted.length === 0) return null;
    for (const [artifactId, rows] of this.versions.entries()) {
      // 同一 key 可能出现在多个版本（重传）：取**最新**一个（ordinal 最大）。
      const matches = rows.filter((row) => row.objectKey === wanted);
      if (matches.length === 0) continue;
      const version = matches.reduce((best, row) => (row.ordinal > best.ordinal ? row : best));
      const artifact = this.artifacts.get(artifactId);
      if (artifact === undefined) continue;
      return { artifact: cloneArtifact(artifact), version: cloneVersion(version) };
    }
    return null;
  }

  /** 测试辅助：清空内存状态。 */
  reset(): void {
    this.artifacts.clear();
    this.versions.clear();
    this.reviews.clear();
  }

  /** 测试辅助：直接种入一条班主任批准，模拟 mentor-review 模块的写入。 */
  seedApprovedReview(artifactId: string, mentorUserId: string, now: Date = new Date()): void {
    const record: MentorReviewRecord = {
      id: `review-${artifactId}-approved`,
      schoolId: null,
      studentId: this.artifacts.get(artifactId)?.studentId ?? 'unknown',
      mentorUserId,
      projectId: this.artifacts.get(artifactId)?.projectId ?? null,
      artifactId,
      kind: 'artifact',
      status: 'approved',
      decision: 'approved',
      comment: null,
      idempotencyKey: `seed-approved:${artifactId}`,
      requestedAt: now,
      reviewedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    this.reviews.set(record.id, record);
  }
}
