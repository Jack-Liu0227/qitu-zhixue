import type { ParentFeedbackSource } from '@qitu/contracts';

/**
 * 家长反馈模块的纯类型。
 *
 * 该模块只依赖 `@qitu/contracts`，不引入 React / 网络层，
 * 便于被右下角浮窗、消息页、首页三处复用，也便于单独做单元测试。
 */

/** 反馈类型（界面上的「反馈类型」下拉）。与契约的 `source` 不是一一对应，见 `feedbackSourceFor`。 */
export type FeedbackType = 'teacher' | 'project' | 'suggestion';

export interface FeedbackTypeOption {
  value: FeedbackType;
  label: string;
  description: string;
  /** 该类型提交时映射到的服务端来源枚举。 */
  source: ParentFeedbackSource;
}

/**
 * 一条反馈草稿。
 *
 * 草稿会以 `sessionStorage` 暂存在本机：
 *  - 网络失败后重开浮窗能恢复用户已经写好的内容；
 *  - `idempotencyKey` 随草稿一起保存，**重试时复用同一个键**，
 *    避免「后端其实已经收下、只是响应丢了」时开出第二张工单；
 *  - 用 `sessionStorage` 而不是 `localStorage`，是为了让未成年人相关
 *    内容不长期驻留、关闭标签页即失效。
 */
export interface FeedbackDraft {
  type: FeedbackType;
  content: string;
  /** 反馈针对的孩子；未选择时为空串（提交前必须补齐）。 */
  childId: string;
  /** 可选关联项目；不关联时为 null。 */
  projectId: string | null;
  /** 同一次草稿共用的幂等键。 */
  idempotencyKey: string;
}

/** 反馈提交失败的分类，用于驱动不同的界面提示与「是否保留草稿」。 */
export type FeedbackFailureKind = 'offline' | 'permission' | 'validation' | 'error';
