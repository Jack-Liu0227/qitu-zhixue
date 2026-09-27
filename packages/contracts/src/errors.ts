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
  /** 写操作缺少 `Idempotency-Key` 请求头（400）。 */
  | 'IDEMPOTENCY_KEY_REQUIRED'
  /**
   * 班主任访问了不属于自己的学生（403）。
   *
   * 服务端在授权失败时**不得**返回该学生的任何字段——只给这个码，
   * 否则 403 本身就变成了信息泄露。
   */
  | 'STUDENT_NOT_ASSIGNED';

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
 * RFC 9457-style problem details. `details` carries code-specific context,
 * e.g. `WorkbenchConflictDetails` for `WORKBENCH_OPTIMISTIC_LOCK_CONFLICT`.
 */
export interface ProblemDetails<TDetails = unknown> {
  code: ApiErrorCode;
  message: string;
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
