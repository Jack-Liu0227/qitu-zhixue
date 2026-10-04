import type { ProjectSummary } from './project';

/**
 * 探索来源：推荐项目 / 自由探索。
 *
 * 推荐项目与自由探索都经过 Projects owner 管理的确认链；来源类型原样保留。
 * 推荐项目确认后引用冻结的模板版本，自由探索确认后先生成方向卡再创建实例。
 * 服务端在创建项目时写入该字段，客户端不可写、不可改。
 */
export type ExplorationSource = 'recommended' | 'free';

/**
 * 探索会话的服务端状态。只由后端状态机迁移，客户端请求体里没有 `status`。
 *
 * - `exploring`：学生正在表达 / AI 正在澄清，尚未形成可确认的候选意图。
 * - `awaiting_confirmation`：候选意图已就绪，等待学生**明确确认**。
 * - `confirmed`：学生已明确确认（`IntentDraft.confirmedAt` 由服务端写入）。
 *   只有这个状态才允许创建正式项目实例。
 * - `closed`：学生放弃 / 跳过本次探索；不创建任何项目。
 */
export type ExplorationStatus = 'exploring' | 'awaiting_confirmation' | 'confirmed' | 'closed';

/**
 * 「正在形成的方向」右栏投影。
 *
 * `confirmedAt` 是**唯一**的确认凭据，由服务端在
 * `POST /api/v1/explorations/:id/confirm-intent` 时写入；客户端无法通过
 * 任何字段伪造确认。`coreInterests` 属于探索期推导，不得直接覆盖长期兴趣档案。
 */
export interface IntentDraft {
  id: string;
  explorationId: string;
  /** 目标用户（为谁而做）。 */
  goalUser: string | null;
  /** 核心兴趣标签（探索期推导，非长期档案）。 */
  coreInterests: string[];
  /** 偏好形式。 */
  preferredForm: string | null;
  /** 目标受益对象。 */
  targetBeneficiary: string | null;
  /** 服务端写入的确认时间；`null` 表示尚未确认。 */
  confirmedAt: string | null;
  updatedAt: string;
}

/** 探索会话的对外投影。 */
export interface ExplorationView {
  id: string;
  source: ExplorationSource;
  /** 推荐项目冻结引用的模板版本；自由探索为 `null`。 */
  templateVersionId: string | null;
  status: ExplorationStatus;
  intentDraft: IntentDraft | null;
  /** 确认后创建的项目实例 id；未确认或已关闭时恒为 `null`。 */
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * 创建探索会话。
 *
 * `source=recommended` 时 `templateVersionId` 必填；`source=free` 时必须为空。
 */
export interface CreateExplorationRequest {
  source: ExplorationSource;
  templateVersionId?: string | null;
}

/**
 * 更新候选意图草稿。
 *
 * 只包含可被学生 / AI 澄清的字段。`confirmedAt` / `status` 不在其中——
 * 它们由服务端状态机独占。当草稿首次变得可确认时，服务端会把状态从
 * `exploring` 推进到 `awaiting_confirmation`。
 */
export interface UpdateIntentDraftRequest {
  goalUser?: string | null;
  coreInterests?: string[];
  preferredForm?: string | null;
  targetBeneficiary?: string | null;
}

/**
 * 确认意图。
 *
 * 请求体故意为空壳：确认这一动作本身不携带任何可写状态，服务端只依据
 * 已存在的候选意图与学生身份完成迁移。`note` 仅作审计备注。
 */
export interface ConfirmIntentRequest {
  note?: string | null;
}

/**
 * 确认结果。
 *
 * `replayed=true` 表示同一幂等键的重复请求命中了已存在的项目实例，
 * **没有**产生第二条项目。`project` 是服务端计算的项目摘要。
 */
export interface ConfirmIntentResponse {
  exploration: ExplorationView;
  project: ProjectSummary;
  replayed: boolean;
}

/** 关闭探索；已确认（`confirmed`）的探索不允许关闭。 */
export interface CloseExplorationRequest {
  reason?: string | null;
}
