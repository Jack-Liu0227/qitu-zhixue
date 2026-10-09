import { randomBytes } from 'node:crypto';
import type { ConsultationIdentity } from '@qitu/contracts';
import {
  DEFAULT_FEATURED_TEMPLATE_LIMIT,
  MAX_FEATURED_TEMPLATE_LIMIT,
  type ConsultationRecord,
  type CreateConsultationRecordInput,
  type PublicHomeStatsRecord,
  type PublicTemplateRecord,
} from './public-content.types';

/**
 * 咨询线索写入冲突：`idempotency_key` 已存在但载荷不同。
 *
 * 幂等层（`IdempotencyStore`）通常已经拦下这种情况；这里是数据库唯一索引的
 * 兜底语义——两边都判定为「同一把钥匙，不同内容」，由控制器映射成 409。
 */
export class PublicContentStoreConflictError extends Error {
  constructor(message = 'consultation idempotency conflict') {
    super(message);
    this.name = 'PublicContentStoreConflictError';
  }
}

/**
 * 公开内容读写归属。
 *
 * 一个 store 同时拥有「首页读投影」与「咨询线索写入」两个能力，是因为两者在
 * 领域上同属 `public-content`：**表归属必须唯一**（见 `docs/admin/database.md` §3），
 * 不允许别处再直接写 `consultation_requests`。
 */
export abstract class PublicContentStore {
  /** 首页聚合计数。空库返回全 0，不抛错——0 是有效事实。 */
  abstract readHomeStats(): Promise<PublicHomeStatsRecord>;

  /**
   * 平台共享（`school_id IS NULL`）且已发布的模板，按最近更新排序。
   *
   * 只出平台模板：校属模板属于校区资产，不能在公开首页出现。
   */
  abstract listFeaturedTemplates(limit: number): Promise<PublicTemplateRecord[]>;

  abstract createConsultation(input: CreateConsultationRecordInput): Promise<ConsultationRecord>;

  /** 按幂等键回读，用于「同键重放」返回首次结果。 */
  abstract findConsultationByIdempotencyKey(key: string): Promise<ConsultationRecord | null>;
}

/** 归一化 limit：非有限值回落到默认值，并夹在硬上限内。 */
export function normalizeFeaturedLimit(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_FEATURED_TEMPLATE_LIMIT;
  }
  const floored = Math.floor(limit);
  if (floored < 1) {
    return DEFAULT_FEATURED_TEMPLATE_LIMIT;
  }
  return Math.min(floored, MAX_FEATURED_TEMPLATE_LIMIT);
}

export function newConsultationId(): string {
  return `consultation-${randomBytes(8).toString('hex')}`;
}

/**
 * 内存实现：`demo` / `test` 数据模式与单测使用。
 *
 * 语义与 Postgres 实现保持可观察的一致：
 * - 同键重复写入不产生第二行（返回首次结果）；
 * - 同键不同载荷抛 `PublicContentStoreConflictError`；
 * - 计数只统计「已发布 + 平台共享」，不把草稿算进首页数字。
 */
export class InMemoryPublicContentStore extends PublicContentStore {
  private readonly templates = new Map<string, PublicTemplateRecord>();
  private readonly consultations = new Map<string, ConsultationRecord>();
  private readonly byIdempotencyKey = new Map<string, string>();
  private readonly counts: PublicHomeStatsRecord;

  constructor(options: {
    templates?: PublicTemplateRecord[];
    /** 内存模式没有用户 / 学校表，计数由调用方显式给出，默认 0。 */
    counts?: Partial<PublicHomeStatsRecord>;
  } = {}) {
    super();
    for (const template of options.templates ?? []) {
      this.templates.set(template.id, template);
    }
    this.counts = {
      learners: options.counts?.learners ?? 0,
      schools: options.counts?.schools ?? 0,
      publishedTemplates: options.counts?.publishedTemplates ?? this.templates.size,
      publishedWorks: options.counts?.publishedWorks ?? 0,
    };
  }

  async readHomeStats(): Promise<PublicHomeStatsRecord> {
    return { ...this.counts };
  }

  async listFeaturedTemplates(limit: number): Promise<PublicTemplateRecord[]> {
    const all = [...this.templates.values()].sort((left, right) => {
      const leftAt = left.publishedAt?.getTime() ?? 0;
      const rightAt = right.publishedAt?.getTime() ?? 0;
      return rightAt - leftAt;
    });
    return all.slice(0, normalizeFeaturedLimit(limit)).map(cloneTemplate);
  }

  async createConsultation(input: CreateConsultationRecordInput): Promise<ConsultationRecord> {
    const existingId = this.byIdempotencyKey.get(input.idempotencyKey);
    if (existingId !== undefined) {
      const existing = this.consultations.get(existingId);
      if (existing === undefined) {
        throw new PublicContentStoreConflictError();
      }
      if (!sameConsultationPayload(existing, input)) {
        throw new PublicContentStoreConflictError();
      }
      return { ...existing };
    }
    const record: ConsultationRecord = {
      id: input.id,
      name: input.name,
      phone: input.phone,
      identity: input.identity,
      message: input.message,
      status: 'received',
      source: input.source,
      idempotencyKey: input.idempotencyKey,
      createdAt: input.now,
      updatedAt: input.now,
    };
    this.consultations.set(record.id, record);
    this.byIdempotencyKey.set(input.idempotencyKey, record.id);
    return { ...record };
  }

  async findConsultationByIdempotencyKey(key: string): Promise<ConsultationRecord | null> {
    const id = this.byIdempotencyKey.get(key);
    if (id === undefined) {
      return null;
    }
    const record = this.consultations.get(id);
    return record === undefined ? null : { ...record };
  }

  /** 测试辅助：读取当前落库条数，用于断言「重复提交只落一行」。 */
  get consultationCount(): number {
    return this.consultations.size;
  }
}

function cloneTemplate(template: PublicTemplateRecord): PublicTemplateRecord {
  return {
    ...template,
    learningObjectives: [...template.learningObjectives],
    stages: template.stages.map((stage) => ({ ...stage })),
    publishedAt: template.publishedAt === null ? null : new Date(template.publishedAt),
  };
}

function sameConsultationPayload(
  existing: ConsultationRecord,
  input: CreateConsultationRecordInput,
): boolean {
  return (
    existing.name === input.name &&
    existing.phone === input.phone &&
    existing.identity === input.identity &&
    (existing.message ?? null) === (input.message ?? null)
  );
}

/** 供内存 store 种子数据与单测复用：给定身份与姓名的最小线索输入。 */
export function consultationInput(
  identity: ConsultationIdentity,
  overrides: Partial<CreateConsultationRecordInput> = {},
): CreateConsultationRecordInput {
  const now = overrides.now ?? new Date('2026-02-01T00:00:00.000Z');
  return {
    id: overrides.id ?? newConsultationId(),
    name: overrides.name ?? '张同学',
    phone: overrides.phone ?? '13800000000',
    identity,
    message: overrides.message ?? null,
    idempotencyKey: overrides.idempotencyKey ?? `key-${randomBytes(4).toString('hex')}`,
    source: overrides.source ?? 'public-home',
    now,
  };
}
