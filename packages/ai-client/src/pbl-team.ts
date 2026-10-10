import type {
  AdminTeamConfig,
  AdminTeamMember,
  PblPhase,
  PblPhaseSpec,
  PblTeamWorkflowSpec,
} from '@qitu/contracts';
import { BUILTIN_ASSISTANTS } from './assistant-registry.js';

export const THUNDER_FIGHTER_PHASES: readonly PblPhaseSpec[] = [
  {
    phase: 'exploration',
    title: '阶段一：项目兴趣启发与意图确认',
    assignedAssistantId: 'tutor-leader',
    assignedRoleLabel: '总导师',
    learningObjectives: [
      '明确雷霆战机小游戏的玩法目标与核心规则',
      '确认开发技术栈（Python 3 与 Pygame 库）',
      '学生主动确认项目开发意图并生成项目草案',
    ],
    gateCondition: 'student_confirmed_intent',
    deliverableType: 'project_intent_doc',
  },
  {
    phase: 'concept_mastery',
    title: '阶段二：核心原理探索与概念掌握（OpenMAIC 互动课堂）',
    assignedAssistantId: 'fighter-concept-coach',
    assignedRoleLabel: '原理教练',
    learningObjectives: [
      '掌握游戏循环机制（事件监听 -> 状态更新 -> 画面渲染）',
      '掌握屏幕笛卡尔坐标系统与边界限制算法',
      '理解键盘事件流（KEY_DOWN / KEY_UP）与速度向量',
      '掌握矩形相交（AABB 碰撞检测）的几何数学逻辑',
    ],
    gateCondition: 'TheoryMastered',
    deliverableType: 'mastery_checkpoint_report',
  },
  {
    phase: 'guided_practice',
    title: '阶段三：战机架构拆解与代码构建实践',
    assignedAssistantId: 'fighter-code-guide',
    assignedRoleLabel: '代码向导',
    learningObjectives: [
      '构建 Pygame 主窗口与核心帧率时钟（Clock）',
      '面向对象封装玩家战机类（Player Sprite）并绑定按键位移',
      '实现子弹精灵组（Bullet Group）与按键连续发射机制',
      '实现敌机生成器（Enemy Spawner）与随机下落算法',
      '实现子弹击中敌机判定与得分/生命值 HUD 界面',
    ],
    gateCondition: 'code_playable_run_verified',
    deliverableType: 'runnable_python_game',
  },
  {
    phase: 'deliverable_review',
    title: '阶段四：作品答辩评审与反思成长归档',
    assignedAssistantId: 'fighter-review-assessor',
    assignedRoleLabel: '评审导师',
    learningObjectives: [
      '完成代码规范性、可读性与结构性自查',
      '多维度作品评价（完成度、交互手感、创意加分项）',
      '针对开发调试中遭遇的 Bug 进行技术复盘',
      '生成个人项目成长档案并提交至班主任与家长端',
    ],
    gateCondition: 'review_completed_and_archived',
    deliverableType: 'growth_archive_record',
  },
];

export const THUNDER_FIGHTER_PBL_SPEC: PblTeamWorkflowSpec = {
  projectId: 'pbl-thunder-fighter',
  projectName: '雷霆战机：从零打造 Python 飞行射击小游戏',
  targetDomain: 'programming_game_dev',
  phases: THUNDER_FIGHTER_PHASES,
  theoryMasteredGate: true,
  allowAutonomousAdvance: false,
};

/* ------------------------------------------------------------------ *
 * Derived single source of truth for server-side PBL enforcement.
 *
 * Everything below is computed FROM `THUNDER_FIGHTER_PBL_SPEC` /
 * `THUNDER_FIGHTER_PHASES`; it is not a second copy. The API runtime
 * (`services/api/src/modules/team-runtime`) imports these symbols and
 * refuses phase transitions that violate them. Gates and phase order
 * therefore cannot be weakened by prompts or client payloads.
 * ------------------------------------------------------------------ */

/** Frozen phase order: exploration → concept_mastery → guided_practice → deliverable_review. */
export const PBL_PHASE_ORDER: readonly PblPhase[] = THUNDER_FIGHTER_PHASES.map((spec) => spec.phase);

/** Gate condition required to *complete* (advance out of) each phase, per the frozen spec. */
export const PBL_GATE_BY_PHASE: Record<PblPhase, string> = THUNDER_FIGHTER_PHASES.reduce(
  (acc, spec) => {
    acc[spec.phase] = spec.gateCondition;
    return acc;
  },
  {} as Record<PblPhase, string>,
);

/** Stable HTTP error codes per unsatisfied gate; names are part of the API contract. */
export const PBL_GATE_ERROR_CODES: Record<PblPhase, string> = {
  exploration: 'PBL_GATE_STUDENT_INTENT_REQUIRED',
  concept_mastery: 'PBL_GATE_THEORY_MASTERED_REQUIRED',
  guided_practice: 'PBL_GATE_CODE_RUN_NOT_VERIFIED',
  deliverable_review: 'PBL_GATE_REVIEW_NOT_ARCHIVED',
};

/** Other stable Team Runtime gate/ordering error codes. */
export const PBL_TEAM_ERROR_CODES = {
  PHASE_ORDER_INVALID: 'PBL_PHASE_ORDER_INVALID',
  PHASE_MISMATCH: 'TEAM_PHASE_MISMATCH',
  AUTONOMOUS_ADVANCE_FORBIDDEN: 'PBL_AUTONOMOUS_ADVANCE_FORBIDDEN',
  MENTOR_UNIQUENESS_CONFLICT: 'TEAM_MENTOR_UNIQUENESS_CONFLICT',
  /** F1：客户端在 POST /tutor/team-runs 的 context 里提交阶段/门禁字段。 */
  CONTEXT_RESERVED_KEY: 'TEAM_CONTEXT_RESERVED_KEY',
  /** F1：context 出现白名单以外的未知键（与 admin-ai-config assertKnownKeys 同风格）。 */
  CONTEXT_UNKNOWN_KEY: 'TEAM_CONTEXT_UNKNOWN_KEY',
  /** F1：context 不是对象。 */
  CONTEXT_INVALID: 'TEAM_CONTEXT_INVALID',
  /** 阶段枚举参数非法（delegate.pblPhase / advancePhase.targetPhase）。 */
  PHASE_INVALID: 'PBL_PHASE_INVALID',
  /** 非管理员/服务端试图写入门禁达成证据。 */
  GATE_WRITE_FORBIDDEN: 'TEAM_GATE_WRITE_FORBIDDEN',
  /** 提交的门禁条件不在冻结枚举内。 */
  GATE_UNKNOWN: 'PBL_GATE_UNKNOWN',
  /** T25：门禁证据必须携带非空 evidenceRef（trim 后长度 ≥ 8）。 */
  GATE_EVIDENCE_REQUIRED: 'PBL_GATE_EVIDENCE_REQUIRED',
  /** T25：source 缺失或不在该门禁的 source 白名单内。 */
  GATE_SOURCE_NOT_ALLOWED: 'PBL_GATE_SOURCE_NOT_ALLOWED',
} as const;

/** T25：evidenceRef 最短长度（trim 后）。防止空写/占位写。 */
export const PBL_GATE_EVIDENCE_REF_MIN_LENGTH = 8;

/**
 * T25：门禁写入方身份白名单，按 gate 细分（服务端常量表，唯一真源）。
 *
 * admin HTTP 端点（POST /admin/agent-runs/:runId/gates）与内部通道
 * （recordGateForStudent / 账本冲刷的写入方 projects/works/learning-plan/mentor）
 * 必须使用同一张表：不在对应 gate 的允许集合内 → 400 PBL_GATE_SOURCE_NOT_ALLOWED。
 * 取值清单（与 T15/T16/T17/T23 接线点逐一核对）：
 * - projects.confirm-intent        → projects.service.ts 确认意图（T15）
 * - learning-plan.theory-mastered  → learning-plan 理论掌握（T16）
 * - works.publish-approved         → works 发布评审通过（T17）
 * - mentor_review                  → 班主任人工确认（T23b）
 * - runner                         → 自动运行验证器（code_playable_run_verified 专用）
 * - server_backfill                → 服务端存量回填（运维，admin-only）
 */
export const PBL_GATE_SOURCE_WHITELIST: Record<string, readonly string[]> = {
  student_confirmed_intent: ['projects.confirm-intent', 'mentor_review', 'server_backfill'],
  TheoryMastered: ['learning-plan.theory-mastered', 'mentor_review', 'server_backfill'],
  code_playable_run_verified: ['mentor_review', 'runner', 'server_backfill'],
  review_completed_and_archived: ['works.publish-approved', 'mentor_review', 'server_backfill'],
};

/**
 * F1（独立验证官）修复：`run.context.phase` 是门禁的权威读取源，因此它
 * 只能由服务端初始化（startRun）与推进（advancePhase）。客户端提交的
 * Team Run `context` 必须过下面的键白名单：
 *
 * - `TEAM_RUN_CONTEXT_RESERVED_KEYS`：任何阶段/门禁状态字段，出现即 400
 *   `TEAM_CONTEXT_RESERVED_KEY`（不落库）。
 * - `TEAM_RUN_CONTEXT_ALLOWED_KEYS`：只允许的非状态字段（观测/溯源用）。
 *   `turnCount` / `pedagogicMove` 是既有 AI 搭档链路（tutor.service.ts
 *   executeTurn）已经在传的服务端派生观测字段，必须保留；
 *   `intentDraftId` / `topic` / `source` 为意图草稿与溯源非状态字段。
 * - 其余未知键 → 400 `TEAM_CONTEXT_UNKNOWN_KEY`。
 */
export const TEAM_RUN_CONTEXT_RESERVED_KEYS: readonly string[] = [
  'phase',
  'pblPhase',
  'gates',
  'gate',
  'gateEvidence',
  'satisfiedGates',
  'theoryMastered',
  'theoryMasteredGate',
  'allowAutonomousAdvance',
  'pblSpec',
  'context',
] as const;

export const TEAM_RUN_CONTEXT_ALLOWED_KEYS: readonly string[] = [
  'turnCount',
  'pedagogicMove',
  'intentDraftId',
  'topic',
  'source',
] as const;

/**
 * 服务端初始化的首阶段（冻结顺序的第一项）。「阶段缺失」必须被视为还在
 * 首阶段（探索），绝不能被当作「已走到终点」而绕过门禁。
 */
export const PBL_INITIAL_PHASE: PblPhase = PBL_PHASE_ORDER[0] as PblPhase;

/**
 * Hard rule from the frozen spec: autonomous advance past gates is disabled.
 * The server must reject every `trigger: 'autonomous'` advance attempt.
 */
export const PBL_AUTONOMOUS_ADVANCE_ALLOWED: boolean = THUNDER_FIGHTER_PBL_SPEC.allowAutonomousAdvance === true;

/** Assistant id that owns each phase (from the frozen spec, for delegation labels). */
export const PBL_ASSISTANT_BY_PHASE: Record<PblPhase, string> = THUNDER_FIGHTER_PHASES.reduce(
  (acc, spec) => {
    acc[spec.phase] = spec.assignedAssistantId;
    return acc;
  },
  {} as Record<PblPhase, string>,
);

export function isPblPhase(value: unknown): value is PblPhase {
  return typeof value === 'string' && (PBL_PHASE_ORDER as readonly string[]).includes(value);
}

export function pblPhaseIndex(phase: PblPhase): number {
  return PBL_PHASE_ORDER.indexOf(phase);
}

/** Next phase in the frozen order, or null when the phase is terminal. */
export function nextPblPhase(phase: PblPhase): PblPhase | null {
  const index = pblPhaseIndex(phase);
  if (index < 0 || index >= PBL_PHASE_ORDER.length - 1) return null;
  const next = PBL_PHASE_ORDER[index + 1];
  return next === undefined ? null : next;
}

/**
 * Gates that must already be satisfied before a student may *operate inside*
 * `phase`: the gate conditions of every earlier phase in the frozen order.
 * Entering `guided_practice` therefore requires `student_confirmed_intent`
 * AND `TheoryMastered` (AGENTS.md: 理论未掌握不得进入实践).
 */
export function pblGatesRequiredToEnter(phase: PblPhase): string[] {
  const index = pblPhaseIndex(phase);
  if (index < 0) return [];
  return PBL_PHASE_ORDER.slice(0, index).map((earlier) => PBL_GATE_BY_PHASE[earlier]);
}

export const THUNDER_FIGHTER_TEAM_MEMBERS: readonly AdminTeamMember[] = [
  {
    slotId: 'slot-leader',
    assistantId: 'tutor-leader',
    assistantName: '启途总导师',
    role: 'leader',
    roleLabel: '总导师 (流程推进与意图把控)',
    avatar: '👨‍🏫',
    status: 'active',
    model: 'qwen3.8-flash',
    color: 'var(--brand)',
    pblPhase: 'exploration',
  },
  {
    slotId: 'slot-concept',
    assistantId: 'fighter-concept-coach',
    assistantName: '战机原理与概念教练',
    role: 'coach',
    roleLabel: '概念教练 (OpenMAIC 核心原理解析)',
    avatar: '🕹️',
    status: 'idle',
    model: 'qwen3.8-flash',
    color: '#5c9ea4',
    pblPhase: 'concept_mastery',
  },
  {
    slotId: 'slot-code',
    assistantId: 'fighter-code-guide',
    assistantName: '战机架构与代码向导',
    role: 'teammate',
    roleLabel: '代码向导 (Pygame 分步阶梯实践)',
    avatar: '💻',
    status: 'idle',
    model: 'qwen3.8-flash',
    color: '#b58a5e',
    pblPhase: 'guided_practice',
  },
  {
    slotId: 'slot-review',
    assistantId: 'fighter-review-assessor',
    assistantName: '成果评审与答辩导师',
    role: 'reviewer',
    roleLabel: '评审导师 (代码自评与成长归档)',
    avatar: '🏆',
    status: 'idle',
    model: 'qwen3.8-flash',
    color: '#9481bf',
    pblPhase: 'deliverable_review',
  },
];

export const THUNDER_FIGHTER_TEAM_CONFIG: AdminTeamConfig = {
  id: 'team-thunder-fighter-pbl',
  name: '雷霆战机小游戏 PBL 导师团队',
  description:
    '面向雷霆战机小游戏设计的专属多智能体协同导师团队。融合 OpenMAIC 互动课堂理念，引导学生完成从兴趣启发、概念探索、代码构建到作品答辩的全流程。',
  workspaceMode: 'shared',
  sessionMode: 'supervised',
  leaderAssistantId: 'tutor-leader',
  members: THUNDER_FIGHTER_TEAM_MEMBERS,
  concurrencyLimit: 2,
  pblSpec: THUNDER_FIGHTER_PBL_SPEC,
  enabled: true,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-09T00:00:00.000Z',
};

export class TeamOrchestrator {
  private readonly teams = new Map<string, AdminTeamConfig>();

  constructor(initialTeams: readonly AdminTeamConfig[] = [THUNDER_FIGHTER_TEAM_CONFIG]) {
    for (const t of initialTeams) {
      this.teams.set(t.id, { ...t });
    }
  }

  list(): AdminTeamConfig[] {
    return Array.from(this.teams.values());
  }

  get(id: string): AdminTeamConfig | undefined {
    const found = this.teams.get(id);
    return found ? { ...found } : undefined;
  }

  register(team: AdminTeamConfig): AdminTeamConfig {
    if (this.teams.has(team.id)) {
      throw new Error(`TEAM_ALREADY_EXISTS: ${team.id}`);
    }
    const created = {
      ...team,
      createdAt: team.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.teams.set(created.id, created);
    return { ...created };
  }

  update(id: string, patch: Partial<AdminTeamConfig>): AdminTeamConfig {
    const existing = this.teams.get(id);
    if (!existing) {
      throw new Error(`TEAM_NOT_FOUND: ${id}`);
    }
    const updated: AdminTeamConfig = {
      ...existing,
      ...patch,
      id: existing.id,
      updatedAt: new Date().toISOString(),
    };
    this.teams.set(id, updated);
    return { ...updated };
  }

  /**
   * Check if a PBL project can advance to practice phase.
   * Hard Rule: TheoryMastered must be achieved prior to entering guided practice.
   */
  canAdvanceToPractice(masteryAchieved: boolean): boolean {
    return masteryAchieved === true;
  }

  /**
   * Resolve which assistant in the team handles a given PBL phase.
   */
  resolveAssistantForPhase(teamId: string, phase: PblPhase): string {
    const team = this.get(teamId);
    if (!team) return 'tutor-leader';
    const member = team.members.find((m: AdminTeamMember) => m.pblPhase === phase);
    return member?.assistantId ?? team.leaderAssistantId;
  }
}

export function createTeamOrchestrator(
  initial?: readonly AdminTeamConfig[],
): TeamOrchestrator {
  return new TeamOrchestrator(initial);
}
