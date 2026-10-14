import type {
  EvidenceProfile,
  EvidenceRequirement,
  PblRubric,
  ProjectReviewCandidate,
  ProjectReviewCandidateStatus,
  ProjectReviewCriterionResult,
  RubricLevel,
} from '@qitu/contracts';
import { GATE_CONDITION_CORE, derivePracticeGateFromDeliverable } from '@qitu/contracts';
import { PBL_GATE_SOURCE_WHITELIST } from '@qitu/ai-client';
import type { MentorReviewRecord } from './works.store';

/** Adapter from the existing Works review record to the PBL review contract. */
export function toProjectReviewCandidate(input: {
  review: MentorReviewRecord;
  artifactVersionId: string;
  rubric: PblRubric;
  now?: Date;
}): ProjectReviewCandidate {
  const { review, artifactVersionId, rubric } = input;
  const timestamp = (input.now ?? new Date()).toISOString();
  return {
    id: `review-candidate:${review.id}:${artifactVersionId}`,
    projectId: review.projectId ?? '',
    artifactVersionId,
    rubricId: rubric.id,
    rubricVersion: rubric.version,
    status: reviewStatusToCandidateStatus(review.status),
    score: null,
    criteria: [],
    missingEvidenceIds: [],
    source: 'teacher',
    modelId: null,
    reviewedBy: review.reviewedAt === null ? null : review.mentorUserId,
    createdAt: review.createdAt.toISOString(),
    updatedAt: timestamp,
  };
}

function reviewStatusToCandidateStatus(status: MentorReviewRecord['status']): ProjectReviewCandidateStatus {
  switch (status) {
    case 'approved':
      return 'accepted';
    case 'changes_requested':
      return 'returned';
    case 'rejected':
      return 'rejected';
    case 'requested':
    case 'in_review':
      return 'pending';
  }
}

export interface ProjectReviewValidationInput {
  candidate: ProjectReviewCandidate;
  rubric: PblRubric;
  evidenceRequirements: readonly EvidenceRequirement[];
  availableEvidenceIds: readonly string[];
}

/**
 * Validate a candidate at the review boundary. This intentionally returns
 * errors instead of throwing so callers can persist a `needs_evidence`
 * candidate or present actionable feedback to a teacher.
 */
export function validateProjectReviewCandidate(input: ProjectReviewValidationInput): string[] {
  const { candidate, rubric, evidenceRequirements, availableEvidenceIds } = input;
  const errors: string[] = [];
  const criterionIds = new Set(rubric.criteria.map((criterion) => criterion.id));
  const criterionById = new Map(rubric.criteria.map((criterion) => [criterion.id, criterion]));
  const requirementById = new Map(evidenceRequirements.map((requirement) => [requirement.id, requirement]));
  const available = new Set(availableEvidenceIds);

  if (candidate.rubricId !== rubric.id || candidate.rubricVersion !== rubric.version) {
    errors.push('candidate rubric does not match the selected rubric version');
  }
  if (candidate.source === 'ai' && candidate.status === 'accepted') {
    errors.push('AI review cannot directly produce an accepted candidate');
  }
  if (candidate.source === 'ai' && candidate.modelId === null) {
    errors.push('AI candidate must identify its model');
  }
  if (candidate.source === 'teacher' && candidate.status === 'accepted' && candidate.reviewedBy === null) {
    errors.push('accepted teacher candidate must identify the reviewer');
  }
  if (candidate.score !== null && (!Number.isFinite(candidate.score) || candidate.score < 0 || candidate.score > 100)) {
    errors.push('score must be between 0 and 100');
  }

  const seenCriteria = new Set<string>();
  for (const result of candidate.criteria) {
    if (!criterionIds.has(result.criterionId)) errors.push(`unknown criterion: ${result.criterionId}`);
    if (seenCriteria.has(result.criterionId)) errors.push(`duplicate criterion: ${result.criterionId}`);
    seenCriteria.add(result.criterionId);
    if (!Number.isInteger(result.level) || result.level < 0 || result.level > 4) {
      errors.push(`invalid level for criterion: ${result.criterionId}`);
    }
    if (result.evidenceRefs.some((ref) => !available.has(ref))) {
      errors.push(`criterion ${result.criterionId} references unavailable evidence`);
    }
  }

  const missing = new Set(candidate.missingEvidenceIds);
  for (const requirement of evidenceRequirements) {
    if (!requirement.required) continue;
    const satisfied = available.has(requirement.id) || candidate.criteria.some((result) => {
      const criterion = criterionById.get(result.criterionId);
      return criterion?.evidenceRequirementIds.includes(requirement.id) === true &&
        result.evidenceRefs.some((ref) => available.has(ref));
    });
    if (!satisfied && !missing.has(requirement.id)) {
      errors.push(`required evidence is neither available nor declared missing: ${requirement.id}`);
    }
  }
  for (const id of candidate.missingEvidenceIds) {
    if (!requirementById.has(id)) errors.push(`unknown missing evidence requirement: ${id}`);
  }
  if (candidate.status === 'accepted' && candidate.missingEvidenceIds.length > 0) {
    errors.push('accepted candidate cannot have missing evidence');
  }
  return errors;
}

export function isProjectReviewReady(input: ProjectReviewValidationInput): boolean {
  return validateProjectReviewCandidate(input).length === 0 &&
    input.candidate.status === 'ready_for_teacher';
}

export function isRubricLevel(value: number): value is RubricLevel {
  return Number.isInteger(value) && value >= 0 && value <= 4;
}

/* ==========================================================================
 *  自动评估接缝（automatic assessor seam）
 *
 *  规则来源（AGENTS.md 与产品决策）：**全自动验收** =
 *    (1) 确定性服务端生产者产生证据；
 *    (2) AI 评估方只产生一个**候选**（分数 + 逐条 criterion 理由）；
 *    (3) **另一个**确定性规则据此产生门禁事件。
 *
 *  本段就是 (2) 与 (3) 的边界：
 *  - `toAiProjectReviewCandidate` 是 AI 侧唯一的构造入口，**强制**
 *    `source: 'ai'` 且拒绝任何终态（`accepted`）——AI 写不出"通过"；
 *  - `evaluateAutomaticAcceptance` 不调用任何模型，只读「已落库的候选 +
 *    可用证据集合」，并且是**唯一**被允许调用 `recordGateForStudent` 的地方。
 *
 *  上面那几个既有校验（`validateProjectReviewCandidate`）保持**原样**、
 *  未放宽一行：拒绝 `source==='ai' && status==='accepted'`、要求 AI 候选
 *  报出 `modelId`、拒绝仍然列着缺失证据的 accepted 候选——这三条就是
 *  「AI 永不写 passed」的实现本身。
 * ========================================================================== */

/**
 * 自动验收状态机的对外状态。
 *
 * 契约层的 `ProjectReviewCandidateStatus` 仍然带着教师路径
 * （`ready_for_teacher` / accepted 需 `reviewedBy`）。在**教师不在环**的决策下，
 * 这两个状态在这里被**重新表述**为 `pending_automatic_acceptance`：
 * 候选的终态只能由确定性规则写，而不是由某个人点一下。
 *
 * 注意：契约枚举本身不在本工作流的 ownedFiles 内，所以这里做的是
 * **本地映射**，不是契约改名。把 `ready_for_teacher` 从
 * `packages/contracts/src/pbl-learning.ts` 里正式退役需要一次 contracts 改动
 * （有独立 owner），已在 PR 说明中记为后续项。
 */
export type AutomaticAcceptanceState =
  | 'pending_automatic_acceptance'
  | 'accepted'
  | 'returned'
  | 'rejected'
  | 'needs_evidence';

export function toAutomaticAcceptanceState(status: ProjectReviewCandidateStatus): AutomaticAcceptanceState {
  switch (status) {
    case 'pending':
    case 'ready_for_teacher':
      return 'pending_automatic_acceptance';
    case 'accepted':
      return 'accepted';
    case 'needs_evidence':
      return 'needs_evidence';
    case 'returned':
      return 'returned';
    case 'rejected':
      return 'rejected';
  }
}

export interface AiReviewCandidateInput {
  candidateId: string;
  projectId: string;
  artifactVersionId: string;
  rubric: PblRubric;
  /** 产生该候选的模型 id（必填；`null` 会被既有校验拒绝）。 */
  modelId: string;
  score: number;
  criteria: readonly ProjectReviewCriterionResult[];
  missingEvidenceIds?: readonly string[];
  now?: Date;
}

/**
 * AI 侧唯一构造入口。
 *
 * - `source` 由本函数写死为 `'ai'`，调用方无法伪造教师身份；
 * - `status` 由「有没有缺失证据」推导：
 *   证据齐 → `'pending'`（**不是** accepted）、缺证据 → `'needs_evidence'`；
 * - 任何企图让 AI 直接产出 `'accepted'` 的入参（status 字段）在本函数里
 *   根本不存在，因此"AI 写通过"没有代码路径。
 */
export function toAiProjectReviewCandidate(input: AiReviewCandidateInput): ProjectReviewCandidate {
  const timestamp = (input.now ?? new Date()).toISOString();
  const missing = [...(input.missingEvidenceIds ?? [])];
  return {
    id: input.candidateId,
    projectId: input.projectId,
    artifactVersionId: input.artifactVersionId,
    rubricId: input.rubric.id,
    rubricVersion: input.rubric.version,
    status: missing.length > 0 ? 'needs_evidence' : 'pending',
    score: input.score,
    criteria: input.criteria.map((result) => ({
      criterionId: result.criterionId,
      level: result.level,
      rationale: result.rationale,
      evidenceRefs: [...result.evidenceRefs],
    })),
    missingEvidenceIds: missing,
    source: 'ai',
    modelId: input.modelId,
    reviewedBy: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

/** 自动验收规则入参：候选 + 证据集合 + rubric（全部来自服务端已落库数据）。 */
export interface AutomaticAcceptanceInput {
  /** 已落库的候选（必须已通过 `validateProjectReviewCandidate` 写入路径）。 */
  candidate: ProjectReviewCandidate;
  rubric: PblRubric;
  evidenceRequirements: readonly EvidenceRequirement[];
  /** 服务端已知可用的证据 id 集合（来自 project_evidence / artifact_versions）。 */
  availableEvidenceIds: readonly string[];
  /**
   * 最低 criterion 等级（逐条门槛）。默认 `null` = 不额外加门槛，
   * 只走「候选自身必须已经过了校验」这条线。
   */
  minimumCriterionLevel?: RubricLevel | null;
  /** 阶段交付物档案：用于推导该验收对应哪个门禁（可空）。 */
  evidenceProfile?: EvidenceProfile | null;
  /** 阶段交付物类型（与 evidenceProfile 二者取其一即可推导）。 */
  deliverableType?: string | null;
}

export interface AutomaticAcceptanceDecision {
  /**
   * `auto_accept` 才允许写门禁事件；
   * `needs_evidence` / `reject` / `blocked` 都不写、只留痕。
   */
  outcome: 'auto_accept' | 'needs_evidence' | 'reject' | 'blocked';
  state: AutomaticAcceptanceState;
  /**
   * 该验收对应的门禁 id。
   *
   * 取值来自 `derivePracticeGateFromDeliverable`，并且只在该 id 于
   * `PBL_GATE_SOURCE_WHITELIST`（写入方真源表）里有条目时才返回；否则为 null，
   * 同时 `gateDeferredReason` 说明原因。
   */
  gate: string | null;
  /**
   * 为什么没有门禁：`null` = 有；
   * `'no_writable_gate'` = 推导出的门禁不在冻结核心集合内（例如报告类的
   * `experiment_report_validated` 还没被 team-runtime 的 KNOWN_PBL_GATES 接纳）。
   * 这是**如实上报**的延后项，不是失败重试。
   */
  gateDeferredReason: 'no_writable_gate' | null;
  score: number | null;
  /** 未通过的原因（逐条，稳定字符串，可直接进审计 detail）。 */
  blockingReasons: readonly string[];
}

/**
 * 确定性自动验收规则 —— **不调用任何模型**。
 *
 * 判定顺序（任一步失败即停，全部可复现）：
 * 1. 候选必须自己先过既有校验（AI 不得 accepted / 必须报 modelId / accepted
 *    不得仍列缺失证据）——直接复用 `validateProjectReviewCandidate`，不放宽；
 * 2. 候选状态必须是 `pending`（AI 侧可评审态）；`needs_evidence` → 要证据；
 * 3. 候选不得带 `missingEvidenceIds`；
 * 4. 分数必须 ≥ rubric.passingScore；
 * 5. 每条 rubric criterion 都必须有结果，且等级 ≥ `minimumCriterionLevel`。
 *
 * 门禁推导：由交付物档案（`evidenceProfile` / `deliverableType`）得到门禁 id，
 * 但**只有落在冻结核心集合内**的门禁才允许写入；否则返回
 * `gateDeferredReason: 'no_writable_gate'`，由调用方如实记录、不重试。
 * 这样既不会去动 team-runtime 的冻结白名单（不改别人的契约），
 * 也不会把「无法写入」伪装成「已通过」。
 */
export function evaluateAutomaticAcceptance(input: AutomaticAcceptanceInput): AutomaticAcceptanceDecision {
  const { candidate, rubric, evidenceRequirements, availableEvidenceIds } = input;

  const validationErrors = validateProjectReviewCandidate({
    candidate,
    rubric,
    evidenceRequirements,
    availableEvidenceIds,
  });
  const gate = resolveAutomaticGate(input);
  const base = {
    state: toAutomaticAcceptanceState(candidate.status),
    gate: gate.gate,
    gateDeferredReason: gate.deferredReason,
    score: candidate.score,
  } as const;

  if (validationErrors.length > 0) {
    return { ...base, outcome: 'blocked', blockingReasons: [...validationErrors] };
  }
  if (candidate.status === 'needs_evidence') {
    return { ...base, outcome: 'needs_evidence', blockingReasons: ['candidate declares missing evidence'] };
  }
  if (candidate.status !== 'pending') {
    // AI 侧候选只允许 pending；其它状态只能来自教师路径（oversight fallback）。
    return { ...base, outcome: 'blocked', blockingReasons: [`candidate status ${candidate.status} is not an automatic-acceptance candidate`] };
  }
  if (candidate.missingEvidenceIds.length > 0) {
    return { ...base, outcome: 'needs_evidence', blockingReasons: ['missingEvidenceIds is not empty'] };
  }
  if (candidate.score === null) {
    return { ...base, outcome: 'reject', blockingReasons: ['score is required for automatic acceptance'] };
  }
  if (candidate.score < rubric.passingScore) {
    return { ...base, outcome: 'reject', blockingReasons: [`score ${candidate.score} below passingScore ${rubric.passingScore}`] };
  }

  const byCriterion = new Map(candidate.criteria.map((result) => [result.criterionId, result]));
  const reasons: string[] = [];
  for (const criterion of rubric.criteria) {
    const result = byCriterion.get(criterion.id);
    if (result === undefined) {
      reasons.push(`criterion ${criterion.id} has no result`);
      continue;
    }
    if (input.minimumCriterionLevel !== undefined && input.minimumCriterionLevel !== null
      && result.level < input.minimumCriterionLevel) {
      reasons.push(`criterion ${criterion.id} level ${result.level} below minimum ${input.minimumCriterionLevel}`);
    }
  }
  if (reasons.length > 0) return { ...base, outcome: 'reject', blockingReasons: reasons };

  if (gate.gate === null) {
    // 结构/证据都过，但对应的门禁不可写：如实上报，绝不改成别的门禁。
    // 状态**不**推进为 accepted：没有可写的门禁就没有"通过"这件事。
    return {
      ...base,
      outcome: 'auto_accept',
      blockingReasons: ['gate deferred: derived gate is not in the frozen core gate set'],
    };
  }
  return { ...base, state: 'accepted', outcome: 'auto_accept', blockingReasons: [] };
}

function resolveAutomaticGate(input: AutomaticAcceptanceInput): {
  gate: string | null;
  deferredReason: 'no_writable_gate' | null;
} {
  const derived = resolveDerivedAutomaticGateId(input);
  if (derived === null) return { gate: null, deferredReason: 'no_writable_gate' };
  // 可写性**由真源回答**：`PBL_GATE_SOURCE_WHITELIST` 是"谁能写哪个门禁"的唯一声明处，
  // 也是 team-runtime 的 `KNOWN_PBL_GATES` / `assertGateEvidenceWritable` 依据的表。
  // 不在这里自己维护第二份清单（那正是"三处重复四值联合"的旧病）。
  const writable = Object.prototype.hasOwnProperty.call(PBL_GATE_SOURCE_WHITELIST, derived);
  return writable ? { gate: derived, deferredReason: null } : { gate: null, deferredReason: 'no_writable_gate' };
}

/**
 * 交付物 → 门禁 id 的**纯推导**（只回答"应该用哪个门禁"）。
 *
 * 与「这个门禁能不能写」是两件事：可写性由 `resolveAutomaticGate` 对照冻结核心集合判断。
 * 分开之后，调用方可以如实记录「推导出的门禁是 X，但它不在可写集合内」，
 * 而不是把结论悄悄改成另一个门禁。
 */
export function resolveDerivedAutomaticGateId(input: {
  evidenceProfile?: EvidenceProfile | null;
  deliverableType?: string | null;
}): string | null {
  return derivePracticeGateFromDeliverable(input.deliverableType ?? null, input.evidenceProfile ?? null);
}

/**
 * 门禁写入端口：**只有确定性规则**实现/持有它。
 *
 * 这里刻意声明成最小接口（不是整个 TeamRuntimeService），
 * 让「谁能写门禁」在类型层面就收窄到一个方法名。
 */
export interface GateEvidenceWriter {
  recordGateForStudent(input: {
    studentUserId: string;
    gate: string;
    evidenceRef: string;
    source: string;
    idempotencyKey?: string;
  }): Promise<{ status: 'recorded' | 'already_satisfied' | 'deferred'; runId: string | null; gate: string; reason?: string }>;
}

export interface AutomaticAcceptanceContext {
  /** 候选归属学生（写门禁的主体，取服务端记录，不取请求体）。 */
  studentUserId: string;
  /** 门禁证据引用：指向那条留痕的验收决定（>= 8 字符）。 */
  evidenceRef: string;
  /** 门禁写入方标识，必须命中 `PBL_GATE_SOURCE_WHITELIST[gate]`。 */
  source: string;
}

/**
 * 唯一被允许调用 `recordGateForStudent` 的函数。
 *
 * 返回 `gate.writeStatus` 三态（`recorded` / `already_satisfied` / `deferred`）
 * 全部视为「调用成功」——`deferred` 是 T22 的待冲刷账本语义（学生还没有活跃
 * run 时先落账本，startRun 时冲刷），不是失败。
 */
export async function applyAutomaticAcceptance(
  writer: GateEvidenceWriter,
  decision: AutomaticAcceptanceDecision,
  context: AutomaticAcceptanceContext,
): Promise<{ written: boolean; writeStatus: string | null; reason: string | null }> {
  if (decision.outcome !== 'auto_accept') {
    return { written: false, writeStatus: null, reason: `outcome=${decision.outcome}` };
  }
  if (decision.gate === null) {
    return { written: false, writeStatus: null, reason: decision.gateDeferredReason ?? 'no_gate' };
  }
  const result = await writer.recordGateForStudent({
    studentUserId: context.studentUserId,
    gate: decision.gate,
    evidenceRef: context.evidenceRef,
    source: context.source,
  });
  return { written: true, writeStatus: result.status, reason: result.reason ?? null };
}
