import type { ConsultationIdentity, PublicHomeStage } from '@qitu/contracts';

/** 首页聚合统计的持久化形状（服务层不做二次聚合，直接投影）。 */
export interface PublicHomeStatsRecord {
  learners: number;
  schools: number;
  publishedTemplates: number;
  publishedWorks: number;
}

/**
 * 展厅卡片持久化形状。
 *
 * `publishedAt` 保持 `Date`，只在视图投影时转 ISO 字符串，避免 store 层
 * 承担格式化职责。
 */
export interface PublicTemplateRecord {
  id: string;
  slug: string;
  title: string;
  summary: string;
  domain: string | null;
  ageRange: string | null;
  difficulty: string | null;
  estimatedDurationMinutes: number | null;
  outcomeForm: string | null;
  learningObjectives: string[];
  stages: PublicHomeStage[];
  version: string | null;
  publishedAt: Date | null;
  participants: number;
}

/** 咨询线索持久化形状。 */
export interface ConsultationRecord {
  id: string;
  name: string;
  phone: string;
  identity: ConsultationIdentity;
  message: string | null;
  status: string;
  source: string;
  idempotencyKey: string;
  createdAt: Date;
  updatedAt: Date;
}

/** 新建咨询线索的入参；`id` / `now` 由服务层生成，store 不读时钟。 */
export interface CreateConsultationRecordInput {
  id: string;
  name: string;
  phone: string;
  identity: ConsultationIdentity;
  message: string | null;
  idempotencyKey: string;
  source: string;
  now: Date;
}

/** 首页默认展厅卡片数量：与设计稿三列卡片一致（桌面 3 列 × 1 行 + 移动滚动）。 */
export const DEFAULT_FEATURED_TEMPLATE_LIMIT = 6;

/** 服务端硬上限：即使调用方传入更大的 limit，也不会一次下发更多模板。 */
export const MAX_FEATURED_TEMPLATE_LIMIT = 12;
