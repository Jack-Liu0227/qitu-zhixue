import type { KnowledgeType, ObjectiveStatus } from './learning-plan.js';

/**
 * Mastery 共享合同（ADR 0009 + 本轮 M0 修正）。
 *
 * 权威边界：
 * - PostgreSQL 不可变 mastery 事件 = 证据与当前状态真源；
 * - Graphiti / 外部时序投影 = 可选、异步、可重建的读模型，绝不参与门槛判定。
 *
 * 本轮修正（相对 ADR 第 4.2 节的原始事件形状）：
 * - **事件只追加**：`MasteryAssessmentEvent` 没有 `validTo`；`validTo` 一律在
 *   投影 / 返回数据里推导（当前投影、时间线点）。
 * - **时间查询区分双时态**：`validAt` 是业务时刻（「当时学生处于什么掌握状态」），
 *   `knownAt` 是记录截止时刻（「当时系统已经知道什么」，按 `recordedAt <= knownAt`）。
 * - **保留量化 / 质化两条判定**：`memory | procedure` 看量化 `score >= threshold`，
 *   `concept | design` 只看质化布尔 `qualitativeMastered`。**不**统一成
 *   `level >= threshold`；未知一律是 `null`，不是 `0`。
 *
 * HTTP 沿用仓库现有 `{ data: T }` 约定：控制器返回 `{ data: payload }`，
 * 本文件定义的是 payload 类型；`MasteryHttpResponse<T>` 供 SDK / 前端读取。
 */

/* ------------------------------------------------------------------ *
 * 稳定错误码
 * ------------------------------------------------------------------ */

/**
 * Mastery 模块的稳定错误码（模块内冻结，新增需评审）。
 *
 * 刻意不并入 `ApiErrorCode`：那是跨模块冻结的联合，新增需要单独评审；
 * 学习计划模块采用同样做法（见 `LearningPlanErrorCode`）。
 */
export type MasteryErrorCode =
  /** 客户端尝试写入服务端拥有的掌握状态 / 级别字段（403）。 */
  | 'MASTERY_WRITE_DENIED'
  /** 对象级授权失败：越权读取他人掌握数据（403）。 */
  | 'MASTERY_FORBIDDEN'
  /** 知识点 / 时间线不存在，或对当前账号不可见（404）。 */
  | 'MASTERY_NOT_FOUND'
  /** 请求体 / 查询参数非法（400）。 */
  | 'MASTERY_INPUT_INVALID'
  /** 乱序 / 旧序列事件不得覆盖新状态（409）。 */
  | 'MASTERY_SEQUENCE_CONFLICT'
  /** 幂等键冲突（409）。 */
  | 'MASTERY_IDEMPOTENCY_CONFLICT'
  /** 学习目标未显式映射到 canonical KP，禁止跨项目自动推断（409）。 */
  | 'MASTERY_MAPPING_MISSING'
  /** 评估算法 / 课程版本不匹配（409）。 */
  | 'MASTERY_VERSION_MISMATCH'
  /** 证据引用非法（400）。 */
  | 'MASTERY_EVIDENCE_INVALID'
  /** 门槛参数非法（400）。 */
  | 'MASTERY_THRESHOLD_INVALID'
  /** 时间线投影不可用 / 过期，不能伪装成空数据（503）。 */
  | 'MASTERY_TIMELINE_UNAVAILABLE';

/** RFC 9457 风格问题详情。 */
export interface MasteryProblemDetails<TDetails = unknown> {
  code: MasteryErrorCode;
  message: string;
  details?: TDetails;
}

/* ------------------------------------------------------------------ *
 * Canonical KnowledgePoint 与学习目标映射
 * ------------------------------------------------------------------ */

/** canonical 知识点的稳定引用：KP ID + 课程版本。 */
export interface MasteryKnowledgePointRef {
  knowledgePointId: string;
  /** 课程 / 内容版本。跨项目聚合只能发生在同版本 KP 上。 */
  courseVersion: string;
}

/**
 * 学习计划目标 → canonical KP 的**显式**映射。
 *
 * 本轮最小切片：学习计划用「模板版本 + 内容版本 + 目标 ID」作显式映射键；
 * 未人工映射的目标不自动跨项目推断，评估命令会得到
 * `MASTERY_MAPPING_MISSING`。`source` 现阶段只能是 `'explicit'`。
 */
export interface MasteryObjectiveMapping extends MasteryKnowledgePointRef {
  planId: string;
  objectiveId: string;
  /** 计划冻结的模板版本（`learning_plans.template_version`）。 */
  templateVersion: string;
  /** 目标对应课程内容的版本。 */
  contentVersion: string;
  source: 'explicit';
  mappedAt: string;
}

/* ------------------------------------------------------------------ *
 * 事件（append-only）
 * ------------------------------------------------------------------ */

export type MasteryEventType = 'assessed' | 'corrected' | 'revoked' | 'imported';

export type MasterySourceType = 'quiz' | 'qualitative' | 'practice' | 'staff' | 'migration';

/**
 * 不可变掌握评估事件。
 *
 * 写约束：
 * - 只追加，**没有 `validTo`**；`validTo` 由后续取代 / 撤销事件推导，
 *   见 `MasteryCurrentProjection` / `MasteryTimelinePoint`。
 * - `validFrom` 是掌握状态在业务上开始生效的时间，由服务端校验，不信任客户端。
 * - `recordedAt` 是启途接受并落库的时间，由数据库 / 服务端产生。
 * - `sequence` 在 `(studentId, knowledgePointId)` 聚合内单调递增，乱序拒绝。
 * - `score` / `confidence` / `qualitativeMastered` 是服务端判定结果；量化
 *   （memory/procedure）与质化（concept/design）两条判定不混用，未知为 `null`。
 * - `evidenceRefs` 只存不透明引用（`sourceKind:opaqueId`），正文留在 L1 / attempt /
 *   作品证据里，**不得**存未成年人原始对话或语音。
 */
export interface MasteryAssessmentEvent {
  id: string;
  schoolId: string | null;
  studentId: string;
  knowledgePointId: string;
  courseVersion: string;
  objectiveId: string | null;
  planId: string | null;
  projectId: string | null;

  eventType: MasteryEventType;
  knowledgeType: KnowledgeType;
  /** 量化分 0..1：仅 memory/procedure 评估时有值；不适用或未知时为 null，不是 0。 */
  score: number | null;
  /** 算法置信度 0..1：仅量化评估时有意义；不适用或未知时为 null。 */
  confidence: number | null;
  /** 质化判定：仅 concept/design 评估时有值；不适用或未知时为 null。 */
  qualitativeMastered: boolean | null;

  validFrom: string;
  recordedAt: string;
  /** `(studentId, knowledgePointId)` 聚合内单调递增。 */
  sequence: number;

  /** 只读证据引用（`sourceKind:opaqueId`）。 */
  evidenceRefs: string[];
  sourceType: MasterySourceType;
  sourceEventId: string;
  causationId: string | null;
  correlationId: string | null;
  supersedesEventId: string | null;
  assessmentVersion: string;
  idempotencyKey: string;
}

/* ------------------------------------------------------------------ *
 * 当前投影 / 时间线 / 快照 / 门槛 / 退步
 * ------------------------------------------------------------------ */

/**
 * 当前掌握投影（可由事件账本重建；不是历史事实源）。
 *
 * `validTo` 是推导字段：当前事件被下一条取代 / 撤销事件取代时，取那条事件的
 * `validFrom`；当前仍有效时为 `null`。事件本身不存 `validTo`。
 */
export interface MasteryCurrentProjection {
  studentId: string;
  knowledgePointId: string;
  courseVersion: string;
  knowledgeType: KnowledgeType;
  objectiveId: string | null;
  planId: string | null;
  projectId: string | null;
  /** 量化分 0..1；未知为 null。 */
  score: number | null;
  confidence: number | null;
  /** 质化布尔；未知为 null。 */
  qualitativeMastered: boolean | null;
  status: ObjectiveStatus;
  sourceEventId: string;
  sequence: number;
  assessmentVersion: string;
  validFrom: string;
  /** 推导字段：下一条取代事件的 validFrom；当前有效时为 null。 */
  validTo: string | null;
  updatedAt: string;
}

/** 时间线上的一点：一个事件的投影，`validTo` 同样推导自下一条事件。 */
export interface MasteryTimelinePoint {
  eventId: string;
  studentId: string;
  knowledgePointId: string;
  courseVersion: string;
  eventType: MasteryEventType;
  knowledgeType: KnowledgeType;
  score: number | null;
  confidence: number | null;
  qualitativeMastered: boolean | null;
  status: ObjectiveStatus;
  sourceEventId: string;
  sequence: number;
  assessmentVersion: string;
  validFrom: string;
  validTo: string | null;
  recordedAt: string;
  evidenceRefs: string[];
}

/** 快照中的单个 KP 点。 */
export interface MasterySnapshotPoint {
  knowledgePointId: string;
  courseVersion: string;
  knowledgeType: KnowledgeType;
  score: number | null;
  confidence: number | null;
  qualitativeMastered: boolean | null;
  status: ObjectiveStatus;
  sourceEventId: string;
  sequence: number;
}

/** 快照新鲜度：`stale` / `unavailable` 必须显式返回，不能伪装成空数据。 */
export type MasterySnapshotFreshness = 'fresh' | 'stale' | 'unavailable';

/** 历史快照（读模型，可重建）。 */
export interface MasterySnapshot {
  studentId: string;
  /** 业务时刻。 */
  validAt: string;
  /** 记录截止时刻。 */
  knownAt: string;
  /** 快照对应的事件账本聚合序列；落后时必须如实上报。 */
  sourceSequence: number;
  assessmentVersion: string;
  freshness: MasterySnapshotFreshness;
  points: MasterySnapshotPoint[];
}

/** 门槛：量化类型看 `value`，质化类型只看布尔（`value` 为 null）。 */
export interface MasteryThreshold {
  knowledgePointId: string;
  courseVersion: string;
  knowledgeType: KnowledgeType;
  kind: 'quantitative' | 'qualitative';
  /** 量化门槛 0..1（memory/procedure）；质化类型为 null。 */
  value: number | null;
  assessmentVersion: string;
}

/** 门槛判定结果：`met` 由服务端推导，客户端不可传。 */
export interface MasteryThresholdResult {
  studentId: string;
  knowledgePointId: string;
  courseVersion: string;
  threshold: MasteryThreshold;
  current: MasteryCurrentProjection | null;
  met: boolean;
  reason: string;
  checkedAt: string;
}

export type MasteryRegressionKind = 'score_drop' | 'mastery_lost' | 'superseded';

/** 退步告警：由两条时间线点的比较推导。 */
export interface MasteryRegression {
  studentId: string;
  knowledgePointId: string;
  courseVersion: string;
  kind: MasteryRegressionKind;
  from: MasteryTimelinePoint;
  to: MasteryTimelinePoint;
  detectedAt: string;
}

/* ------------------------------------------------------------------ *
 * 服务端输入
 * ------------------------------------------------------------------ */

/**
 * 双时态查询基准。
 *
 * - `validAt`：业务时刻，按 `validFrom <= validAt < validTo` 过滤；
 * - `knownAt`：记录截止时刻，按 `recordedAt <= knownAt` 过滤。
 */
export interface MasteryTimeQuery {
  validAt: string | null;
  knownAt: string | null;
}

export interface GetCurrentMasteryInput extends MasteryTimeQuery {
  studentId: string;
  knowledgePointId?: string | null;
  courseVersion?: string | null;
}

export interface GetMasteryTimelineInput extends MasteryTimeQuery {
  studentId: string;
  knowledgePointId: string;
  courseVersion?: string | null;
  cursor?: string | null;
  limit?: number;
}

export interface GetMasterySnapshotInput {
  studentId: string;
  validAt: string;
  knownAt: string | null;
  knowledgePointIds?: string[] | null;
}

export interface CheckMasteryThresholdInput extends MasteryTimeQuery {
  studentId: string;
  knowledgePointId: string;
  courseVersion?: string | null;
}

export interface GetRegressionAlertsInput {
  studentId: string;
  knowledgePointId?: string | null;
  since?: string | null;
  knownAt?: string | null;
  limit?: number;
}

/**
 * 服务端评估命令。量化 / 质化是互斥的两条分支：
 * - memory/procedure 必填 `score`；
 * - concept/design 必填 `qualitativeMastered`。
 *
 * 输入验证在服务端；该类型只描述服务端内部命令，不作为浏览器写接口。
 */
export type EvaluateMasteryInput = {
  eventType?: MasteryEventType;
  studentId: string;
  knowledgePointId: string;
  courseVersion: string;
  objectiveId: string | null;
  planId: string | null;
  projectId: string | null;
  sourceType: MasterySourceType;
  sourceEventId: string;
  evidenceRefs: string[];
  validFrom: string;
  assessmentVersion: string;
  idempotencyKey: string;
  causationId?: string | null;
  correlationId?: string | null;
  supersedesEventId?: string | null;
} & (
  | { knowledgeType: 'memory' | 'procedure'; score: number; confidence: number | null }
  | { knowledgeType: 'concept' | 'design'; qualitativeMastered: boolean }
);

/** 一次评估落账的结果：新事件 + 推导后的当前投影。 */
export interface MasteryAssessmentResult {
  event: MasteryAssessmentEvent;
  current: MasteryCurrentProjection;
  replayed: boolean;
}

/* ------------------------------------------------------------------ *
 * 浏览器只读请求 / 视图
 * ------------------------------------------------------------------ */

/**
 * 浏览器读端口请求体：**只**携带查询过滤条件，结构上不存在 `level` /
 * `confidence` / `approved` / `score` / `qualitativeMastered` 等字段。
 * 客户端塞入这些字段不会被采信，服务端按白名单拒绝。
 */
export interface MasteryReadCurrentRequest {
  knowledgePointId?: string | null;
  courseVersion?: string | null;
  validAt?: string | null;
  knownAt?: string | null;
}

export interface MasteryReadTimelineRequest {
  knowledgePointId: string;
  courseVersion?: string | null;
  validAt?: string | null;
  knownAt?: string | null;
  cursor?: string | null;
  limit?: number;
}

export interface MasteryReadSnapshotRequest {
  validAt: string;
  knownAt?: string | null;
  knowledgePointIds?: string[] | null;
}

export interface MasteryReadThresholdRequest {
  knowledgePointId: string;
  courseVersion?: string | null;
  validAt?: string | null;
  knownAt?: string | null;
}

export interface MasteryReadRegressionRequest {
  knowledgePointId?: string | null;
  since?: string | null;
  knownAt?: string | null;
  limit?: number;
}

export interface MasteryCurrentView {
  current: MasteryCurrentProjection[];
  validAt: string;
  knownAt: string;
}

export interface MasteryTimelineView {
  items: MasteryTimelinePoint[];
  nextCursor: string | null;
  hasNext: boolean;
}

export interface MasteryThresholdView {
  threshold: MasteryThresholdResult;
}

export interface MasteryRegressionView {
  items: MasteryRegression[];
}

/* ------------------------------------------------------------------ *
 * 端口
 * ------------------------------------------------------------------ */

/**
 * 服务端 `MasteryTimelinePort`：掌握度事件的唯一写入口 + 服务端读投影。
 *
 * - 不暴露 Graphiti 或任何第三方类型；存储实现可以是 PostgreSQL 事件账本 +
 *   可重建读模型，Graphiti 只是可选异步投影。
 * - `evaluate` 负责在同一事务里写事件 + 当前投影 + 审计 + outbox；幂等键
 *   和 `(studentId, knowledgePointId)` 聚合序列由实现校验。
 */
export interface MasteryTimelinePort {
  evaluate(input: EvaluateMasteryInput): Promise<MasteryAssessmentResult>;
  getCurrent(input: GetCurrentMasteryInput): Promise<MasteryCurrentProjection[]>;
  getTimeline(input: GetMasteryTimelineInput): Promise<MasteryTimelinePoint[]>;
  snapshot(input: GetMasterySnapshotInput): Promise<MasterySnapshot>;
  checkThreshold(input: CheckMasteryThresholdInput): Promise<MasteryThresholdResult>;
  getRegressionAlerts(input: GetRegressionAlertsInput): Promise<MasteryRegression[]>;
}

/**
 * 浏览器只读 `MasteryReadPort`：学生 / 家长 / 班主任端读取掌握数据的窄接口。
 *
 * 对象级授权在服务端实现；请求体只含查询过滤条件，禁止浏览器任意传
 * `level` / `confidence` / `approved` 等字段。返回的 `score` /
 * `qualitativeMastered` 均为服务端投影结果。
 */
export interface MasteryReadPort {
  getCurrent(input: MasteryReadCurrentRequest): Promise<MasteryCurrentView>;
  getTimeline(input: MasteryReadTimelineRequest): Promise<MasteryTimelineView>;
  getSnapshot(input: MasteryReadSnapshotRequest): Promise<MasterySnapshot>;
  getThreshold(input: MasteryReadThresholdRequest): Promise<MasteryThresholdView>;
  getRegressionAlerts(input: MasteryReadRegressionRequest): Promise<MasteryRegressionView>;
}

/** 仓库 HTTP 约定：所有响应包成 `{ data: T }`。 */
export interface MasteryHttpResponse<T> {
  data: T;
}
