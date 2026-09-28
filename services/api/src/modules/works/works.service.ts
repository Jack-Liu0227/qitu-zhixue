import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { CurrentUser } from '@qitu/contracts';
import { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { hashIdempotentInput } from '../../common/idempotency/idempotency.hash';
import { throwHttpForIdempotencyError } from '../../common/idempotency/idempotency.errors';
import { AuditWriter } from '../../common/audit/audit.service';
import {
  isArtifactEditable,
  publishFromReview,
  submitForReview,
  withdrawArtifact,
  type ArtifactStatus,
} from './artifact-state-machine';
import {
  canReadArtifact,
  canWriteArtifact,
  WorksDirectory,
  type ArtifactRef,
  type ArtifactRelationship,
} from './works.access';
import {
  DEFAULT_ARTIFACT_VISIBILITY,
  WorksStore,
  WorksStoreConflictError,
  type ArtifactRecord,
  type ArtifactVersionRecord,
  type ArtifactVisibility,
  type MentorReviewRecord,
} from './works.store';
import { WorksProjectReader } from './works.project-reader';
import { ProjectEvidenceMaterializer } from './project-evidence.service';
import type { ProjectEvidenceView } from './project-evidence.store';
import {
  ObjectStoragePresigner,
  type PresignPurpose,
  type PresignUploadResult,
} from './object-storage.presigner';

/** 文本上限，与前端表单一致；服务端再次兜底。 */
export const MAX_ARTIFACT_TITLE_LENGTH = 120;
export const MAX_ARTIFACT_SUMMARY_LENGTH = 1000;
export const MAX_ARTIFACT_TAGS = 10;
export const MAX_ARTIFACT_TAG_LENGTH = 24;
export const MAX_ARTIFACT_VERSION_NOTE_LENGTH = 500;
export const MAX_PRESIGN_FILENAME_LENGTH = 255;
export const MAX_PRESIGN_SIZE_BYTES = 512 * 1024 * 1024; // 512MB

const ALLOWED_PRESIGN_CONTENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/webm',
  'application/pdf',
  'application/zip',
  'text/plain',
] as const;

const PRESIGN_PURPOSES: readonly PresignPurpose[] = ['artifact', 'evidence', 'thumbnail', 'other'];

export interface ArtifactVersionInput {
  note?: string;
  objectKey?: string | null;
  thumbnailRef?: string | null;
  capturedAt?: string | null;
}

export interface CreateArtifactRequest {
  projectId?: string | null;
  title?: string;
  summary?: string;
  tags?: string[];
  version?: ArtifactVersionInput;
}

export interface UpdateArtifactRequest {
  title?: string;
  summary?: string;
  tags?: string[];
  version?: ArtifactVersionInput;
}

export interface ArtifactVersionView {
  id: string;
  ordinal: number;
  title: string;
  note: string;
  objectKey: string | null;
  thumbnailRef: string | null;
  capturedAt: string | null;
  createdAt: string;
}

export interface ArtifactView {
  id: string;
  projectId: string | null;
  studentId: string;
  title: string;
  summary: string;
  tags: string[];
  status: ArtifactStatus;
  visibility: ArtifactVisibility;
  currentVersionIndex: number;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  versionCount: number;
  latestVersion: ArtifactVersionView | null;
  reviewStatus: MentorReviewRecord['status'] | 'none';
}

export interface ArtifactListQuery {
  projectId?: string | null;
  status?: ArtifactStatus | null;
}

export interface PresignUploadRequest {
  filename?: string;
  contentType?: string;
  sizeBytes?: number;
  purpose?: PresignPurpose;
}

/**
 * 作品（Works）服务 —— 学生作品、版本历程与项目证据读取。
 *
 * 边界与硬规则：
 * - **版本不可变**：编辑只追加 `artifact_versions`，`(artifact_id, ordinal)` 唯一；
 * - **发布由服务端推进**：`draft → submitted → published`，客户端不能写 `status` /
 *   `publishedAt`；
 * - **发布授权**：学生本人 + 班主任复核通过（`mentor_reviews.status='approved'`）；
 *   无复核记录时进入待审核并创建复核记录，绝不直接发布；
 * - **项目阶段权威**：只读 `projects`，不写 `ProjectStatus` / 进度字段；
 * - **证据只读**：项目证据通过服务端 `ProjectEvidenceMaterializer` 物化，客户端
 *   没有任何写路径；
 * - **幂等 + 审计**：每个写操作都带 `Idempotency-Key` 并写审计。
 */
@Injectable()
export class WorksService {
  private readonly logger = new Logger(WorksService.name);

  constructor(
    private readonly store: WorksStore,
    private readonly directory: WorksDirectory,
    private readonly projects: WorksProjectReader,
    private readonly evidence: ProjectEvidenceMaterializer,
    private readonly presigner: ObjectStoragePresigner,
    private readonly idempotency: IdempotencyStore,
    private readonly audit: AuditWriter,
  ) {}

  /* ============================== 读 ============================== */

  async getArtifact(actor: CurrentUser, artifactId: string): Promise<ArtifactView> {
    const artifact = await this.requireArtifact(artifactId);
    const relationship = await this.resolveRelationship(actor, artifact);
    if (!canReadArtifact(actor, toRef(artifact), relationship)) {
      throw this.forbidden();
    }
    return this.toView(artifact);
  }

  async listArtifacts(actor: CurrentUser, query: ArtifactListQuery): Promise<ArtifactView[]> {
    const scope = await this.resolveListScope(actor, query);
    const records = await this.store.listArtifacts(scope);
    return Promise.all(records.map((record) => this.toView(record)));
  }

  async listVersions(actor: CurrentUser, artifactId: string): Promise<ArtifactVersionView[]> {
    const artifact = await this.requireArtifact(artifactId);
    const relationship = await this.resolveRelationship(actor, artifact);
    if (!canReadArtifact(actor, toRef(artifact), relationship)) {
      throw this.forbidden();
    }
    const versions = await this.store.listVersions(artifactId);
    return versions.map(toVersionView);
  }

  /**
   * 项目证据读投影（三列，脱敏）。
   *
   * 只读接口：学生本人 / 在任班主任 / 已授权家长。证据**没有任何写路径**，
   * 客户端 POST 证据会 404（路由不存在）。
   */
  async getProjectEvidence(actor: CurrentUser, projectId: string): Promise<ProjectEvidenceView> {
    const project = await this.projects.findProject(projectId);
    if (project === null) {
      throw new NotFoundException({ code: 'PROJECT_NOT_FOUND', message: '项目不存在' });
    }
    let allowed = false;
    if (actor.role === 'student') {
      allowed = actor.id === project.studentId;
    } else if (actor.role === 'teacher') {
      allowed = await this.directory.isMentorOf(actor.id, project.studentId);
    } else if (actor.role === 'parent') {
      allowed = await this.directory.isGuardianOf(actor.id, project.studentId);
    }
    if (!allowed) throw this.forbidden();
    return this.evidence.read(projectId);
  }

  /* ============================== 写 ============================== */

  async createArtifact(
    studentId: string,
    input: CreateArtifactRequest,
    idempotencyKey: string,
  ): Promise<ArtifactView> {
    const normalized = normalizeCreate(input);
    const scope = `student.artifact.create:${studentId}`;
    const requestHash = hashIdempotentInput(scope, {}, normalized);

    try {
      const result = await this.idempotency.execute(scope, idempotencyKey, requestHash, async () => {
        const now = new Date();
        let templateVersionId: string | null = null;
        if (normalized.projectId !== null) {
          const project = await this.projects.findProject(normalized.projectId);
          if (project === null || project.studentId !== studentId) {
            throw new ForbiddenException({
              code: 'ARTIFACT_PROJECT_FORBIDDEN',
              message: '无权在该项目下创建作品',
            });
          }
          // 冻结引用：只读项目模板版本，绝不改动项目。
          templateVersionId = project.templateVersionId;
        }

        const artifact = await this.store.createArtifact({
          id: `art-${randomUUID()}`,
          versionId: `artv-${randomUUID()}`,
          schoolId: null,
          studentId,
          projectId: normalized.projectId,
          templateVersionId,
          title: normalized.title,
          summary: normalized.summary,
          status: 'draft',
          // 未成年人最小可见：默认 class，客户端不能设置 visibility。
          visibility: DEFAULT_ARTIFACT_VISIBILITY,
          tags: normalized.tags,
          idempotencyKey: `${scope}:${idempotencyKey}`,
          version: {
            title: normalized.title,
            note: normalized.version.note,
            objectKey: normalized.version.objectKey,
            thumbnailRef: normalized.version.thumbnailRef,
            capturedAt: normalized.version.capturedAt,
          },
          now,
        });

        await this.audit.write({
          actorId: studentId,
          actorRole: 'student',
          action: 'artifact.create',
          targetType: 'artifact',
          targetId: artifact.id,
          idempotencyKey: `${scope}:${idempotencyKey}`,
          detail: { projectId: artifact.projectId, status: artifact.status },
        });
        this.logger.log(`创建作品 id=${artifact.id} 学生=${studentId}`);
        return { status: 201, body: await this.toView(artifact) };
      });
      return result.body;
    } catch (error) {
      throwHttpForIdempotencyError(error);
      throw error;
    }
  }

  async updateArtifact(
    studentId: string,
    artifactId: string,
    input: UpdateArtifactRequest,
    idempotencyKey: string,
    ifMatch: string | undefined,
  ): Promise<ArtifactView> {
    const artifact = await this.requireArtifact(artifactId);
    if (artifact.studentId !== studentId) throw this.forbidden();
    assertEditable(artifact);

    const expectedRevision = parseIfMatch(ifMatch);
    if (expectedRevision !== null && expectedRevision !== artifact.currentVersionIndex) {
      throw this.staleRevision(artifact, expectedRevision);
    }

    const normalized = normalizeUpdate(input);
    const scope = `student.artifact.update:${studentId}:${artifactId}`;
    const requestHash = hashIdempotentInput(scope, { artifactId }, normalized);

    try {
      const result = await this.idempotency.execute(scope, idempotencyKey, requestHash, async () => {
        const now = new Date();
        const { artifact: updated, version } = await this.appendVersionOrConflict(
          artifact,
          expectedRevision ?? artifact.currentVersionIndex,
          normalized,
          now,
        );
        await this.audit.write({
          actorId: studentId,
          actorRole: 'student',
          action: 'artifact.update',
          targetType: 'artifact',
          targetId: artifactId,
          idempotencyKey: `${scope}:${idempotencyKey}`,
          detail: { revision: updated.currentVersionIndex, versionId: version.id },
        });
        return { status: 200, body: await this.toView(updated) };
      });
      return result.body;
    } catch (error) {
      throwHttpForIdempotencyError(error);
      throw error;
    }
  }

  /**
   * 学生申请发布。
   *
   * - 已有班主任批准的复核记录 → 直接发布并写入 `publishedAt`，同时物化
   *   `independent` 证据（作品发布是服务端事实，不是客户端字段）；
   * - 没有批准记录 → 先进入 `submitted`，并（幂等地）创建一条
   *   `mentor_reviews`（kind=artifact, status=requested）等待班主任复核。
   *
   * 客户端永远不能通过请求体设置 `publishedAt` / `status` / 证据。
   */
  async publishArtifact(
    studentId: string,
    artifactId: string,
    idempotencyKey: string,
  ): Promise<ArtifactView> {
    const artifact = await this.requireArtifact(artifactId);
    if (artifact.studentId !== studentId) throw this.forbidden();

    const scope = `student.artifact.publish:${studentId}:${artifactId}`;
    const requestHash = hashIdempotentInput(scope, { artifactId }, {});

    try {
      const result = await this.idempotency.execute(scope, idempotencyKey, requestHash, async () => {
        const now = new Date();
        const approved = await this.store.findApprovedReviewForArtifact(artifactId);
        if (approved !== null) {
          const published = await this.transitionOrConflict(
            artifactId,
            ['draft', 'changes_requested', 'submitted', 'in_review', 'archived'],
            publishFromReview(artifact.status),
            now,
            now,
          );
          await this.evidence.materializeArtifactPublished(published, now);
          await this.audit.write({
            actorId: studentId,
            actorRole: 'student',
            action: 'artifact.publish',
            targetType: 'artifact',
            targetId: artifactId,
            idempotencyKey: `${scope}:${idempotencyKey}`,
            detail: {
              reviewId: approved.id,
              status: published.status,
              projectId: published.projectId,
            },
          });
          return { status: 200, body: await this.toView(published) };
        }

        // 无批准：进入待审核，并联动复核记录。
        const nextStatus = submitForReview(artifact.status);
        if (nextStatus !== artifact.status) {
          await this.transitionOrConflict(
            artifactId,
            [artifact.status],
            nextStatus,
            now,
            undefined,
          );
        }
        const mentorUserId = await this.directory.mentorOfStudent(studentId);
        if (mentorUserId === null) {
          throw new ConflictException({
            code: 'ARTIFACT_MENTOR_REQUIRED',
            message: '当前没有在任班主任，无法提交作品复核',
          });
        }
        const active = await this.store.findActiveReviewForArtifact(artifactId);
        if (active === null) {
          await this.store.createMentorReview({
            id: `mr-${randomUUID()}`,
            schoolId: artifact.schoolId,
            studentId,
            mentorUserId,
            projectId: artifact.projectId,
            artifactId,
            status: 'requested',
            idempotencyKey: `${scope}:${idempotencyKey}:review`,
            now,
          });
        }
        const submitted = (await this.store.findArtifact(artifactId)) ?? artifact;
        await this.audit.write({
          actorId: studentId,
          actorRole: 'student',
          action: 'artifact.submit_review',
          targetType: 'artifact',
          targetId: artifactId,
          idempotencyKey: `${scope}:${idempotencyKey}`,
          detail: {
            mentorUserId,
            status: submitted.status,
            projectId: submitted.projectId,
          },
        });
        return { status: 200, body: await this.toView(submitted) };
      });
      return result.body;
    } catch (error) {
      throwHttpForIdempotencyError(error);
      throw error;
    }
  }

  /** 撤回：进入 `archived`，保留版本与历史 `publishedAt`，可再次申请发布。 */
  async withdrawArtifact(
    studentId: string,
    artifactId: string,
    idempotencyKey: string,
  ): Promise<ArtifactView> {
    const artifact = await this.requireArtifact(artifactId);
    if (artifact.studentId !== studentId) throw this.forbidden();

    const scope = `student.artifact.withdraw:${studentId}:${artifactId}`;
    const requestHash = hashIdempotentInput(scope, { artifactId }, {});

    try {
      const result = await this.idempotency.execute(scope, idempotencyKey, requestHash, async () => {
        const now = new Date();
        const next = withdrawArtifact(artifact.status);
        const archived =
          next === artifact.status
            ? artifact
            : await this.transitionOrConflict(
                artifactId,
                ['draft', 'submitted', 'in_review', 'published', 'changes_requested'],
                next,
                now,
                undefined,
              );
        await this.audit.write({
          actorId: studentId,
          actorRole: 'student',
          action: 'artifact.withdraw',
          targetType: 'artifact',
          targetId: artifactId,
          idempotencyKey: `${scope}:${idempotencyKey}`,
          detail: { status: archived.status, projectId: archived.projectId },
        });
        return { status: 200, body: await this.toView(archived) };
      });
      return result.body;
    } catch (error) {
      throwHttpForIdempotencyError(error);
      throw error;
    }
  }

  /** 对象存储签名 URL：适配器边界；live 未配置时 503，不回退假地址。 */
  async presignUpload(
    studentId: string,
    input: PresignUploadRequest,
    idempotencyKey: string,
  ): Promise<PresignUploadResult> {
    const normalized = normalizePresign(input);
    const scope = `student.files.presign:${studentId}`;
    const requestHash = hashIdempotentInput(scope, {}, normalized);

    try {
      const result = await this.idempotency.execute(scope, idempotencyKey, requestHash, async () => {
        const presigned = await this.presigner.presign(normalized);
        await this.audit.write({
          actorId: studentId,
          actorRole: 'student',
          action: 'artifact.presign',
          targetType: 'object_upload',
          targetId: presigned.objectKey,
          idempotencyKey: `${scope}:${idempotencyKey}`,
          detail: {
            purpose: normalized.purpose,
            contentType: normalized.contentType,
            sizeBytes: normalized.sizeBytes,
          },
        });
        return { status: 201, body: presigned };
      });
      return result.body;
    } catch (error) {
      throwHttpForIdempotencyError(error);
      throw error;
    }
  }

  /* ============================== 内部 ============================== */

  private async requireArtifact(artifactId: string): Promise<ArtifactRecord> {
    const artifact = await this.store.findArtifact(artifactId);
    if (artifact === null) {
      throw new NotFoundException({ code: 'ARTIFACT_NOT_FOUND', message: '作品不存在' });
    }
    return artifact;
  }

  private async resolveRelationship(
    actor: CurrentUser,
    artifact: ArtifactRecord,
  ): Promise<ArtifactRelationship> {
    if (actor.role === 'student') {
      return { isOwner: actor.id === artifact.studentId, isMentor: false, isGuardian: false };
    }
    if (actor.role === 'teacher') {
      return {
        isOwner: false,
        isMentor: await this.directory.isMentorOf(actor.id, artifact.studentId),
        isGuardian: false,
      };
    }
    if (actor.role === 'parent') {
      return {
        isOwner: false,
        isMentor: false,
        isGuardian: await this.directory.isGuardianOf(actor.id, artifact.studentId),
      };
    }
    return { isOwner: false, isMentor: false, isGuardian: false };
  }

  /** 解析列表的可见范围；班主任 / 家长只能看已发布，其他角色 403。 */
  private async resolveListScope(
    actor: CurrentUser,
    query: ArtifactListQuery,
  ): Promise<{ studentIds: string[]; statuses?: ArtifactStatus[]; projectId?: string | null }> {
    if (actor.role === 'student') {
      return {
        studentIds: [actor.id],
        statuses: query.status === undefined || query.status === null ? undefined : [query.status],
        projectId: query.projectId ?? null,
      };
    }
    if (actor.role === 'teacher') {
      const students = await this.directory.studentsOfMentor(actor.id);
      return {
        studentIds: students,
        // 班主任只读已发布作品。
        statuses: ['published'],
        projectId: query.projectId ?? null,
      };
    }
    if (actor.role === 'parent') {
      const children = await this.directory.childrenOfParent(actor.id);
      return {
        studentIds: children,
        statuses: ['published'],
        projectId: query.projectId ?? null,
      };
    }
    throw this.forbidden();
  }

  private async appendVersionOrConflict(
    artifact: ArtifactRecord,
    expectedRevision: number,
    patch: NormalizedUpdate,
    now: Date,
  ): Promise<{ artifact: ArtifactRecord; version: ArtifactVersionRecord }> {
    try {
      return await this.store.appendVersion({
        artifactId: artifact.id,
        expectedRevision,
        title: patch.title,
        note: patch.version.note,
        objectKey: patch.version.objectKey,
        thumbnailRef: patch.version.thumbnailRef,
        capturedAt: patch.version.capturedAt,
        now,
      });
    } catch (error) {
      if (error instanceof WorksStoreConflictError) {
        const current = await this.store.findArtifact(artifact.id);
        if (current === null) {
          throw new NotFoundException({ code: 'ARTIFACT_NOT_FOUND', message: '作品不存在' });
        }
        throw this.staleRevision(current, expectedRevision);
      }
      throw error;
    }
  }

  private async transitionOrConflict(
    artifactId: string,
    expectedStatuses: readonly ArtifactStatus[],
    status: ArtifactStatus,
    now: Date,
    publishedAt: Date | null | undefined,
  ): Promise<ArtifactRecord> {
    try {
      return await this.store.transitionArtifact({
        artifactId,
        expectedStatuses,
        status,
        publishedAt,
        now,
      });
    } catch (error) {
      if (error instanceof WorksStoreConflictError) {
        throw new ConflictException({
          code: 'ARTIFACT_TRANSITION_INVALID',
          message: '作品状态已变化，请重新读取后再试',
        });
      }
      throw error;
    }
  }

  private async toView(artifact: ArtifactRecord): Promise<ArtifactView> {
    // 家长 / 班主任投影也复用同一视图：其中不含原始对话、语音或审计字段。
    const versions = await this.store.listVersions(artifact.id);
    const latest = versions.length === 0 ? null : versions[versions.length - 1]!;
    const reviewed = await this.store.listReviewsForArtifact(artifact.id);
    const latestReview = reviewed.length === 0 ? null : reviewed[reviewed.length - 1]!;
    return {
      id: artifact.id,
      projectId: artifact.projectId,
      studentId: artifact.studentId,
      title: artifact.title,
      summary: artifact.summary,
      tags: [...artifact.tags],
      status: artifact.status,
      visibility: artifact.visibility,
      currentVersionIndex: artifact.currentVersionIndex,
      publishedAt: artifact.publishedAt?.toISOString() ?? null,
      createdAt: artifact.createdAt.toISOString(),
      updatedAt: artifact.updatedAt.toISOString(),
      versionCount: versions.length,
      latestVersion: latest === null ? null : toVersionView(latest),
      reviewStatus: latestReview?.status ?? 'none',
    };
  }

  private staleRevision(artifact: ArtifactRecord, expected: number): ConflictException {
    return new ConflictException({
      code: 'ARTIFACT_REVISION_CONFLICT',
      message: '作品已被更新，请基于最新版本重试',
      currentRevision: artifact.currentVersionIndex,
      expectedRevision: expected,
    });
  }

  private forbidden(): ForbiddenException {
    return new ForbiddenException({ code: 'ARTIFACT_FORBIDDEN', message: '无权访问该作品' });
  }
}

/* ==================== 归一化 / 校验 ==================== */

interface NormalizedVersion {
  note: string;
  objectKey: string | null;
  thumbnailRef: string | null;
  capturedAt: Date | null;
}

interface NormalizedCreate {
  projectId: string | null;
  title: string;
  summary: string;
  tags: string[];
  version: NormalizedVersion;
}

interface NormalizedUpdate {
  title: string;
  summary: string;
  tags: string[];
  version: NormalizedVersion;
}

function normalizeCreate(input: CreateArtifactRequest): NormalizedCreate {
  const title = normalizeTitle(input.title);
  const summary = normalizeSummary(input.summary);
  const tags = normalizeTags(input.tags);
  const version = normalizeVersion(input.version, title);
  const projectId =
    typeof input.projectId === 'string' && input.projectId.trim().length > 0
      ? input.projectId.trim()
      : null;
  return { projectId, title, summary, tags, version };
}

function normalizeUpdate(input: UpdateArtifactRequest): NormalizedUpdate {
  const title = normalizeTitle(input.title);
  const summary = normalizeSummary(input.summary);
  const tags = normalizeTags(input.tags);
  const version = normalizeVersion(input.version, title);
  return { title, summary, tags, version };
}

function normalizeTitle(raw: unknown): string {
  const title = typeof raw === 'string' ? raw.trim() : '';
  if (title.length === 0 || title.length > MAX_ARTIFACT_TITLE_LENGTH) {
    throw new BadRequestException({
      code: 'ARTIFACT_INVALID',
      message: `作品标题必填且不超过 ${MAX_ARTIFACT_TITLE_LENGTH} 字`,
    });
  }
  return title;
}

function normalizeSummary(raw: unknown): string {
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string') {
    throw new BadRequestException({ code: 'ARTIFACT_INVALID', message: '作品简介必须为字符串' });
  }
  const summary = raw.trim();
  if (summary.length > MAX_ARTIFACT_SUMMARY_LENGTH) {
    throw new BadRequestException({
      code: 'ARTIFACT_INVALID',
      message: `作品简介不超过 ${MAX_ARTIFACT_SUMMARY_LENGTH} 字`,
    });
  }
  return summary;
}

function normalizeTags(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new BadRequestException({ code: 'ARTIFACT_INVALID', message: 'tags 必须为字符串数组' });
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') {
      throw new BadRequestException({ code: 'ARTIFACT_INVALID', message: 'tags 必须为字符串数组' });
    }
    const tag = item.trim();
    if (tag.length === 0) continue;
    if (tag.length > MAX_ARTIFACT_TAG_LENGTH) {
      throw new BadRequestException({
        code: 'ARTIFACT_INVALID',
        message: `单个标签不超过 ${MAX_ARTIFACT_TAG_LENGTH} 字`,
      });
    }
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  if (out.length > MAX_ARTIFACT_TAGS) {
    throw new BadRequestException({
      code: 'ARTIFACT_INVALID',
      message: `标签最多 ${MAX_ARTIFACT_TAGS} 个`,
    });
  }
  return out;
}

function normalizeVersion(raw: ArtifactVersionInput | undefined, fallbackTitle: string): NormalizedVersion {
  const note = normalizeOptionalText(
    raw?.note,
    MAX_ARTIFACT_VERSION_NOTE_LENGTH,
    '版本说明',
  );
  return {
    note: note ?? '',
    objectKey: normalizeOptionalRef(raw?.objectKey),
    thumbnailRef: normalizeOptionalRef(raw?.thumbnailRef),
    capturedAt: normalizeOptionalDate(raw?.capturedAt),
  };
}

function normalizeOptionalText(raw: unknown, max: number, label: string): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') {
    throw new BadRequestException({ code: 'ARTIFACT_INVALID', message: `${label}必须为字符串` });
  }
  const value = raw.trim();
  if (value.length === 0) return null;
  if (value.length > max) {
    throw new BadRequestException({
      code: 'ARTIFACT_INVALID',
      message: `${label}不超过 ${max} 字`,
    });
  }
  return value;
}

function normalizeOptionalRef(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') {
    throw new BadRequestException({ code: 'ARTIFACT_INVALID', message: '对象引用必须为字符串' });
  }
  const value = raw.trim();
  return value.length === 0 ? null : value;
}

function normalizeOptionalDate(raw: unknown): Date | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') {
    throw new BadRequestException({ code: 'ARTIFACT_INVALID', message: 'capturedAt 必须为 ISO 字符串' });
  }
  const value = raw.trim();
  if (value.length === 0) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException({ code: 'ARTIFACT_INVALID', message: 'capturedAt 不是合法时间' });
  }
  return date;
}

function normalizePresign(input: PresignUploadRequest): {
  filename: string;
  contentType: string;
  sizeBytes: number;
  purpose: PresignPurpose;
} {
  const filename = typeof input.filename === 'string' ? input.filename.trim() : '';
  if (filename.length === 0 || filename.length > MAX_PRESIGN_FILENAME_LENGTH) {
    throw new BadRequestException({
      code: 'ARTIFACT_INVALID',
      message: `文件名必填且不超过 ${MAX_PRESIGN_FILENAME_LENGTH} 字`,
    });
  }
  const contentType = typeof input.contentType === 'string' ? input.contentType.trim() : '';
  if (!(ALLOWED_PRESIGN_CONTENT_TYPES as readonly string[]).includes(contentType)) {
    throw new BadRequestException({ code: 'ARTIFACT_INVALID', message: '不支持的文件类型' });
  }
  const sizeBytes = typeof input.sizeBytes === 'number' ? input.sizeBytes : Number.NaN;
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_PRESIGN_SIZE_BYTES) {
    throw new BadRequestException({ code: 'ARTIFACT_INVALID', message: '文件大小非法' });
  }
  const purpose = input.purpose ?? 'artifact';
  if (!PRESIGN_PURPOSES.includes(purpose)) {
    throw new BadRequestException({ code: 'ARTIFACT_INVALID', message: '上传用途非法' });
  }
  return { filename, contentType, sizeBytes, purpose };
}

function assertEditable(artifact: ArtifactRecord): void {
  // 复用状态机，保持「哪些状态可编辑」只有一份定义。
  if (!isArtifactEditable(artifact.status)) {
    throw new ConflictException({
      code: 'ARTIFACT_NOT_EDITABLE',
      message: `作品状态为 ${artifact.status}，提交审核或发布后不可再编辑`,
    });
  }
}

function parseIfMatch(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const value = raw.trim().replace(/^W\//, '').replace(/^"|"$/g, '');
  if (value.length === 0) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new BadRequestException({ code: 'ARTIFACT_INVALID', message: 'If-Match 必须为版本号' });
  }
  return parsed;
}

function toRef(artifact: ArtifactRecord): ArtifactRef {
  return { studentId: artifact.studentId, status: artifact.status, visibility: artifact.visibility };
}

function toVersionView(version: ArtifactVersionRecord): ArtifactVersionView {
  return {
    id: version.id,
    ordinal: version.ordinal,
    title: version.title,
    note: version.note,
    objectKey: version.objectKey,
    thumbnailRef: version.thumbnailRef,
    capturedAt: version.capturedAt?.toISOString() ?? null,
    createdAt: version.createdAt.toISOString(),
  };
}
