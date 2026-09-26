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
  /** 操作过于频繁（429）。 */
  | 'RATE_LIMITED';

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
