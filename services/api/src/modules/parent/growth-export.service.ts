import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  CurrentUser,
  ParentGrowthExportDocument,
  ParentGrowthExportJob,
  ParentGrowthExportRequest,
  StudentGrowthQuery,
} from '@qitu/contracts';
import { GrowthService } from '../growth/growth.service';
import { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { hashIdempotentInput } from '../../common/idempotency/idempotency.hash';
import { throwHttpForIdempotencyError } from '../../common/idempotency/idempotency.errors';
import { AuditWriter } from '../../common/audit/audit.service';
import {
  buildParentGrowthExportDocument,
  decideGrowthExportAccess,
} from './growth-export.projection';
import { GrowthExportStore, type GrowthExportRecord } from './growth-export.types';

/** 导出有效期：任务创建后 24h 内可下载，过期返回 410。 */
export const PARENT_GROWTH_EXPORT_TTL_MS = 24 * 60 * 60 * 1000;

/** 单次导出最多包含的成长条目数；超出时正文里 `truncated=true`。 */
export const PARENT_GROWTH_EXPORT_MAX_ENTRIES = 100;

/** 导出目的长度上限（与契约 `reason` 一致）。 */
export const PARENT_GROWTH_EXPORT_REASON_MAX_LENGTH = 200;

/** 全量导出所有类型的成长条目，按服务端上限截断。 */
const EXPORT_QUERY: StudentGrowthQuery = {
  type: 'all',
  projectId: null,
  from: null,
  to: null,
  cursor: null,
  limit: PARENT_GROWTH_EXPORT_MAX_ENTRIES,
};

/**
 * 家长成长导出服务（ISSUE-T5 / #7）。
 *
 * 只做四件事，且都在**服务端**：
 *  1. **对象级授权**：请求与下载两处都重新查 active 监护关系
 *     （`GrowthService.canParentReadChild` → DirectoryService 的关系真源）。
 *     授权被撤销后下载返回 403，而不是空数据。
 *  2. **白名单投影**：正文由 `buildParentGrowthExportDocument` 逐字段重建，
 *     不含原始 AI 对话 / 语音 / 风险标签 / 邮箱 / 模型推断。
 *  3. **幂等**：写操作经 `IdempotencyStore.execute`；同 key 重放返回第一次的
 *     任务，不产生第二条记录，也不重复写审计。
 *  4. **审计**：`parent.growth_export.requested` / `.downloaded` / `.denied`，
 *     detail 只记过程事实（孩子 id、状态、条目数、目的字段是否存在），**不含正文**。
 *
 * 当前是**同步生成 + 限时下载**：任务元数据与脱敏正文落库。异步 worker 与对象
 * 存储（大文件下载、真正导出到文件）尚未接入，未配置持久化时诚实返回 503。
 */
@Injectable()
export class ParentGrowthExportService {
  constructor(
    private readonly growth: GrowthService,
    private readonly idempotency: IdempotencyStore,
    private readonly audit: AuditWriter,
    @Inject(GrowthExportStore) private readonly store: GrowthExportStore | null,
  ) {}

  /** 请求一次导出。要求 `Idempotency-Key`（控制器保证非空）。 */
  async requestExport(
    actor: CurrentUser,
    childId: string,
    input: ParentGrowthExportRequest,
    idempotencyKey: string,
  ): Promise<ParentGrowthExportJob> {
    const reason = normaliseReason(input.reason);
    const confirmGuardianEmail = normaliseConfirmation(actor, childId, input);

    // 先校验对象级授权，再检查存储可用性：无权用户不应从 503/403 的差异里
    // 推断出功能是否可用。
    if (!(await this.growth.canParentReadChild(actor.id, childId))) {
      await this.auditDenied(actor, childId, null, 'guardian_link_inactive');
      throw new ForbiddenException({
        code: 'PARENT_EXPORT_DENIED',
        message: '无权导出该孩子的成长数据',
      });
    }

    this.assertStoreAvailable();

    const scope = `parent.growth_export.request:${childId}`;
    const requestHash = hashIdempotentInput(
      scope,
      { childId },
      { confirmChildId: childId, confirmGuardianEmail, reason },
    );

    try {
      const result = await this.idempotency.execute(scope, idempotencyKey, requestHash, async () => {
        const now = new Date();
        const expiresAt = new Date(now.getTime() + PARENT_GROWTH_EXPORT_TTL_MS);
        const exportId = `pge-${randomUUID()}`;

        const page = await this.growth.getParentPage(childId, EXPORT_QUERY);
        const document = buildParentGrowthExportDocument({
          exportId,
          childId,
          childDisplayName: page.summary.childDisplayName,
          generatedAt: now,
          expiresAt,
          summary: page.summary,
          entries: page.timeline.items,
          truncated: page.timeline.hasNext,
        });

        const record: GrowthExportRecord = {
          id: exportId,
          parentId: actor.id,
          childId,
          childDisplayName: page.summary.childDisplayName,
          status: 'ready',
          reason,
          document,
          createdAt: now,
          readyAt: now,
          expiresAt,
          downloadedAt: null,
        };
        await this.requireStore().save(record);

        // 审计只记过程事实：目的文本作为 `reason` 上下文，**不写正文**。
        await this.audit.write({
          actorId: actor.id,
          actorRole: 'parent',
          action: 'parent.growth_export.requested',
          targetType: 'parent_growth_export',
          targetId: exportId,
          idempotencyKey: `${scope}:${idempotencyKey}`,
          reason,
          detail: { childId, status: record.status, entryCount: document.entries.length },
        });

        return { status: 201, body: toJob(record) };
      });
      return result.body;
    } catch (error) {
      throwHttpForIdempotencyError(error);
      throw error;
    }
  }

  /** 下载一次导出正文；每次都重新校验授权、归属与有效期。 */
  async downloadExport(actor: CurrentUser, exportId: string): Promise<ParentGrowthExportDocument> {
    this.assertStoreAvailable();
    const store = this.requireStore();

    const record = await store.findById(exportId);
    const guardianActive =
      record !== null && record.parentId === actor.id
        ? await this.growth.canParentReadChild(actor.id, record.childId)
        : false;

    const decision = decideGrowthExportAccess({
      record,
      actorId: actor.id,
      now: new Date(),
      guardianActive,
    });

    switch (decision) {
      case 'not_found':
        // 不存在 / 属于他人：同一个 404，避免探测他人导出是否存在。
        throw new NotFoundException({
          code: 'PARENT_EXPORT_NOT_FOUND',
          message: '导出任务不存在',
        });
      case 'forbidden':
        await this.auditDenied(actor, record!.childId, record!.id, 'guardian_link_inactive');
        throw new ForbiddenException({
          code: 'PARENT_EXPORT_DENIED',
          message: '无权下载该导出',
        });
      case 'not_ready':
        throw new ConflictException({
          code: 'PARENT_EXPORT_NOT_READY',
          message: '导出尚未生成完成',
        });
      case 'expired':
        if (record!.status !== 'expired') await store.markExpired(record!.id);
        throw new GoneException({
          code: 'PARENT_EXPORT_EXPIRED',
          message: '导出已过期，请重新申请',
        });
      case 'ok':
        break;
    }

    const document = record!.document;
    if (document === null) {
      throw new ConflictException({
        code: 'PARENT_EXPORT_NOT_READY',
        message: '导出尚未生成完成',
      });
    }

    await store.markDownloaded(record!.id, new Date());
    await this.audit.write({
      actorId: actor.id,
      actorRole: 'parent',
      action: 'parent.growth_export.downloaded',
      targetType: 'parent_growth_export',
      targetId: record!.id,
      reason: record!.reason,
      detail: { childId: record!.childId, entryCount: document.entries.length },
    });

    return document;
  }

  /* ==================== 内部 ==================== */

  private assertStoreAvailable(): void {
    if (this.store === null) {
      throw new ServiceUnavailableException({
        code: 'PARENT_EXPORT_UNAVAILABLE',
        message: '成长导出暂不可用：尚未配置持久化存储',
      });
    }
  }

  private requireStore(): GrowthExportStore {
    if (this.store === null) {
      throw new ServiceUnavailableException({
        code: 'PARENT_EXPORT_UNAVAILABLE',
        message: '成长导出暂不可用：尚未配置持久化存储',
      });
    }
    return this.store;
  }

  /** 记录一次被拒绝的导出尝试（不含正文）。 */
  private async auditDenied(
    actor: CurrentUser,
    childId: string | null,
    exportId: string | null,
    reasonCode: string,
  ): Promise<void> {
    await this.audit.write({
      actorId: actor.id,
      actorRole: 'parent',
      action: 'parent.growth_export.denied',
      targetType: 'parent_growth_export',
      targetId: exportId,
      detail: { childId, reasonCode },
    });
  }
}

function toJob(record: GrowthExportRecord): ParentGrowthExportJob {
  return {
    exportId: record.id,
    childId: record.childId,
    childDisplayName: record.childDisplayName,
    status: record.status,
    createdAt: record.createdAt.toISOString(),
    expiresAt: record.expiresAt.toISOString(),
  };
}

/** 校验并归一化 `reason`：1..200 字，去除首尾空白。 */
function normaliseReason(raw: unknown): string {
  const reason = typeof raw === 'string' ? raw.trim() : '';
  if (reason.length === 0 || reason.length > PARENT_GROWTH_EXPORT_REASON_MAX_LENGTH) {
    throw new BadRequestException({
      code: 'PARENT_EXPORT_INVALID',
      message: `导出目的必填，且不超过 ${PARENT_GROWTH_EXPORT_REASON_MAX_LENGTH} 字`,
    });
  }
  return reason;
}

/**
 * 校验最小化的身份 + 对象确认。
 *
 * `confirmChildId` 必须等于路径 `childId`；`confirmGuardianEmail` 必须等于当前
 * 登录家长邮箱（大小写不敏感）。不匹配时返回同一个错误，**不说明**是哪一项不符。
 */
function normaliseConfirmation(
  actor: CurrentUser,
  childId: string,
  input: ParentGrowthExportRequest,
): string {
  const confirmChildId =
    typeof input.confirmChildId === 'string' ? input.confirmChildId.trim() : '';
  const confirmEmail =
    typeof input.confirmGuardianEmail === 'string'
      ? input.confirmGuardianEmail.trim().toLowerCase()
      : '';
  const actorEmail = actor.email.trim().toLowerCase();
  if (confirmChildId !== childId || confirmEmail !== actorEmail || actorEmail.length === 0) {
    throw new BadRequestException({
      code: 'PARENT_EXPORT_INVALID',
      message: '导出确认信息不匹配',
    });
  }
  return confirmEmail;
}
