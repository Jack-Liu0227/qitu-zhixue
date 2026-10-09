/**
 * 团队流式帧（`team.*`）的集中常量与「帧 → 学生可读回复块」映射。
 *
 * 帧名字面量与服务端 `TEAM_FRAME_NAMES` 逐字一致，出处：
 *   services/api/src/modules/team-runtime/team-runtime.service.ts
 *   （`TEAM_FRAME_NAMES` 常量表；SSE 写入点见
 *    services/api/src/modules/ai-tutor/tutor.controller.ts `writeTeamFrame`）。
 * 服务端新增/改名帧类型时，这里必须同步（服务端 protocol 测试同样约束）。
 *
 * 设计约束（T7 / 独立验证官 F5）：
 * - 学生端**必须消费**这 5 类帧，不得静默丢弃；
 * - 只借用已冻结的 `TutorReplyBlock` 联合中的既有块型（pbl_card / tool / think），
 *   不改 `@qitu/contracts`、不新增假数据、不做任何静默回退；
 * - 载荷字段名逐字对齐服务端 `buildTeamFrameData` + `writeTeamFrame` 实际写入的
 *   扁平键（phase / previousPhase / attemptedPhase / requiredGate / errorCode /
 *   recipientAgentId / taskType / status / pblPhase / ownerAssistantId /
 *   passedGate / frameId 等），字段缺失或非法时返回 null，由解析器按既有
 *   「malformed frame is dropped」防御风格处理——这是格式校验失败，不是吞帧。
 */
import type { TutorReplyBlock } from '@qitu/contracts';

/** 与服务端 TEAM_FRAME_NAMES 逐字一致的 5 个流式帧名。 */
export const TUTOR_TEAM_FRAME_NAMES = {
  phase_advanced: 'team.phase_advanced',
  gate_blocked: 'team.gate_blocked',
  member_delegated: 'team.member_delegated',
  tool_invoked: 'team.tool_invoked',
  thinking: 'team.thinking',
} as const;

export type TutorTeamFrameKind = keyof typeof TUTOR_TEAM_FRAME_NAMES;

const TEAM_FRAME_NAME_BY_KIND: Record<TutorTeamFrameKind, string> = TUTOR_TEAM_FRAME_NAMES;

const TEAM_FRAME_KIND_BY_NAME: ReadonlyMap<string, TutorTeamFrameKind> = new Map(
  Object.entries(TEAM_FRAME_NAME_BY_KIND) as [string, TutorTeamFrameKind][],
);

export function teamFrameKind(name: string): TutorTeamFrameKind | null {
  return TEAM_FRAME_KIND_BY_NAME.get(name) ?? null;
}

/** 所有 team.* 帧名（供解析器 KNOWN_FRAMES 收录，集中一处、不散落）。 */
export const TUTOR_TEAM_FRAME_NAME_LIST: readonly string[] = Object.values(
  TUTOR_TEAM_FRAME_NAMES,
);

/* ------------------------------------------------------------------ */
/*  阶段 / 门禁 / 错误码 → 学生可读中文                                 */
/* ------------------------------------------------------------------ */

type PblPhaseZh = 'exploration' | 'concept_mastery' | 'guided_practice' | 'deliverable_review';

/** 冻结四阶段顺序（服务端 PBL_PHASE_ORDER；展示语义同 PblStageCard.PHASE_NAMES）。 */
const PBL_PHASE_ORDER: readonly PblPhaseZh[] = [
  'exploration',
  'concept_mastery',
  'guided_practice',
  'deliverable_review',
];

const PBL_PHASE_LABELS: Record<PblPhaseZh, string> = {
  exploration: '项目意图（探索与确认）',
  concept_mastery: '核心原理（理论掌握）',
  guided_practice: '代码实践（动手构建）',
  deliverable_review: '成果答辩（评审与归档）',
};

/** 门禁条件名 → 学生可读中文（服务端 gateCondition 字面量）。 */
const GATE_LABELS: Record<string, string> = {
  student_confirmed_intent: '学生已确认学习意图',
  TheoryMastered: '理论掌握测评通过',
  code_playable_run_verified: '作品可运行且通过验证',
  review_completed_and_archived: '完成成果答辩并归档',
};

/** 稳定错误码 → 学生可读中文（保留 code 便于排查；出处 @qitu/ai-client pbl-team.ts）。 */
const ERROR_CODE_MESSAGES: Record<string, string> = {
  PBL_GATE_STUDENT_INTENT_REQUIRED: '还没有确认这一轮的学习意图，先把想法和 AI 搭档说清楚，才能继续推进。',
  PBL_GATE_THEORY_MASTERED_REQUIRED: '理论测评还没通过，暂时不能进入动手实践阶段——先把核心概念吃透，这是不可跳过的硬门禁。',
  PBL_GATE_CODE_RUN_NOT_VERIFIED: '实践作品还没有通过可运行验证，暂时不能进入成果答辩。',
  PBL_GATE_REVIEW_NOT_ARCHIVED: '答辩与成长档案还没有归档完成。',
  PBL_PHASE_ORDER_INVALID: '阶段只能按「意图 → 理论 → 实践 → 答辩」的固定顺序推进，不能跳级。',
  PBL_AUTONOMOUS_ADVANCE_FORBIDDEN: '系统不会自动越过门禁推进阶段，需要你和服务端确认达成条件。',
  TEAM_PHASE_MISMATCH: '团队阶段状态与请求不一致，已按服务端当前阶段呈现。',
};

function gateLabelZh(gate: string | null): string {
  if (gate === null) return '下一道门禁条件';
  return GATE_LABELS[gate] ?? `门禁「${gate}」`;
}

function phaseLabelZh(phase: string | null): string {
  if (phase !== null && phase in PBL_PHASE_LABELS) {
    return PBL_PHASE_LABELS[phase as PblPhaseZh];
  }
  return phase !== null ? `阶段（${phase}）` : '下一阶段';
}

function phaseProgressTag(phase: PblPhaseZh): string {
  return `阶段 ${PBL_PHASE_ORDER.indexOf(phase) + 1}/${PBL_PHASE_ORDER.length}`;
}

function normalizePhase(value: unknown): PblPhaseZh | null {
  return typeof value === 'string' && (PBL_PHASE_ORDER as readonly string[]).includes(value)
    ? (value as PblPhaseZh)
    : null;
}

function readString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/* ------------------------------------------------------------------ */
/*  帧 → TutorReplyBlock（复用冻结块型：pbl_card / tool / think）      */
/* ------------------------------------------------------------------ */

/** 团队委派/工具调用的生命周期状态映射为时间线三态（不发明状态）。 */
function taskStatusToCallStatus(status: string | null): 'running' | 'done' | 'error' {
  switch (status) {
    case 'succeeded':
    case 'completed':
      return 'done';
    case 'failed':
    case 'cancelled':
    case 'timed_out':
      return 'error';
    default:
      return 'running';
  }
}

/**
 * 把一帧团队事件转成学生可读的回复块。
 * 返回 null 仅发生在必需字段缺失/非法时（防御性丢弃坏帧）。
 */
export function teamFrameToReplyBlock(
  kind: TutorTeamFrameKind,
  payload: Record<string, unknown>,
  frameId: string,
): TutorReplyBlock | null {
  switch (kind) {
    case 'phase_advanced': {
      const phase = normalizePhase(payload['phase']);
      if (phase === null) return null;
      const passedGate = readString(payload, 'passedGate');
      const owner = readString(payload, 'ownerAssistantId');
      const previousPhase = normalizePhase(payload['previousPhase']);
      const fromNote = previousPhase !== null ? `从「${phaseLabelZh(previousPhase)}」推进。` : '';
      return {
        kind: 'pbl_card',
        phase,
        title: '团队推进到新阶段',
        ...(owner !== null ? { teammateLabel: `负责助手：${owner}` } : {}),
        summary:
          `已进入 ${phaseLabelZh(phase)}（第 ${PBL_PHASE_ORDER.indexOf(phase) + 1} / ${PBL_PHASE_ORDER.length} 阶段）。` +
          (passedGate !== null ? `${fromNote}上一门禁「${gateLabelZh(passedGate)}」已由服务端确认达成。` : fromNote),
        tags: [phaseProgressTag(phase), ...(passedGate !== null ? [`gate:${passedGate}`] : [])],
      };
    }
    case 'gate_blocked': {
      const attempted =
        normalizePhase(payload['attemptedPhase']) ?? normalizePhase(payload['phase']);
      // 服务端两个 gate_blocked 写入点都携带合法阶段字段（advancePhase 带
      // attemptedPhase，delegate 带 phase）；缺失即视为坏帧，按既有防御约定丢弃，
      // 不用默认阶段假装渲染。
      if (attempted === null) return null;
      const requiredGate = readString(payload, 'requiredGate');
      const errorCode = readString(payload, 'errorCode');
      const studentMessage =
        (errorCode !== null ? ERROR_CODE_MESSAGES[errorCode] : undefined) ??
        `需要先达成「${gateLabelZh(requiredGate)}」，才能进入${phaseLabelZh(attempted)}。`;
      return {
        kind: 'pbl_card',
        phase: attempted,
        title: '暂时不能进入下一阶段',
        summary: studentMessage,
        tags: [
          ...(errorCode !== null ? [errorCode] : []),
          ...(requiredGate !== null ? [`需要：${requiredGate}`] : []),
        ],
      };
    }
    case 'member_delegated': {
      const recipient = readString(payload, 'recipientAgentId');
      const taskType = readString(payload, 'taskType');
      const status = readString(payload, 'status');
      return {
        kind: 'tool',
        call: {
          callId: frameId,
          name: 'team.member_delegated',
          label:
            `已委派给团队助手${recipient !== null ? `「${recipient}」` : ''}` +
            (taskType !== null ? `处理任务「${taskType}」` : ''),
          status: taskStatusToCallStatus(status),
        },
      };
    }
    case 'tool_invoked': {
      const toolName = readString(payload, 'name') ?? readString(payload, 'label');
      const taskType = readString(payload, 'taskType');
      return {
        kind: 'tool',
        call: {
          callId: frameId,
          name: 'team.tool_invoked',
          label:
            `团队正在调用工具${toolName !== null ? `「${toolName}」` : ''}` +
            (taskType !== null ? `（任务：${taskType}）` : ''),
          status: taskStatusToCallStatus(readString(payload, 'status')),
        },
      };
    }
    case 'thinking': {
      const phase = normalizePhase(payload['phase']) ?? readString(payload, 'phaseLabel');
      // 服务端只暴露阶段标签、不暴露思考原文（脱敏），这里如实呈现这一点。
      return {
        kind: 'think',
        content:
          `团队协同思考中${phase !== null ? `（当前聚焦：${phaseLabelZh(phase)}）` : ''}` +
          '。服务端仅下发阶段标签，思考原文不出前端脱敏范围。',
        closed: true,
      };
    }
    default: {
      const neverKind: never = kind;
      void neverKind;
      return null;
    }
  }
}
