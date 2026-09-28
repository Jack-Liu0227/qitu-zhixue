import type { ParentGrowthExportDocument, ParentGrowthExportStatus } from '@qitu/contracts';

/**
 * 一条成长导出任务的持久化记录（store 与 service 之间的稳定契约）。
 *
 * `document` 只可能是**服务端白名单投影**（见 `growth-export.projection.ts`），
 * 不含原始 AI 对话 / 语音 / 风险标签 / 邮箱 / 模型推断。
 */
export interface GrowthExportRecord {
  id: string;
  parentId: string;
  childId: string;
  childDisplayName: string;
  status: ParentGrowthExportStatus;
  /** 家长声明的导出目的；审计记录它，但不写入导出正文。 */
  reason: string;
  /** 脱敏导出正文；`pending` 时为 null。 */
  document: ParentGrowthExportDocument | null;
  createdAt: Date;
  readyAt: Date | null;
  expiresAt: Date;
  downloadedAt: Date | null;
}

/**
 * 导出任务存储的抽象接口，作为 Nest DI 的稳定注入令牌。
 *
 * 与 `AuditWriter` / `IdempotencyStore` 一致：没有任何生产用内存实现。
 * 未配置持久化时 `ParentGrowthExportService` 诚实返回 503，而不是假装成功。
 * 未来接入对象存储（大文件下载）时，替换一个实现即可，service 与契约不动。
 */
export abstract class GrowthExportStore {
  abstract save(record: GrowthExportRecord): Promise<void>;
  abstract findById(id: string): Promise<GrowthExportRecord | null>;
  abstract markExpired(id: string): Promise<void>;
  abstract markDownloaded(id: string, at: Date): Promise<void>;
}

/** 访问判定结果（纯函数输出，便于单测覆盖全部状态）。 */
export type GrowthExportAccessDecision =
  | 'ok'
  | 'not_found'
  | 'forbidden'
  | 'not_ready'
  | 'expired';

export interface GrowthExportAccessInput {
  /** 命中的记录；查不到时为 null。 */
  record: GrowthExportRecord | null;
  /** 当前访问者（只可能读到自己名下的任务）。 */
  actorId: string;
  now: Date;
  /** 下载时重新校验的 active 监护关系结果。 */
  guardianActive: boolean;
}
