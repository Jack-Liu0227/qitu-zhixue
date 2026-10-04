/**
 * 学习进度停滞提醒（ISSUE-T2 / #6）——**安全管线段**。
 *
 * 背景与边界（务必先读 `docs/shared/ISSUES.md` 的 ISSUE-T2 与 AGENTS.md）：
 * - T2 仍处于 `Proposed`，上线前必须通过产品 / 隐私评审（风险 `R-T2`）。
 *   本契约只定义**服务端权威的提醒投影**，不包含任何情绪、心情、诊断、
 *   风险标签、挫败推断或躯体分类字段——这些一律禁止进入本模块。
 * - 触发源**只有一个且是服务端已存在的学习进度停滞信号**
 *   （`learning_progress_stall`，源自 AI 搭档已有的连续卡顿计数）。
 *   客户端**不能**提交模板 id、触发源、触发原因或触发条件，请求体里也没有
 *   这些字段。
 * - 文案由服务端白名单模板生成并通过非医疗断言；客户端只读渲染。
 * - 学生可以关闭该类提醒（opt-out），关闭后不再默认投递。
 *
 * 五态兼容：读接口在 UI 侧需要能落到 loading / empty / error / offline /
 * permission-denied 五种状态；`ReminderInboxUiState` 是共享的状态字面量，
 * 服务端保证 empty（空数组）与 permission-denied（统一 403）可表达，
 * loading / error / offline 由客户端据网络与错误码推导。
 */

/**
 * 提醒触发源白名单。
 *
 * 目前**只有**一个取值：服务端 AI 搭档的连续学习进度停滞信号。
 * 这是一个封闭联合；新增任何触发源都必须先通过产品 / 隐私评审并更新本文档，
 * 不得由客户端指定。
 */
export type ReminderTriggerSource = 'learning_progress_stall';

/**
 * 服务端允许的提醒模板 id 白名单。
 *
 * 模板正文由服务端独占，客户端拿到的只有服务端渲染好的 `ReminderView`，
 * 无法提交、替换或自定义模板。
 */
export type ReminderTemplateId =
  | 'learning_stall_take_break'
  | 'learning_stall_ask_for_help';

/** 提醒类别：仅描述「休息 / 求助」这类非医疗的温和建议。 */
export type ReminderCategory = 'rest_suggestion' | 'help_suggestion';

/**
 * 服务端渲染后的提醒投影。
 *
 * 只包含面向学生的一句话标题与正文，**不含**：原始对话、语音、模板内部字段、
 * 风险 / 情绪 / 诊断标签、模型推断或任何可反推未成年人身心状态的字段。
 */
export interface ReminderView {
  reminderId: string;
  /** 服务端白名单模板 id；只读，客户端不可写。 */
  templateId: ReminderTemplateId;
  /** 非医疗类别；只读。 */
  category: ReminderCategory;
  /** 触发来源；只读，用于解释「为什么会出现这条提醒」。 */
  source: ReminderTriggerSource;
  /** 面向学生的短标题。 */
  title: string;
  /** 面向学生的温和正文（非诊断、非医疗、不贴标签）。 */
  body: string;
  createdAt: string;
  /** 过期时间；过期后不再投递。 */
  expiresAt: string;
}

/** `GET /api/v1/reminders` 响应。 */
export interface GetStudentRemindersResponse {
  reminders: ReminderView[];
  /**
   * 服务端评审门禁状态。
   *
   * T2 未通过产品 / 隐私评审、或该学生已选择关闭时，服务端返回
   * `deliveryEnabled=false` **且不返回任何提醒内容**（fail-closed）。
   * 客户端据此渲染 empty / 说明态，而不是自行缓存或伪造提醒。
   */
  deliveryEnabled: boolean;
  /** 当前学生是否已关闭该类提醒（opt-out）。 */
  optedOut: boolean;
}

/** `POST /api/v1/reminders/:id/dismiss` 响应。 */
export interface DismissReminderResponse {
  reminderId: string;
  dismissedAt: string;
}

/** 学生对「学习进展提醒」的偏好。 */
export interface ReminderPreferenceView {
  /** `true` 表示学生已选择不再接收该类提醒。 */
  optedOut: boolean;
  updatedAt: string;
}

/**
 * 更新提醒偏好（关闭 / 重新打开）。
 *
 * 请求体只有 `optedOut` 一个布尔字段：客户端无法提交模板、触发源或原因。
 */
export interface SetReminderPreferenceRequest {
  optedOut: boolean;
}

export interface SetReminderPreferenceResponse extends ReminderPreferenceView {}

/**
 * 提醒收件箱在 UI 层的状态（与 `packages/ui` 的五态约定一致）。
 *
 * - `loading`：正在读取；
 * - `empty`：读取成功但无提醒（含评审门禁关闭、已 opt-out）；
 * - `ready`：有可投递提醒；
 * - `error`：服务端 5xx / 解析失败；
 * - `offline`：断网（`fetch` 抛出 / status 0）；
 * - `permission-denied`：401 / 403。
 */
export type ReminderInboxUiState =
  | 'loading'
  | 'empty'
  | 'ready'
  | 'error'
  | 'offline'
  | 'permission-denied';
