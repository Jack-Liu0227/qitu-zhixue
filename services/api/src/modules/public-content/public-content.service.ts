import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  ConsultationReceipt,
  ConsultationRequestInput,
  PublicHomeTemplate,
  PublicHomeView,
} from '@qitu/contracts';
import { AuditWriter } from '../../common/audit/audit.service';
import {
  PublicContentStore,
  newConsultationId,
  normalizeFeaturedLimit,
} from './public-content.store';
import {
  DEFAULT_FEATURED_TEMPLATE_LIMIT,
  type PublicTemplateRecord,
} from './public-content.types';

/** 咨询线索来源标识，落 `consultation_requests.source`。 */
export const CONSULTATION_SOURCE = 'public-home';

/**
 * 公开站点内容服务。
 *
 * 定位：**未登录访客**可读的营销首页数据。两条能力：
 * 1. `getHomeView()`：聚合计数 + 平台共享已发布模板（纯读，可缓存）；
 * 2. `submitConsultation()`：咨询线索落库（写入必须幂等 + 审计）。
 *
 * 安全边界（不能靠调用方自觉，必须在本层与 store 层各挡一次）：
 * - 只出 `school_id IS NULL` 的平台模板，校属模板永不出现在公开首页；
 * - 只出聚合计数，不出现学生 / 家长 / 教师标识；
 * - 写入只落联系方式最少字段，审计 detail 不含姓名与电话。
 */
@Injectable()
export class PublicContentService {
  private readonly logger = new Logger(PublicContentService.name);

  constructor(
    private readonly store: PublicContentStore,
    private readonly audit: AuditWriter,
  ) {}

  async getHomeView(limit: number = DEFAULT_FEATURED_TEMPLATE_LIMIT): Promise<PublicHomeView> {
    const [stats, templates] = await Promise.all([
      this.store.readHomeStats(),
      this.store.listFeaturedTemplates(normalizeFeaturedLimit(limit)),
    ]);

    return {
      stats,
      templates: templates.map(toPublicTemplate),
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * 记录一条咨询线索。
   *
   * `idempotencyKey` 由控制器从请求头取出并已做过幂等执行包裹；这里再把它落到
   * `consultation_requests.idempotency_key`（唯一索引），形成数据库层的第二道保险：
   * 即使幂等表记录被清理，同键重放也不会产生第二条线索。
   */
  async submitConsultation(
    input: ConsultationRequestInput,
    idempotencyKey: string,
  ): Promise<ConsultationReceipt> {
    const record = await this.store.createConsultation({
      id: newConsultationId(),
      name: input.name,
      phone: input.phone,
      identity: input.identity,
      message: input.message ?? null,
      idempotencyKey,
      source: CONSULTATION_SOURCE,
      now: new Date(),
    });

    // 审计：记录「谁在什么入口提交了哪类线索」，**不记录**姓名与电话。
    await this.audit.write({
      actorId: null,
      actorRole: null,
      action: 'public.consultation.submit',
      targetType: 'consultation_request',
      targetId: record.id,
      idempotencyKey: `public.consultation.submit:${idempotencyKey}`,
      detail: {
        identity: record.identity,
        source: record.source ?? CONSULTATION_SOURCE,
        hasMessage: (record.message ?? null) !== null,
        messageLength: (record.message ?? '').length,
      },
    });

    this.logger.log(`收到咨询线索 id=${record.id} identity=${record.identity}`);

    return {
      id: record.id,
      status: 'received',
      createdAt: record.createdAt.toISOString(),
    };
  }
}

/** store 记录 → 公开投影：只做格式化，不再二次筛选（筛选属于 store 的职责）。 */
export function toPublicTemplate(record: PublicTemplateRecord): PublicHomeTemplate {
  return {
    id: record.id,
    slug: record.slug,
    title: record.title,
    summary: record.summary,
    domain: record.domain,
    ageRange: record.ageRange,
    difficulty: record.difficulty,
    estimatedDurationMinutes: record.estimatedDurationMinutes,
    outcomeForm: record.outcomeForm,
    learningObjectives: [...record.learningObjectives],
    stages: record.stages.map((stage) => ({ id: stage.id, label: stage.label })),
    version: record.version,
    publishedAt: record.publishedAt === null ? null : record.publishedAt.toISOString(),
    participants: record.participants,
  };
}
