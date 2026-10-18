import type { PblPhase } from './team-runtime.js';

export type SessionType = 'theory' | 'practice' | 'review';
export type PlanSessionCount = 4 | 8 | 16;
export const SESSION_COUNT_OPTIONS: readonly PlanSessionCount[] = [4, 8, 16];

export interface SessionBlockSpec {
  review: number;   // 复习导入 (分钟)
  theory: number;   // 核心概念探讨 (分钟)
  check: number;    // 测验与迷思排查 (分钟)
  practice: number; // 动态仿真/实践测量 (分钟)
  reflect: number;  // 认知反思 (分钟)
}

export interface InteractiveSpec {
  enabled: boolean;
  domainTopic: string;
  allowHypothesisPrediction: boolean;
}

export interface TemplateSessionSpec {
  sessionIndex: number; // 1 ~ 16
  title: string;
  phase: PblPhase;
  sessionType: SessionType;
  objectiveIds: string[];
  durationMinutes?: number;
  blocks: SessionBlockSpec;
  gateCondition?: 'TheoryMastered' | 'experiment_report_validated' | 'review_completed_and_archived' | string;
  interactiveSpec?: InteractiveSpec;
}

export interface ProjectTemplateTheme {
  title: string;
  domain: 'physics_optics' | 'physics_mechanics' | 'physics_electromagnetism' | string;
  targetAgeRange: { min: number; max: number };
  drivingQuestion: string;
  prerequisites: string[];
  safetyRequirements: string[];
  finalDeliverableType: 'experiment_inquiry_report' | 'engineering_design_doc' | string;
  rubricId: string;
}

export interface ImaKnowledgeIntegration {
  serverId: 'ima-knowledge';
  knowledgeBaseIds: string[];
  allowedTools: readonly string[];
}

export interface RolePhaseMap {
  exploration: string;
  concept_mastery: string;
  guided_practice: string;
  deliverable_review: string;
}

export interface TeamMemberAgent {
  agentId: string;
  role: string;
  assignedPhase: PblPhase;
  promptTemplate?: string;
  modelProviderId?: string | null;
  modelId?: string | null;
}

export interface DeepTeamBinding {
  bindingId: string;
  templateVersionId: string;
  teamVersionId: string;
  roleMap: RolePhaseMap;
  imaMcpGrant: ImaKnowledgeIntegration;
  bindingHash: string;
}

export interface RefactoredProjectTemplateSpec {
  specVersion: '2.0';
  id: string;
  slug: string;
  theme: ProjectTemplateTheme;
  curriculum: {
    totalSessions: number;
    sessionMinutes: number;
    sessions: TemplateSessionSpec[];
  };
  bindingTarget: {
    teamSlug: string;
    knowledgeConfig: {
      mcpServerId: 'ima-knowledge';
      knowledgeBaseIds: string[];
    };
  };
}

/** 16 课时阶段与智能体角色映射矩阵 */
export const SESSION_PHASE_ROLE_MAPPING = {
  exploration: {
    sessions: [1, 2],
    role: 'lead_tutor',
    roleLabel: '主导导师 Agent',
    mission: 'Inspire Curiosity & Plan Framing',
  },
  concept_mastery: {
    sessions: [3, 4, 5, 6, 7, 8],
    role: 'concept_coach',
    roleLabel: '概念教练 Agent',
    mission: 'Socratic Ladder & Misconception Remediation',
    gate: 'TheoryMastered',
  },
  guided_practice: {
    sessions: [9, 10, 11, 12, 13, 14],
    role: 'lab_guide',
    roleLabel: '实验向导 Agent',
    mission: 'Generative Canvas Control & CER Analysis',
    gate: 'experiment_report_validated',
  },
  deliverable_review: {
    sessions: [15, 16],
    role: 'review_assessor',
    roleLabel: '评审导师 Agent',
    mission: 'Rubric Evaluation & Growth Archiving',
    gate: 'review_completed_and_archived',
  },
} as const;

/** 根据课时序号获取其所属阶段与角色 */
export function getPhaseAndRoleForSession(sessionIndex: number): {
  phase: PblPhase;
  role: string;
  roleLabel: string;
  mission: string;
  isGateSession: boolean;
  gateCondition?: string;
} {
  if (sessionIndex >= 1 && sessionIndex <= 2) {
    return {
      phase: 'exploration',
      role: SESSION_PHASE_ROLE_MAPPING.exploration.role,
      roleLabel: SESSION_PHASE_ROLE_MAPPING.exploration.roleLabel,
      mission: SESSION_PHASE_ROLE_MAPPING.exploration.mission,
      isGateSession: sessionIndex === 2,
      gateCondition: 'student_confirmed_intent',
    };
  }
  if (sessionIndex >= 3 && sessionIndex <= 8) {
    return {
      phase: 'concept_mastery',
      role: SESSION_PHASE_ROLE_MAPPING.concept_mastery.role,
      roleLabel: SESSION_PHASE_ROLE_MAPPING.concept_mastery.roleLabel,
      mission: SESSION_PHASE_ROLE_MAPPING.concept_mastery.mission,
      isGateSession: sessionIndex === 8,
      gateCondition: 'TheoryMastered',
    };
  }
  if (sessionIndex >= 9 && sessionIndex <= 14) {
    return {
      phase: 'guided_practice',
      role: SESSION_PHASE_ROLE_MAPPING.guided_practice.role,
      roleLabel: SESSION_PHASE_ROLE_MAPPING.guided_practice.roleLabel,
      mission: SESSION_PHASE_ROLE_MAPPING.guided_practice.mission,
      isGateSession: sessionIndex === 14,
      gateCondition: 'experiment_report_validated',
    };
  }
  return {
    phase: 'deliverable_review',
    role: SESSION_PHASE_ROLE_MAPPING.deliverable_review.role,
    roleLabel: SESSION_PHASE_ROLE_MAPPING.deliverable_review.roleLabel,
    mission: SESSION_PHASE_ROLE_MAPPING.deliverable_review.mission,
    isGateSession: sessionIndex === 16,
    gateCondition: 'review_completed_and_archived',
  };
}

/** 16 课时光学探究标准模板定义 (Spec v2.0) */
export const OPTICS_16_SESSION_SPEC: RefactoredProjectTemplateSpec = {
  specVersion: '2.0',
  id: 'tpl-physics-optics-16s',
  slug: 'physics-optics-inquiry',
  theme: {
    title: '探究光的路径与波动本质：从几何光学到散射衍射全流程',
    domain: 'physics_optics',
    targetAgeRange: { min: 13, max: 18 },
    drivingQuestion: '光为什么会在水面弯折、在光纤里全反射传输，并在微孔和烟雾中展现波动衍射与散射？',
    prerequisites: ['平面几何与角度计算', '波动基础概念与频率波长关系'],
    safetyRequirements: ['激光笔严禁直射人眼', '强光实验佩戴护目镜', '玻璃光学元件轻拿轻放'],
    finalDeliverableType: 'experiment_inquiry_report',
    rubricId: 'rubric-optics-inquiry-v2',
  },
  curriculum: {
    totalSessions: 16,
    sessionMinutes: 60,
    sessions: [
      {
        sessionIndex: 1,
        title: '现象观察与光学奇观：天际蓝天与水下折光',
        phase: 'exploration',
        sessionType: 'theory',
        objectiveIds: ['opt-intent-observe'],
        blocks: { review: 5, theory: 25, check: 10, practice: 15, reflect: 5 },
      },
      {
        sessionIndex: 2,
        title: '问题聚焦与探究意向书确认',
        phase: 'exploration',
        sessionType: 'theory',
        objectiveIds: ['opt-intent-question'],
        blocks: { review: 5, theory: 20, check: 10, practice: 20, reflect: 5 },
        gateCondition: 'student_confirmed_intent',
      },
      {
        sessionIndex: 3,
        title: '光线模型与光的反射定律探究',
        phase: 'concept_mastery',
        sessionType: 'theory',
        objectiveIds: ['opt-theory-reflection'],
        blocks: { review: 10, theory: 25, check: 10, practice: 10, reflect: 5 },
      },
      {
        sessionIndex: 4,
        title: '平面镜成像规律与虚像几何作图',
        phase: 'concept_mastery',
        sessionType: 'theory',
        objectiveIds: ['opt-theory-reflection'],
        blocks: { review: 10, theory: 20, check: 15, practice: 10, reflect: 5 },
      },
      {
        sessionIndex: 5,
        title: '光的折射定律（斯涅尔定律）与介质光速',
        phase: 'concept_mastery',
        sessionType: 'theory',
        objectiveIds: ['opt-theory-refraction'],
        blocks: { review: 10, theory: 25, check: 10, practice: 10, reflect: 5 },
      },
      {
        sessionIndex: 6,
        title: '全反射临界角与光纤通信物理原理',
        phase: 'concept_mastery',
        sessionType: 'theory',
        objectiveIds: ['opt-theory-tir'],
        blocks: { review: 10, theory: 25, check: 10, practice: 10, reflect: 5 },
      },
      {
        sessionIndex: 7,
        title: '透镜三条特殊光线与实像/虚像变换',
        phase: 'concept_mastery',
        sessionType: 'theory',
        objectiveIds: ['opt-theory-lens'],
        blocks: { review: 10, theory: 25, check: 10, practice: 10, reflect: 5 },
      },
      {
        sessionIndex: 8,
        title: '几何光学核心定律综合测验与概念诊断（TheoryMastered 硬门禁）',
        phase: 'concept_mastery',
        sessionType: 'review',
        objectiveIds: ['opt-theory-reflection', 'opt-theory-refraction', 'opt-theory-tir', 'opt-theory-lens'],
        blocks: { review: 10, theory: 10, check: 30, practice: 5, reflect: 5 },
        gateCondition: 'TheoryMastered',
      },
      {
        sessionIndex: 9,
        title: '光学虚拟台光路搭建与仪器校准',
        phase: 'guided_practice',
        sessionType: 'practice',
        objectiveIds: ['opt-practice-setup'],
        blocks: { review: 5, theory: 10, check: 5, practice: 35, reflect: 5 },
        interactiveSpec: { enabled: true, domainTopic: 'optical_bench_setup', allowHypothesisPrediction: true },
      },
      {
        sessionIndex: 10,
        title: '单缝衍射图样测量与条纹宽度变量采集',
        phase: 'guided_practice',
        sessionType: 'practice',
        objectiveIds: ['opt-practice-measure'],
        blocks: { review: 5, theory: 10, check: 5, practice: 35, reflect: 5 },
        interactiveSpec: { enabled: true, domainTopic: 'diffraction_slit', allowHypothesisPrediction: true },
      },
      {
        sessionIndex: 11,
        title: '微粒介质散射效应与瑞利/米氏散射对比仿真',
        phase: 'guided_practice',
        sessionType: 'practice',
        objectiveIds: ['opt-practice-measure'],
        blocks: { review: 5, theory: 10, check: 5, practice: 35, reflect: 5 },
        interactiveSpec: { enabled: true, domainTopic: 'particle_scattering', allowHypothesisPrediction: true },
      },
      {
        sessionIndex: 12,
        title: '波长-缝宽-屏距多变量数据拟合与误差分析',
        phase: 'guided_practice',
        sessionType: 'practice',
        objectiveIds: ['opt-practice-fit'],
        blocks: { review: 5, theory: 15, check: 10, practice: 25, reflect: 5 },
      },
      {
        sessionIndex: 13,
        title: 'CER 科学论证构建：主张、证据与推理结构',
        phase: 'guided_practice',
        sessionType: 'practice',
        objectiveIds: ['opt-practice-report'],
        blocks: { review: 5, theory: 20, check: 10, practice: 20, reflect: 5 },
      },
      {
        sessionIndex: 14,
        title: '完整物理探究实验报告撰写与校验（报告门禁）',
        phase: 'guided_practice',
        sessionType: 'practice',
        objectiveIds: ['opt-practice-report'],
        blocks: { review: 5, theory: 10, check: 10, practice: 30, reflect: 5 },
        gateCondition: 'experiment_report_validated',
      },
      {
        sessionIndex: 15,
        title: '同行盲审、质疑答辩与科学反思',
        phase: 'deliverable_review',
        sessionType: 'review',
        objectiveIds: ['opt-review-defend'],
        blocks: { review: 5, theory: 10, check: 15, practice: 25, reflect: 5 },
      },
      {
        sessionIndex: 16,
        title: '项目总结陈述、素养雷达评估与成长档案归档',
        phase: 'deliverable_review',
        sessionType: 'review',
        objectiveIds: ['opt-review-reflect'],
        blocks: { review: 5, theory: 15, check: 10, practice: 15, reflect: 15 },
        gateCondition: 'review_completed_and_archived',
      },
    ],
  },
  bindingTarget: {
    teamSlug: 'team-optics-inquiry',
    knowledgeConfig: {
      mcpServerId: 'ima-knowledge',
      knowledgeBaseIds: ['high-school-physics-optics', 'high-school-physics-motion'],
    },
  },
};
