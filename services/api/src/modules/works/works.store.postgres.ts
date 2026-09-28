import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  artifacts as artifactsTable,
  artifactVersions as artifactVersionsTable,
  mentorReviews as mentorReviewsTable,
  withTransaction,
  type Database,
} from '@qitu/database';
import type { ArtifactStatus } from './artifact-state-machine';
import {
  WorksStore,
  WorksStoreConflictError,
  type AppendArtifactVersionInput,
  type ArtifactListFilter,
  type ArtifactRecord,
  type ArtifactVersionRecord,
  type CreateArtifactInput,
  type CreateMentorReviewInput,
  type MentorReviewRecord,
  type MentorReviewStatus,
  type TransitionArtifactInput,
} from './works.store';

const PG_UNIQUE_VIOLATION = '23505';

type ArtifactRow = typeof artifactsTable.$inferSelect;
type ArtifactVersionRow = typeof artifactVersionsTable.$inferSelect;
type MentorReviewRow = typeof mentorReviewsTable.$inferSelect;

/**
 * live 持久化实现，落在迁移 0009 的 `artifacts` / `artifact_versions` /
 * `mentor_reviews` 三张表。
 *
 * 关键保障：
 * - `createArtifact` 在事务里同时写作品与第 1 个版本，避免出现「有作品无版本」；
 * - `appendVersion` 用 `current_version_index` 做 CAS，版本只追加、`ordinal` 不重复；
 * - `transitionArtifact` 用当前状态做 CAS，防止并发重复发布；
 * - `createMentorReview` 依赖 `mentor_reviews.idempotency_key` 唯一索引兜底。
 */
export class PostgresWorksStore extends WorksStore {
  constructor(private readonly db: Database) {
    super();
  }

  async createArtifact(input: CreateArtifactInput): Promise<ArtifactRecord> {
    try {
      return await withTransaction(this.db, async (tx) => {
        const inserted = await tx
          .insert(artifactsTable)
          .values({
            id: input.id,
            schoolId: input.schoolId,
            studentUserId: input.studentId,
            projectId: input.projectId,
            templateVersionId: input.templateVersionId,
            title: input.title,
            summary: input.summary,
            status: input.status ?? 'draft',
            visibility: input.visibility ?? 'class',
            currentVersionIndex: 1,
            tags: [...input.tags],
            idempotencyKey: input.idempotencyKey,
            publishedAt: null,
            createdAt: input.now,
            updatedAt: input.now,
          })
          .returning();
        const artifact = inserted[0];
        if (artifact === undefined) throw new Error('插入作品未返回数据行');

        await tx.insert(artifactVersionsTable).values({
          id: input.versionId,
          artifactId: input.id,
          ordinal: 1,
          title: input.version.title,
          note: input.version.note,
          objectKey: input.version.objectKey,
          thumbnailRef: input.version.thumbnailRef,
          capturedAt: input.version.capturedAt,
          createdAt: input.now,
        });
        return mapArtifact(artifact);
      });
    } catch (error) {
      throw asConflict(error);
    }
  }

  async findArtifact(id: string): Promise<ArtifactRecord | null> {
    const [row] = await this.db
      .select()
      .from(artifactsTable)
      .where(eq(artifactsTable.id, id))
      .limit(1);
    return row === undefined ? null : mapArtifact(row);
  }

  async listArtifacts(filter: ArtifactListFilter): Promise<ArtifactRecord[]> {
    if (filter.studentIds.length === 0) return [];
    const conditions = [inArray(artifactsTable.studentUserId, [...filter.studentIds])];
    if (filter.statuses !== undefined && filter.statuses.length > 0) {
      conditions.push(inArray(artifactsTable.status, [...filter.statuses]));
    }
    if (filter.projectId !== undefined && filter.projectId !== null) {
      conditions.push(eq(artifactsTable.projectId, filter.projectId));
    }
    const rows = await this.db
      .select()
      .from(artifactsTable)
      .where(and(...conditions))
      .orderBy(desc(artifactsTable.createdAt));
    return rows.map(mapArtifact);
  }

  async listVersions(artifactId: string): Promise<ArtifactVersionRecord[]> {
    const rows = await this.db
      .select()
      .from(artifactVersionsTable)
      .where(eq(artifactVersionsTable.artifactId, artifactId))
      .orderBy(artifactVersionsTable.ordinal);
    return rows.map(mapVersion);
  }

  async appendVersion(
    input: AppendArtifactVersionInput,
  ): Promise<{ artifact: ArtifactRecord; version: ArtifactVersionRecord }> {
    try {
      return await withTransaction(this.db, async (tx) => {
        const nextOrdinal = input.expectedRevision + 1;
        const updated = await tx
          .update(artifactsTable)
          .set({
            title: input.title,
            currentVersionIndex: nextOrdinal,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(artifactsTable.id, input.artifactId),
              eq(artifactsTable.currentVersionIndex, input.expectedRevision),
            ),
          )
          .returning();
        const artifact = updated[0];
        if (artifact === undefined) {
          throw new WorksStoreConflictError(
            '作品版本已被其他会话更新，请重新读取后再试',
          );
        }
        const inserted = await tx
          .insert(artifactVersionsTable)
          .values({
            id: `${input.artifactId}-v${nextOrdinal}-${input.now.getTime()}`,
            artifactId: input.artifactId,
            ordinal: nextOrdinal,
            title: input.title,
            note: input.note,
            objectKey: input.objectKey,
            thumbnailRef: input.thumbnailRef,
            capturedAt: input.capturedAt,
            createdAt: input.now,
          })
          .returning();
        const version = inserted[0];
        if (version === undefined) throw new Error('插入作品版本未返回数据行');
        return { artifact: mapArtifact(artifact), version: mapVersion(version) };
      });
    } catch (error) {
      throw asConflict(error);
    }
  }

  async transitionArtifact(input: TransitionArtifactInput): Promise<ArtifactRecord> {
    try {
      return await withTransaction(this.db, async (tx) => {
        const set: {
          status: string;
          updatedAt: Date;
          publishedAt?: Date | null;
        } = { status: input.status, updatedAt: input.now };
        if (input.publishedAt !== undefined) set.publishedAt = input.publishedAt;
        const updated = await tx
          .update(artifactsTable)
          .set(set)
          .where(
            and(
              eq(artifactsTable.id, input.artifactId),
              inArray(artifactsTable.status, [...input.expectedStatuses]),
            ),
          )
          .returning();
        const artifact = updated[0];
        if (artifact === undefined) {
          throw new WorksStoreConflictError('作品状态已变化，请重新读取后再试');
        }
        return mapArtifact(artifact);
      });
    } catch (error) {
      throw asConflict(error);
    }
  }

  async createMentorReview(input: CreateMentorReviewInput): Promise<MentorReviewRecord> {
    try {
      const inserted = await this.db
        .insert(mentorReviewsTable)
        .values({
          id: input.id,
          schoolId: input.schoolId,
          studentUserId: input.studentId,
          mentorUserId: input.mentorUserId,
          projectId: input.projectId,
          artifactRef: input.artifactId,
          kind: 'artifact',
          status: input.status,
          idempotencyKey: input.idempotencyKey,
          requestedAt: input.now,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .onConflictDoNothing({ target: [mentorReviewsTable.idempotencyKey] })
        .returning();
      const row = inserted[0];
      if (row !== undefined) return mapReview(row);
      // 幂等冲突：读回已存在的那一条。
      const [existing] = await this.db
        .select()
        .from(mentorReviewsTable)
        .where(eq(mentorReviewsTable.idempotencyKey, input.idempotencyKey))
        .limit(1);
      if (existing === undefined) {
        throw new WorksStoreConflictError('复核记录写入冲突且无法读回');
      }
      return mapReview(existing);
    } catch (error) {
      throw asConflict(error);
    }
  }

  async findActiveReviewForArtifact(artifactId: string): Promise<MentorReviewRecord | null> {
    const rows = await this.db
      .select()
      .from(mentorReviewsTable)
      .where(
        and(
          eq(mentorReviewsTable.artifactRef, artifactId),
          inArray(mentorReviewsTable.status, ['requested', 'in_review']),
        ),
      )
      .orderBy(desc(mentorReviewsTable.createdAt))
      .limit(1);
    return rows[0] === undefined ? null : mapReview(rows[0]);
  }

  async findApprovedReviewForArtifact(artifactId: string): Promise<MentorReviewRecord | null> {
    const rows = await this.db
      .select()
      .from(mentorReviewsTable)
      .where(
        and(
          eq(mentorReviewsTable.artifactRef, artifactId),
          eq(mentorReviewsTable.status, 'approved'),
        ),
      )
      .orderBy(desc(mentorReviewsTable.createdAt))
      .limit(1);
    return rows[0] === undefined ? null : mapReview(rows[0]);
  }

  async listReviewsForArtifact(artifactId: string): Promise<MentorReviewRecord[]> {
    const rows = await this.db
      .select()
      .from(mentorReviewsTable)
      .where(eq(mentorReviewsTable.artifactRef, artifactId))
      .orderBy(mentorReviewsTable.createdAt);
    return rows.map(mapReview);
  }
}

function mapArtifact(row: ArtifactRow): ArtifactRecord {
  return {
    id: row.id,
    schoolId: row.schoolId,
    studentId: row.studentUserId,
    projectId: row.projectId,
    templateVersionId: row.templateVersionId,
    title: row.title,
    summary: row.summary,
    status: row.status as ArtifactStatus,
    visibility: row.visibility as ArtifactRecord['visibility'],
    currentVersionIndex: row.currentVersionIndex,
    tags: row.tags ?? [],
    idempotencyKey: row.idempotencyKey,
    publishedAt: row.publishedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapVersion(row: ArtifactVersionRow): ArtifactVersionRecord {
  return {
    id: row.id,
    artifactId: row.artifactId,
    ordinal: row.ordinal,
    title: row.title,
    note: row.note,
    objectKey: row.objectKey,
    thumbnailRef: row.thumbnailRef,
    capturedAt: row.capturedAt,
    createdAt: row.createdAt,
  };
}

function mapReview(row: MentorReviewRow): MentorReviewRecord {
  return {
    id: row.id,
    schoolId: row.schoolId,
    studentId: row.studentUserId,
    mentorUserId: row.mentorUserId,
    projectId: row.projectId,
    artifactId: row.artifactRef ?? '',
    kind: 'artifact',
    status: row.status as MentorReviewStatus,
    decision: row.decision,
    comment: row.comment,
    idempotencyKey: row.idempotencyKey,
    requestedAt: row.requestedAt,
    reviewedAt: row.reviewedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function asConflict(error: unknown): never {
  if (error instanceof WorksStoreConflictError) throw error;
  if (isUniqueViolation(error)) {
    throw new WorksStoreConflictError('作品唯一约束冲突');
  }
  throw error;
}

function isUniqueViolation(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  return (error as { code?: unknown }).code === PG_UNIQUE_VIOLATION;
}
