/**
 * 宏观调谐（计划调整）与卡点信号契约（api-spec F4 / pedagogy-spec §7）。
 *
 * 三件事划清边界：
 *
 * 1. `ProjectPlanAdjustment` —— 服务端拥有的计划调整记录。乐观锁基于
 *    `plan_outline.revision`（`baseRevision` 必须等于当前 revision，
 *    apply 时 `nextRevision = baseRevision + 1`）。
 * 2. `StudentStuckSignal` —— 事务内 outbox 的领域事件，节点级幂等。
 * 3. `DesensitizedStuckSummary` —— 写给审计 / 班主任的脱敏摘要。
 *
 * **Append-only 不变量**：`append_optional_remediation` 只允许**追加**一个
 * `isRemedial` 节点。永远不得删除或削弱模板必需目标（template-required
 * objectives）、不得改写 `prerequisiteIds`、不得跳过或放宽阶段门禁。
 * 违约由服务端 `assertOutlineMutable` 拒绝，映射为 `ADJUSTMENT_INVALID`(400)。
 *
 * **脱敏红线**：`StudentStuckSignal` / `DesensitizedStuckSummary` 里
 * **没有也不允许**任何学生原文：不含对话正文、作答文本、`correctKeys`、
 * `explanation`、`expectedAnswer`。只允许稳定错误码、不透明节点引用与证据
 * 引用。CI 反序列化扫描（F4.6）断言这一点。
 */

/**
 * 补救节点最大嵌套深度（熔断器）。
 *
 * 同一 stem node 已有 `applied` 的补救节点时，第二次卡点**不再**追加，
 * 而是降级为 `recommend_teacher_support` + HIGH 优先级摘要
 * （`ADJUSTMENT_DEPTH_CIRCUIT_BROKEN` 409）。
 */
export const MAX_REMEDIAL_DEPTH = 1;

/** 乐观锁自动 rebase 的最大重试次数；超出 → `ADJUSTMENT_REBASE_EXHAUSTED`(409)。 */
export const MAX_AUTO_REBASE_ATTEMPTS = 3;

/** 计划调整触发源。 */
export type PlanAdjustmentTrigger =
  | 'repeated_assessment_error'
  | 'explicit_stuck'
  | 'teacher_request';

/**
 * 允许的调整动作。
 *
 * - `append_optional_remediation`：唯一允许的追加动作（`isRemedial` 节点）。
 * - `recommend_teacher_support`：不改计划结构，只发脱敏摘要 / 告警。
 */
export type PlanAdjustmentAction =
  | 'append_optional_remediation'
  | 'recommend_teacher_support';

/** 调整记录状态。服务端自动推进 `proposed → accepted → applied`，或 `rejected`。 */
export type PlanAdjustmentStatus = 'proposed' | 'accepted' | 'rejected' | 'applied';

/**
 * 卡点错误类型编码。
 *
 * 前六个是稳定闭集；同时保留 `(string & {})` 以便模板注册自己的错误编码
 * （例如 `tir.direction`），与 `GateConditionId` 的放宽方式一致。
 */
export type StuckErrorTypeCode =
  | 'structural'
  | 'deviation'
  | 'application'
  | 'metacognitive'
  | 'repeated_wrong'
  | 'turn_cap'
  | (string & {});

/**
 * 节点级触发键（幂等键格式，pedagogy-spec §7）。
 *
 * 每个触发键只产生**一个**补救节点 / 信号；重放命中同一键直接复用。
 * 与判分端点的 `idempotencyKey`（重放不重复计分）是两层，互不替代。
 *
 * - `misconception:${studentId}:${conceptId}:${errorTypeCode}:3` —— 同 concept 连续 3 次迷思错误
 * - `guidance_cap:${sessionId}:${quizId}` —— 单题引导 turn ≥ 6
 * - `l3_cap:${sessionId}:${quizId}` —— L3 封顶仍未突破
 * - `explicit_help:${sessionId}:${turnId}` —— 学生显式求助
 */
export type StudentStuckTriggerKey =
  | `misconception:${string}:${string}:${string}:3`
  | `guidance_cap:${string}:${string}`
  | `l3_cap:${string}:${string}`
  | `explicit_help:${string}:${string}`;

/** 计划调整记录的幂等键格式：`plan.adjustment:${projectId}:${stemNodeId}:${trigger}`。 */
export type PlanAdjustmentIdempotencyKey =
  `plan.adjustment:${string}:${string}:${PlanAdjustmentTrigger}`;

/**
 * 一条计划调整记录（服务端拥有；客户端不可写）。
 *
 * 状态机与数据库 `project_plan_adjustments` 一一对应：
 * `UNIQUE (project_id, idempotency_key)` 保证同源触发只落一行，
 * `UNIQUE (project_id, base_revision, next_revision)` 保证 revision 链唯一。
 */
export interface ProjectPlanAdjustment {
  id: string;
  projectId: string;
  planId: string;
  /** 乐观锁：必须等于提交时的 `plan_outline.revision`。 */
  baseRevision: number;
  /** apply 时恒为 `baseRevision + 1`。 */
  nextRevision: number;
  trigger: PlanAdjustmentTrigger;
  /** 证据引用（`answer_attempts` / `tutor_turn` 的不透明 id）；不含任何原文。 */
  evidenceRefs: string[];
  action: PlanAdjustmentAction;
  status: PlanAdjustmentStatus;
  /** 冻结的策略文档版本，用于解释「为什么当时这样调」。 */
  policyVersion: string;
  /** `plan.adjustment:${projectId}:${stemNodeId}:${trigger}`，确定性、节点级幂等。 */
  idempotencyKey: string;
}

/**
 * 学生卡点信号（事务内 outbox 事件，脱敏）。
 *
 * 与 `project_plan_adjustments` 在同一事务写入；崩溃后可按 `triggerKey`
 * 从 `audit_logs` 重新推导，不重复发信号。
 *
 * 红线：`errorTypeCode` 是稳定编码，`nodeRefs` / `evidenceRefs` 是不透明
 * 引用；**没有任何字段**承载学生原文。
 */
export interface StudentStuckSignal {
  studentId: string;
  projectId: string;
  planId: string;
  /** 卡点发生的 tutor 会话。 */
  sessionId: string;
  /** 卡点所在的计划大纲节点。 */
  stemNodeId: string;
  /** 稳定概念 id（`knowledgePointId`），用于判分与掌握度对齐。 */
  conceptId: string;
  trigger: PlanAdjustmentTrigger;
  /** 节点级幂等键，见 `StudentStuckTriggerKey`。 */
  triggerKey: StudentStuckTriggerKey;
  errorTypeCode: StuckErrorTypeCode;
  /** 结构引用（大纲节点 id），不含节点正文。 */
  nodeRefs: string[];
  /** 证据引用（`answer_attempts` id / `tutor_turn:<sessionId>:<seq>`）。 */
  evidenceRefs: string[];
  emittedAt: string;
}

/** 脱敏摘要优先级。`high` 用于熔断降级与反复卡点。 */
export type StuckSummaryPriority = 'normal' | 'high';

/**
 * 写给 `audit_logs.detail` / outbox payload / 班主任工作台的脱敏摘要。
 *
 * **INVARIANT（红线）**：只允许稳定错误编码、不透明节点引用与证据引用。
 * 不得包含学生对话正文、作答文本、题目选项文本、`correctKeys` 或
 * `explanation`。新增字段必须是编码 / 引用 / 时间戳之一，否则 F4.6 的
 * 反序列化扫描测试必须失败。
 */
export interface DesensitizedStuckSummary {
  studentId: string;
  projectId: string;
  planId: string;
  /** 卡点所在的大纲节点；`nodeRefs[0]` 是同一节点。 */
  stemNodeId: string;
  /** 稳定概念 id（判分 / 掌握度对齐用）。 */
  conceptId: string;
  errorTypeCode: StuckErrorTypeCode;
  nodeRefs: string[];
  evidenceRefs: string[];
  priority: StuckSummaryPriority;
  occurredAt: string;
}
