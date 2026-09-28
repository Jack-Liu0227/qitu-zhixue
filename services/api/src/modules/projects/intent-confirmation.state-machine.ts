import type { ExplorationStatus, ProjectStage } from '@qitu/contracts';

/**
 * T6 — 意图确认状态机（纯函数，无 IO、无依赖）。
 *
 * 这里是「未确认不得创建正式项目」这条硬约束的**唯一判定点**。
 * 之所以做成不依赖任何运行时的纯函数，是为了让状态迁移能被穷举测试，
 * 而不必启动 Nest、数据库或 AI 服务。
 *
 * 术语：
 * - 探索（exploration）：确认之前的草稿，可以存意图，但**不是项目**。
 * - 确认（confirmation）：学生明确表示「就是它」。确认凭据是服务端写入的
 *   `confirmedAt`，不接受客户端传入。
 * - 正式项目（formal project）：确认之后才允许创建，一条探索最多对应一条。
 */

/** 候选意图里可被学生 / AI 澄清的字段。 */
export interface IntentDraftFields {
  goalUser: string | null;
  coreInterests: readonly string[];
  preferredForm: string | null;
  targetBeneficiary: string | null;
}

/** 加上了服务端确认凭据的完整草稿快照。 */
export interface IntentDraftSnapshot extends IntentDraftFields {
  /** 服务端写入的确认时间；`null` = 未确认。 */
  confirmedAt: string | null;
}

export type IntentConfirmationErrorCode =
  | 'EXPLORATION_TRANSITION_INVALID'
  | 'INTENT_DRAFT_INCOMPLETE';

/** 状态机拒绝迁移时抛出的领域错误；`.code` 是稳定错误码。 */
export class IntentConfirmationError extends Error {
  readonly code: IntentConfirmationErrorCode;

  constructor(code: IntentConfirmationErrorCode, message: string) {
    super(message);
    this.name = 'IntentConfirmationError';
    this.code = code;
  }
}

/**
 * 项目阶段顺序（与 `ProjectStage` 联合类型一一对应）。
 *
 * 用于服务端计算展示用的 `currentStageIndex` / `progressPercent`。
 * 这些值**只供展示**，任何门禁都必须读 `status` / `confirmedAt`，
 * 不能读进度百分比。
 */
export const PROJECT_STAGE_ORDER = [
  'exploration',
  'intent_confirmed',
  'theory_learning',
  'theory_check',
  'practice_ready',
  'practice_building',
  'artifact_review',
  'reflection',
  'published',
  'completed',
] as const satisfies readonly ProjectStage[];

/**
 * 正式项目创建时的初始阶段。
 *
 * 学生确认的那一刻，`exploration` 已经发生在探索会话里，因此正式项目从
 * `intent_confirmed` 起步，而不是重新回到 `exploration`。
 */
export const FORMAL_PROJECT_START_STAGE: ProjectStage = 'intent_confirmed';

export interface StageProgress {
  currentStageIndex: number;
  stageTotal: number;
  progressPercent: number;
}

/** 服务端计算展示用进度；`status` 不在枚举内时抛错，避免静默写入脏数据。 */
export function computeStageProgress(status: ProjectStage): StageProgress {
  const index = PROJECT_STAGE_ORDER.indexOf(status);
  if (index === -1) {
    throw new IntentConfirmationError(
      'EXPLORATION_TRANSITION_INVALID',
      `未知的项目阶段：${String(status)}`,
    );
  }
  const stageTotal = PROJECT_STAGE_ORDER.length;
  const progressPercent =
    stageTotal <= 1 ? 100 : Math.max(0, Math.min(100, Math.round((index / (stageTotal - 1)) * 100)));
  return { currentStageIndex: index, stageTotal, progressPercent };
}

/** 候选意图是否已经「形成」到可以进入确认阶段。 */
export function isIntentDraftConfirmable(
  draft: IntentDraftFields | null | undefined,
): draft is IntentDraftFields {
  if (draft === null || draft === undefined) return false;
  return draft.coreInterests.some((tag) => typeof tag === 'string' && tag.trim().length > 0);
}

/**
 * 硬不变式：只有当探索处于 `confirmed` **且**确认凭据不为空时，
 * 才允许创建正式项目。
 *
 * 注意参数里没有「客户端声称已确认」这种输入——确认只能来自服务端记录。
 */
export function canCreateFormalProject(
  status: ExplorationStatus,
  draft: IntentDraftSnapshot | null | undefined,
): boolean {
  return (
    status === 'confirmed' && draft !== null && draft !== undefined && draft.confirmedAt !== null
  );
}

/**
 * `exploring → awaiting_confirmation`。
 *
 * 只有在候选意图确实形成后才允许进入确认阶段；否则会把一个空方向摆到
 * 学生面前诱导误确认。
 */
export function markAwaitingConfirmation(
  status: ExplorationStatus,
  draft: IntentDraftFields | null | undefined,
): 'awaiting_confirmation' {
  if (status !== 'exploring') {
    throw transitionInvalid(status, 'awaiting_confirmation');
  }
  if (!isIntentDraftConfirmable(draft)) {
    throw new IntentConfirmationError(
      'INTENT_DRAFT_INCOMPLETE',
      '候选意图尚未形成，不能进入确认阶段',
    );
  }
  return 'awaiting_confirmation';
}

/**
 * `awaiting_confirmation → confirmed`。
 *
 * `confirmedAt` 必须由调用方（服务端）提供当前时间，状态机不读时钟，
 * 从而在测试里可完全确定。重复确认不会在这里发生：服务端在调用前
 * 会先查同一探索是否已有项目实例（幂等重放）。
 */
export function confirmIntent(
  status: ExplorationStatus,
  draft: IntentDraftFields | null | undefined,
  confirmedAt: string,
): { status: 'confirmed'; draft: IntentDraftSnapshot } {
  if (status !== 'awaiting_confirmation') {
    throw transitionInvalid(status, 'confirmed');
  }
  if (!isIntentDraftConfirmable(draft)) {
    throw new IntentConfirmationError(
      'INTENT_DRAFT_INCOMPLETE',
      '候选意图尚未形成，不能确认',
    );
  }
  return {
    status: 'confirmed',
    draft: {
      goalUser: draft.goalUser,
      coreInterests: [...draft.coreInterests],
      preferredForm: draft.preferredForm,
      targetBeneficiary: draft.targetBeneficiary,
      confirmedAt,
    },
  };
}

/**
 * `exploring | awaiting_confirmation → closed`。
 *
 * 已确认的探索不允许关闭：一旦确认，项目实例已经（或即将）产生，
 * 关闭探索会造成「有项目但探索已关闭」的悬挂状态。
 */
export function closeExploration(status: ExplorationStatus): 'closed' {
  if (status === 'confirmed') {
    throw new IntentConfirmationError(
      'EXPLORATION_TRANSITION_INVALID',
      '已确认的探索不能关闭',
    );
  }
  if (status === 'closed') return 'closed';
  return 'closed';
}

function transitionInvalid(from: ExplorationStatus, to: ExplorationStatus): IntentConfirmationError {
  return new IntentConfirmationError(
    'EXPLORATION_TRANSITION_INVALID',
    `探索状态不允许迁移：${from} → ${to}`,
  );
}
