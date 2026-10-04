import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { CurrentUser } from '@qitu/contracts';
import { AuditWriter } from '../../common/audit/audit.service';
import { hashIdempotentInput } from '../../common/idempotency/idempotency.hash';
import { throwHttpForIdempotencyError } from '../../common/idempotency/idempotency.errors';
import { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import {
  chunkKnowledgeContent,
  computeKnowledgeChecksum,
  nextKnowledgeVersion,
  toKnowledgeEvidence,
} from './knowledge.content';
import { RetrievalPort } from './knowledge.retrieval.port';
import { KnowledgeStore, type KnowledgeCandidateQuery } from './knowledge.store';
import { KnowledgeScopeAuthorizer } from './knowledge.scope-authorizer';
import {
  canReadKnowledgeDocument,
  evaluateKnowledgeWrite,
  isReservedKnowledgeSource,
  validateKnowledgeScopeShape,
  type KnowledgeActorContext,
} from './knowledge.scope-policy';
import {
  DEFAULT_RETRIEVAL_LIMIT,
  KNOWLEDGE_SCOPES,
  MAX_EVIDENCE_ITEMS,
  MAX_KNOWLEDGE_CONTENT_LENGTH,
  MAX_KNOWLEDGE_SOURCE_LENGTH,
  MAX_KNOWLEDGE_SUMMARY_LENGTH,
  MAX_KNOWLEDGE_TAGS,
  MAX_KNOWLEDGE_TAG_LENGTH,
  MAX_KNOWLEDGE_TITLE_LENGTH,
  MAX_RETRIEVAL_LIMIT,
  type KnowledgeDocument,
  type KnowledgeDocumentUpsertInput,
  type KnowledgeDocumentView,
  type KnowledgeErrorCode,
  type KnowledgeMutationOutcome,
  type KnowledgeMutationResult,
  type KnowledgeScope,
  type KnowledgeScopeFields,
  type KnowledgeSearchResponse,
} from './knowledge.types';

/** 归一化后的写入入参（作用域字段齐全，长度已校验）。 */
interface NormalizedKnowledgeInput {
  id: string | null;
  scope: KnowledgeScope;
  schoolId: string | null;
  ownerUserId: string | null;
  projectId: string | null;
  title: string;
  summary: string;
  tags: string[];
  content: string;
  source: string;
  sourceRef: string | null;
}

/**
 * 作用域知识服务。
 *
 * 职责：
 * 1. **授权**：读 / 写之前先经 `KnowledgeScopeAuthorizer` 解析关系事实，再由
 *    `knowledge.scope-policy.ts` 的纯规则判定；前端隐藏不构成授权。
 * 2. **只检索已校验知识**：`status !== 'verified'` 的文档永远进不了检索结果。
 * 3. **版本与校验**：正文变更才升版本并重置为 `draft`（清空校验字段），
 *    元数据变更不算修订；内容与元数据都没变则 `unchanged`，不写库。
 * 4. **幂等**：写入 / 校验命令都走 `IdempotencyStore`，同键同载荷重放、
 *    同键异载荷 409。
 * 5. **审计**：每次真实写入都写审计；无实际变更的 `unchanged` 不产生噪音审计。
 * 6. **未成年人最小暴露**：拒绝原始对话 / 语音来源进入共享知识路径；证据
 *    投影有界，避免整段正文灌入模型上下文。
 */
@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);

  constructor(
    private readonly store: KnowledgeStore,
    private readonly retrieval: RetrievalPort,
    private readonly authorizer: KnowledgeScopeAuthorizer,
    private readonly idempotency: IdempotencyStore,
    private readonly audit: AuditWriter,
  ) {}

  /* ============================== 读 ============================== */

  /**
   * 作用域内检索已校验知识，返回**有界**证据投影，供 AI 搭档 `context_packet` 使用。
   *
   * 检索前做三层过滤：SQL / 内存层按 `verified` + 作用域粗过滤，规则层按
   * 学校 / 项目 / 本人细过滤，最后交给确定性关键词端口排序。
   */
  async search(
    actor: CurrentUser,
    request: { text?: unknown; projectId?: unknown; limit?: unknown },
  ): Promise<KnowledgeSearchResponse> {
    const text = typeof request.text === 'string' ? request.text : '';
    const limit = clampRetrievalLimit(request.limit);
    const context = await this.authorizer.loadActorContext(actor);
    const requestedProjectId = normalizeOptionalId(request.projectId);
    const projectAccessible =
      requestedProjectId !== null
        ? await this.authorizer.canAccessProject(actor, requestedProjectId)
        : false;
    const projectId = projectAccessible ? requestedProjectId : null;

    const candidates = await this.store.listVerifiedCandidates({
      actorId: context.actorId,
      schoolId: context.schoolId,
      projectId,
    });
    const allowed = candidates.filter((candidate) =>
      canReadKnowledgeDocument(candidate.document, {
        actor: context,
        projectId,
        projectAccessible,
      }),
    );

    const hits = this.retrieval.retrieve({ text, limit }, allowed);
    return {
      evidence: hits.slice(0, MAX_EVIDENCE_ITEMS).map(toKnowledgeEvidence),
      limit,
    };
  }

  /**
   * 读取单篇文档。
   *
   * 可读者按 `verified` 规则；此外，能维护该作用域的主体（作者 / 管理员 / 本校教师）
   * 可以查看自己的草稿。越权与不存在一律 404，避免用状态码差异探测文档存在性。
   */
  async getDocument(actor: CurrentUser, documentId: string): Promise<KnowledgeDocumentView> {
    const document = await this.store.findDocument(documentId);
    if (document === null) throw documentNotFound();

    const context = await this.authorizer.loadActorContext(actor);
    const fields = scopeFieldsOf(document);
    const projectAccessible =
      fields.projectId !== null
        ? await this.authorizer.canAccessProject(actor, fields.projectId)
        : false;

    const readable = canReadKnowledgeDocument(document, {
      actor: context,
      projectId: fields.projectId,
      projectAccessible,
    });
    if (!readable) {
      const canManage = evaluateKnowledgeWrite(context, fields, projectAccessible);
      if (!canManage.allowed) throw documentNotFound();
    }
    return toView(document);
  }

  async listAdminDocuments(actor: CurrentUser): Promise<KnowledgeDocumentView[]> {
    if (actor.role !== 'admin') throw new ForbiddenException('知识库治理仅向管理员开放');
    const documents = await this.store.listDocuments();
    return documents.map(toView);
  }

  /* ============================== 写 ============================== */

  /**
   * 新建或修订文档（幂等）。
   *
   * - 未携带 `id` → 新建（`v1` / `draft`）；
   * - 携带 `id` → 修订既有文档；作用域绑定不可变，正文变更会升版本并回到
   *   `draft` 等待重新校验；
   * - 内容与元数据完全一致 → `unchanged`，不写库、不写审计。
   */
  async upsertDocument(
    actor: CurrentUser,
    input: KnowledgeDocumentUpsertInput,
    idempotencyKey: string,
  ): Promise<KnowledgeMutationResult> {
    const normalized = normalizeUpsertInput(input);
    const context = await this.authorizer.loadActorContext(actor);
    const fields: KnowledgeScopeFields = {
      scope: normalized.scope,
      schoolId: normalized.schoolId,
      ownerUserId: normalized.ownerUserId,
      projectId: normalized.projectId,
    };
    const projectAccessible =
      fields.projectId !== null
        ? await this.authorizer.canAccessProject(actor, fields.projectId)
        : false;
    assertWriteAllowed(context, fields, projectAccessible);

    const scope = `knowledge.document.upsert:${context.actorId}`;
    const requestHash = hashIdempotentInput(scope, { documentId: normalized.id ?? null }, normalized);

    try {
      const result = await this.idempotency.execute<KnowledgeMutationResult>(
        scope,
        idempotencyKey,
        requestHash,
        async () => {
          const outcome = await this.persistDocument(normalized);
        if (outcome.outcome !== 'unchanged') {
          await this.audit.write({
            actorId: context.actorId,
            actorRole: context.role,
            action:
              outcome.outcome === 'created'
                ? 'knowledge.document.create'
                : 'knowledge.document.revise',
            targetType: 'knowledge_document',
            targetId: outcome.document.id,
            idempotencyKey: `${scope}:${idempotencyKey}`,
            detail: {
              scope: outcome.document.scope,
              schoolId: outcome.document.schoolId,
              ownerUserId: outcome.document.ownerUserId,
              projectId: outcome.document.projectId,
              version: outcome.document.version,
              source: outcome.document.source,
            },
          });
          this.logger.log(
            `知识文档${outcome.outcome === 'created' ? '新建' : '修订'} id=${outcome.document.id} scope=${outcome.document.scope} version=${outcome.document.version}`,
          );
        }
        return {
          status: outcome.outcome === 'created' ? 201 : 200,
          body: {
            document: toView(outcome.document),
            outcome: outcome.outcome,
            replayed: false,
          } satisfies KnowledgeMutationResult,
        };
      });
      return { ...result.body, replayed: result.replayed };
    } catch (error) {
      throwHttpForIdempotencyError(error);
    }
  }

  /**
   * 校验文档（幂等）：`draft → verified`，写入 `verifiedBy` / `verifiedAt`。
   *
   * 已是 `verified` 时是幂等空操作（返回 `unchanged`），不重复写审计。
   * 校验权限与写入权限同一套规则：能维护该作用域者才能校验。
   */
  async verifyDocument(
    actor: CurrentUser,
    documentId: string,
    idempotencyKey: string,
  ): Promise<KnowledgeMutationResult> {
    const context = await this.authorizer.loadActorContext(actor);
    const scope = `knowledge.document.verify:${context.actorId}:${documentId}`;
    const requestHash = hashIdempotentInput(scope, { documentId }, {});

    try {
      const result = await this.idempotency.execute<KnowledgeMutationResult>(
        scope,
        idempotencyKey,
        requestHash,
        async () => {
          const document = await this.store.findDocument(documentId);
          if (document === null) throw documentNotFound();

        const fields = scopeFieldsOf(document);
        const projectAccessible =
          fields.projectId !== null
            ? await this.authorizer.canAccessProject(actor, fields.projectId)
            : false;
        assertWriteAllowed(context, fields, projectAccessible);

        if (document.status === 'verified') {
          return {
            status: 200,
            body: {
              document: toView(document),
              outcome: 'unchanged',
              replayed: false,
            } satisfies KnowledgeMutationResult,
          };
        }

        const now = new Date();
        const updated = await this.store.setDocumentVerification(documentId, {
          status: 'verified',
          verifiedBy: context.actorId,
          verifiedAt: now,
          updatedAt: now,
        });
        if (updated === null) throw documentNotFound();

        await this.audit.write({
          actorId: context.actorId,
          actorRole: context.role,
          action: 'knowledge.document.verify',
          targetType: 'knowledge_document',
          targetId: updated.id,
          idempotencyKey: `${scope}:${idempotencyKey}`,
          detail: {
            scope: updated.scope,
            version: updated.version,
            schoolId: updated.schoolId,
            projectId: updated.projectId,
          },
        });
        this.logger.log(`知识文档校验通过 id=${updated.id} scope=${updated.scope}`);
        return {
          status: 200,
          body: {
            document: toView(updated),
            outcome: 'revised',
            replayed: false,
          } satisfies KnowledgeMutationResult,
        };
      });
      return { ...result.body, replayed: result.replayed };
    } catch (error) {
      throwHttpForIdempotencyError(error);
    }
  }

  /* ============================== 内部 ============================== */

  private async persistDocument(
    input: NormalizedKnowledgeInput,
  ): Promise<{ outcome: KnowledgeMutationOutcome; document: KnowledgeDocument }> {
    const now = new Date();
    const checksum = computeKnowledgeChecksum(input.content);
    const existing = input.id !== null ? await this.store.findDocument(input.id) : null;

    if (existing !== null) {
      const sameScope =
        existing.scope === input.scope &&
        existing.schoolId === input.schoolId &&
        existing.ownerUserId === input.ownerUserId &&
        existing.projectId === input.projectId;
      if (!sameScope) {
        throw new BadRequestException({
          code: 'KNOWLEDGE_SCOPE_INVALID' satisfies KnowledgeErrorCode,
          message: '已存在文档的作用域绑定不可修改',
        });
      }

      const contentChanged = existing.checksum !== checksum;
      const metadataChanged =
        existing.title !== input.title ||
        existing.summary !== input.summary ||
        existing.source !== input.source ||
        existing.sourceRef !== input.sourceRef ||
        !sameTags(existing.tags, input.tags);

      if (!contentChanged && !metadataChanged) {
        return { outcome: 'unchanged', document: existing };
      }

      const version = contentChanged ? nextKnowledgeVersion(existing.version) : existing.version;
      const document: KnowledgeDocument = {
        ...existing,
        title: input.title,
        summary: input.summary,
        tags: [...input.tags],
        content: input.content,
        source: input.source,
        sourceRef: input.sourceRef,
        checksum,
        version,
        // 正文变更 → 回到 draft 并清空校验凭据，等待重新校验。
        status: contentChanged ? 'draft' : existing.status,
        verifiedBy: contentChanged ? null : existing.verifiedBy,
        verifiedAt: contentChanged ? null : existing.verifiedAt,
        updatedAt: now,
      };
      // 仅元数据变更时保留既有分块（未来接入 embedding 后不会丢向量）。
      const chunks = contentChanged
        ? chunkKnowledgeContent(document.id, input.content, now)
        : await this.store.findChunks(document.id);
      await this.store.upsertDocument(document, chunks);
      return { outcome: 'revised', document };
    }

    const document: KnowledgeDocument = {
      id: input.id ?? `knowledge-${randomUUID()}`,
      schoolId: input.schoolId,
      scope: input.scope,
      ownerUserId: input.ownerUserId,
      projectId: input.projectId,
      title: input.title,
      summary: input.summary,
      tags: [...input.tags],
      content: input.content,
      source: input.source,
      sourceRef: input.sourceRef,
      checksum,
      version: 'v1',
      status: 'draft',
      verifiedBy: null,
      verifiedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.upsertDocument(document, chunkKnowledgeContent(document.id, input.content, now));
    return { outcome: 'created', document };
  }
}

/* ============================== 纯函数 ============================== */

function sameTags(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((tag, index) => tag === right[index]);
}

function scopeFieldsOf(document: KnowledgeDocument): KnowledgeScopeFields {
  return {
    scope: document.scope,
    schoolId: document.schoolId,
    ownerUserId: document.ownerUserId,
    projectId: document.projectId,
  };
}

function assertWriteAllowed(
  actor: KnowledgeActorContext,
  fields: KnowledgeScopeFields,
  projectAccessible: boolean,
): void {
  const decision = evaluateKnowledgeWrite(actor, fields, projectAccessible);
  if (decision.allowed) return;
  if (decision.reason === 'scope_invalid') {
    throw new BadRequestException({
      code: 'KNOWLEDGE_SCOPE_INVALID' satisfies KnowledgeErrorCode,
      message: decision.message ?? '知识作用域不合法',
    });
  }
  throw new ForbiddenException({
    code: 'KNOWLEDGE_FORBIDDEN' satisfies KnowledgeErrorCode,
    message: decision.message ?? '无权维护该知识',
  });
}

function documentNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'KNOWLEDGE_NOT_FOUND' satisfies KnowledgeErrorCode,
    message: '知识文档不存在',
  });
}

function clampRetrievalLimit(raw: unknown): number {
  let value: number | null = null;
  if (typeof raw === 'number' && Number.isFinite(raw)) value = raw;
  else if (typeof raw === 'string' && raw.trim().length > 0) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) value = parsed;
  }
  if (value === null) return DEFAULT_RETRIEVAL_LIMIT;
  return Math.min(Math.max(Math.trunc(value), 1), MAX_RETRIEVAL_LIMIT);
}

function normalizeOptionalId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return value.length === 0 ? null : value;
}

function assertBoundedText(
  raw: unknown,
  label: string,
  maxLength: number,
  required: boolean,
): string {
  if (raw === null || raw === undefined) {
    if (required) {
      throw inputInvalid(`${label} 不能为空`);
    }
    return '';
  }
  if (typeof raw !== 'string') {
    throw inputInvalid(`${label} 必须为字符串`);
  }
  const value = raw.trim();
  if (required && value.length === 0) {
    throw inputInvalid(`${label} 不能为空`);
  }
  if (value.length > maxLength) {
    throw inputInvalid(`${label} 不能超过 ${maxLength} 字`);
  }
  return value;
}

function normalizeTags(raw: unknown): string[] {
  if (raw === null || raw === undefined) return [];
  if (!Array.isArray(raw)) throw inputInvalid('tags 必须为字符串数组');
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') throw inputInvalid('tags 必须为字符串数组');
    const tag = item.trim();
    if (tag.length === 0) continue;
    if (tag.length > MAX_KNOWLEDGE_TAG_LENGTH) {
      throw inputInvalid(`单个标签不能超过 ${MAX_KNOWLEDGE_TAG_LENGTH} 字`);
    }
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  if (out.length > MAX_KNOWLEDGE_TAGS) {
    throw inputInvalid(`标签最多 ${MAX_KNOWLEDGE_TAGS} 个`);
  }
  return out;
}

function inputInvalid(message: string): BadRequestException {
  return new BadRequestException({
    code: 'KNOWLEDGE_INPUT_INVALID' satisfies KnowledgeErrorCode,
    message,
  });
}

/**
 * 归一化并校验写入入参。
 *
 * 这是**服务端**的字段白名单与边界校验：长度、标签数量、作用域绑定一致性，
 * 以及「原始对话 / 语音不得进入共享知识」的来源守卫。客户端无法绕过。
 */
export function normalizeUpsertInput(raw: KnowledgeDocumentUpsertInput): NormalizedKnowledgeInput {
  if (raw === null || typeof raw !== 'object') {
    throw inputInvalid('请求体必须为对象');
  }
  const scope = raw.scope;
  if (typeof scope !== 'string' || !KNOWLEDGE_SCOPES.includes(scope as KnowledgeScope)) {
    throw inputInvalid(`scope 必须是 ${KNOWLEDGE_SCOPES.join(' / ')} 之一`);
  }

  const title = assertBoundedText(raw.title, 'title', MAX_KNOWLEDGE_TITLE_LENGTH, true);
  const summary = assertBoundedText(raw.summary, 'summary', MAX_KNOWLEDGE_SUMMARY_LENGTH, false);
  const content = assertBoundedText(raw.content, 'content', MAX_KNOWLEDGE_CONTENT_LENGTH, true);
  const source = assertBoundedText(raw.source, 'source', MAX_KNOWLEDGE_SOURCE_LENGTH, true);
  const sourceRef = normalizeOptionalId(raw.sourceRef);
  if (isReservedKnowledgeSource(source, sourceRef)) {
    throw new BadRequestException({
      code: 'KNOWLEDGE_SOURCE_FORBIDDEN' satisfies KnowledgeErrorCode,
      message: '原始对话 / 语音不得进入共享知识库',
    });
  }

  const fields: KnowledgeScopeFields = {
    scope: scope as KnowledgeScope,
    schoolId: normalizeOptionalId(raw.schoolId),
    ownerUserId: normalizeOptionalId(raw.ownerUserId),
    projectId: normalizeOptionalId(raw.projectId),
  };
  const shape = validateKnowledgeScopeShape(fields);
  if (!shape.valid) {
    throw new BadRequestException({
      code: 'KNOWLEDGE_SCOPE_INVALID' satisfies KnowledgeErrorCode,
      message: shape.message ?? '知识作用域不合法',
    });
  }

  return {
    id: normalizeOptionalId(raw.id),
    scope: fields.scope,
    schoolId: fields.schoolId,
    ownerUserId: fields.ownerUserId,
    projectId: fields.projectId,
    title,
    summary,
    tags: normalizeTags(raw.tags),
    content,
    source,
    sourceRef,
  };
}

function toView(document: KnowledgeDocument): KnowledgeDocumentView {
  return {
    id: document.id,
    scope: document.scope,
    schoolId: document.schoolId,
    ownerUserId: document.ownerUserId,
    projectId: document.projectId,
    title: document.title,
    summary: document.summary,
    tags: [...document.tags],
    version: document.version,
    status: document.status,
    source: document.source,
    sourceRef: document.sourceRef,
    checksum: document.checksum,
    verifiedAt: document.verifiedAt === null ? null : document.verifiedAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
    contentLength: document.content.length,
  };
}
