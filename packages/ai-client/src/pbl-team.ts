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
