import type { TutorModalityMode } from './tutor';

/**
 * Stable, string-literal error-code union shared across all student-center
 * APIs. Additive only.
 */
export type ApiErrorCode =
  /** Practice stage gate: `TheoryMastered` must be reached first. */
  | 'THEORY_MASTERED_REQUIRED'
  /** Workbench optimistic-lock conflict; see `WorkbenchConflictDetails`. */
  | 'WORKBENCH_OPTIMISTIC_LOCK_CONFLICT'
  /** Duplicate idempotency-key submission (409 replay/conflict). */
  | 'IDEMPOTENCY_CONFLICT'
  /** AI safety check blocked the reply; accompanies the `safety.block` event. */
  | 'AI_SAFETY_BLOCK'
  /** Client attempted to write a server-owned growth record (403). */
  | 'GROWTH_RECORD_WRITE_DENIED'
  /** Client attempted to write server-owned project state (403/405). */
  | 'PROJECT_STATE_WRITE_DENIED'
  /** 未登录或会话已失效（401）。 */
  | 'UNAUTHENTICATED'
  /** 账号或口令不正确（401）。 */
  | 'INVALID_CREDENTIALS'
  /** 学生选择的输入／输出组合当前模型能力不支持（409）。详见 `ModalityUnavailableDetails`。 */
  | 'MODALITY_UNAVAILABLE'
  /** 操作过于频繁（429）。 */
  | 'RATE_LIMITED'
  /** 家长「给孩子一句鼓励」内容不合法（400）：空、超长或只含空白。 */
  | 'ENCOURAGEMENT_INVALID'
  /** 家长反馈内容不合法（400）。 */
  | 'FEEDBACK_INVALID'
  /** 家长的消息确认 / 暂不提醒动作对该消息不适用（409）。 */
  | 'MESSAGE_ACTION_NOT_APPLICABLE'
  /** 关系绑定：目标人不存在或角色不符（404/400）。 */
  | 'DIRECTORY_USER_NOT_FOUND'
  /** 关系的两端角色不合法，例如把 admin 绑成学生的监护人（400）。 */
  | 'RELATIONSHIP_ROLE_INVALID'
  /** 不允许把自己绑成自己的监护人或班主任（400）。 */
  | 'SELF_RELATIONSHIP_INVALID'
  /** 关系不存在（404）。 */
  | 'RELATIONSHIP_NOT_FOUND'
  /** 该监护关系已处于 active，不允许重复绑定（409）。 */
  | 'GUARDIAN_LINK_ALREADY_ACTIVE'
  /** 该监护关系已结束，不能再修改（409）。 */
  | 'GUARDIAN_LINK_ENDED'
  /**
   * 该学生已有当前班主任（409）。
   *
   * 对应数据库 `mentor_assignments_one_active_per_student_idx`。
   * 正确处理方式是调用「换班主任」接口（在事务里先结束旧分配），
   * 而不是在这里重试或忽略错误。
   */
  | 'MENTOR_ALREADY_ASSIGNED'
  /** 初始化操作需要由部署 / CLI 执行，不能通过 HTTP 触发（409）。 */
  | 'INITIALIZATION_OPERATOR_REQUIRED'
  /** 初始化目标不存在（400）。 */
  | 'INITIALIZATION_AREA_INVALID'
  /** 初始化依赖持久化数据库不可用（503）。 */
  | 'INITIALIZATION_DATABASE_UNAVAILABLE'
  /** 初始化执行失败；相同幂等键可重试（503）。 */
  | 'INITIALIZATION_EXECUTION_FAILED'
  /** 写操作缺少 `Idempotency-Key` 请求头（400）。 */
  | 'IDEMPOTENCY_KEY_REQUIRED'
  /**
   * 班主任访问了不属于自己的学生（403）。
   *
   * 服务端在授权失败时**不得**返回该学生的任何字段——只给这个码，
   * 否则 403 本身就变成了信息泄露。
   */
  | 'STUDENT_NOT_ASSIGNED'
  /**
   * 反馈工单不存在，或对当前账号不可见（404）。
   *
   * 两者共用同一个码：家长访问别的孩子的工单时也返回它，避免通过
   * 「404 / 403」的差异探测工单是否存在。
   */
  | 'FEEDBACK_NOT_FOUND'
  /** 当前工单状态不允许该迁移，例如已解决的工单不能直接回复（409）。 */
  | 'FEEDBACK_TRANSITION_INVALID'
  /**
   * 附件不存在、不属于当前账号，或未被上传服务确认（400）。
   *
   * 三种原因共用同一个码与同一条消息，不区分原因，避免泄露他人附件是否存在。
   */
  | 'FEEDBACK_ATTACHMENT_INVALID'
  /** 家长成长导出请求非法（400）：确认字段不匹配或目的为空 / 超长。 */
  | 'PARENT_EXPORT_INVALID'
  /**
   * 当前账号不是导出目标孩子的**有效**监护人（403）。
   *
   * 请求与下载两处都会重新校验 active 监护关系；授权被撤销后返回该码，
   * **不得**返回空数据或默认放行。
   */
  | 'PARENT_EXPORT_DENIED'
  /**
   * 导出任务不存在，或对当前账号不可见（404）。
   *
   * 两者共用同一个码：家长访问别的家长的导出任务时也返回它，避免通过
   * 「404 / 403」的差异探测他人导出是否存在。
   */
  | 'PARENT_EXPORT_NOT_FOUND'
  /** 导出正文尚未生成，暂不可下载（409）。 */
  | 'PARENT_EXPORT_NOT_READY'
  /** 导出已超出有效期，不再可下载（410）。 */
  | 'PARENT_EXPORT_EXPIRED'
  /**
   * 导出所需的持久化 / 存储能力不可用（503）。
   *
   * 未配置 `DATABASE_URL`（无法落库任务元数据）或对象存储未接入时返回该码，
   * **绝不**退回内存假装成功。
   */
  | 'PARENT_EXPORT_UNAVAILABLE'
  /** 探索会话不存在，或对当前学生不可见（404）。 */
  | 'EXPLORATION_NOT_FOUND'
  /** 当前探索状态不允许该迁移（409）。 */
  | 'EXPLORATION_TRANSITION_INVALID'
  /** 候选意图尚未形成、不足以确认（409）。 */
  | 'INTENT_DRAFT_INCOMPLETE'
  /** 提醒不存在，或对当前学生不可见（404）。 */
  | 'REMINDER_NOT_FOUND'
  /** 提醒已过期，当前动作不适用（409）。 */
  | 'REMINDER_ACTION_NOT_APPLICABLE'
  /** 提醒偏好请求非法（400）。 */
  | 'REMINDER_PREFERENCE_INVALID'
  /** 提醒所需的持久化 / 评审能力不可用（503）。 */
  | 'REMINDER_UNAVAILABLE'
  /** 基础偏好写入非法（400）：值不在允许集合内。 */
  | 'PREFERENCE_INVALID'
  /** 偏好持久化能力不可用（503）。 */
  | 'PREFERENCE_UNAVAILABLE';

/**
 * `MODALITY_UNAVAILABLE` 的详情。
 *
 * 告知前端**现在能用什么**，而不是只丢一句「不支持」让学生自己试。
 * 这是「学生可选双模态」能成立的前提：选项要按真实能力置灰，
 * 而不是让语音按钮看上去可点、点下去报错。
 */
export interface ModalityUnavailableDetails {
  requested: TutorModalityMode;
  available: TutorModalityMode[];
}

/**
 * 字段级校验错误（`ProblemDetails.errors` 的条目）。
 */
export interface ProblemFieldError {
  path?: string;
  message: string;
}

/**
 * `ProblemDetails.code` 的类型。
 *
 * 以 `ApiErrorCode` 提供字面量补全，同时允许任意字符串（兜底码、尚未
 * 纳入联合的新码）。注意 `ApiErrorCode | string` 会被 TS 直接简化成
 * `string` 而丢掉补全，因此用 `(string & {})` 保留提示。
 */
export type ProblemCode = ApiErrorCode | (string & {});

/**
 * RFC 9457 problem details —— **全局唯一的 HTTP 错误响应契约**。
 *
 * 历史形态只有 `{ code, message, details? }`：既缺 RFC 9457 的 canonical
 * 成员，又因为 Nest 默认过滤器会原样透传响应体，导致
 * `{ statusCode, message, error }` 与它并存 —— 同一个 API 的错误形状
 * 取决于「抛的人怎么写」（Issue #23）。现在服务端只发这一种形态：
 *
 * - canonical：`type` / `title` / `status` / `detail` / `instance`；
 * - `code`：机器可读的稳定错误码，优先取 `ApiErrorCode`；
 * - `message`：`detail` 的兼容别名。**不要删**——
 *   `apps/admin-console/lib/api/settings.ts` 等既有调用方读的是它；
 * - `details`：码专属上下文，例如 `WorkbenchConflictDetails`；
 * - `traceId`：与后端日志对齐，用户在报障时可以直接引用。
 *
 * 响应头为 `Content-Type: application/problem+json`。服务端实现见
 * `services/api/src/common/http/problem-details.ts`。
 */
export interface ProblemDetails<TDetails = unknown> {
  /** RFC 9457 `type`：当前统一为 `about:blank`，机器可读语义放在 `code`。 */
  type: string;
  /** RFC 9457 `title`：HTTP 状态短语。 */
  title: string;
  /** RFC 9457 `status`：HTTP 状态码。 */
  status: number;
  /** RFC 9457 `detail`：给人看的一句话。 */
  detail: string;
  /** RFC 9457 `instance`：出错的具体路径（不含 query）。 */
  instance?: string;
  /** 稳定错误码。 */
  code: ProblemCode;
  /** 兼容别名，值恒等于 `detail`。 */
  message: string;
  /** 请求追踪 id，同时回写 `x-request-id` 响应头。 */
  traceId?: string;
  /** 字段级校验错误。 */
  errors?: ProblemFieldError[];
  /** 码专属上下文，例如 `WorkbenchConflictDetails`。 */
  details?: TDetails;
}

/**
 * Details returned with `WORKBENCH_OPTIMISTIC_LOCK_CONFLICT`: the server's
 * current revision and content, so the client can reconcile or refresh.
 */
export interface WorkbenchConflictDetails {
  currentRevision: number;
  content: unknown;
}
