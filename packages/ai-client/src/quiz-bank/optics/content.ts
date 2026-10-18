import type {
  EvidenceProfile,
  GateConditionId,
  KnowledgeType,
  PblObjectiveKind,
  PblPhase,
  PblTemplateObjective,
  PblTemplatePhase,
  PblTemplateSchedule,
  ProjectTemplateSpec,
} from '@qitu/contracts';
import { PBL_LEARNING_CONTRACT_VERSION } from '@qitu/contracts';

/**
 * 光学 PBL 内容层（单一真源）。
 *
 * 本文件是「4 个理论概念 + 3 个质化波动模块 + 完整 4 阶段目标树」的内容注册表，
 * 被三处消费：
 * 1. `quiz-bank/index.ts` —— 题库条目 `conceptId` 与 `misconceptionTag` 的合法域；
 * 2. `services/api/src/modules/templates/content/optics.ts` —— 模板/版本定义；
 * 3. 内容不变量测试。
 *
 * 类型策略（pedagogy-spec §4，硬约束）：
 * - 门禁承载（`concept_mastery`）目标必须全部可被确定性判分打开，
 *   即 `knowledgeType ∈ { memory, procedure }`；
 * - `concept` / `design` 目标（含三个波动模块）是质化目标，永不做门禁承载；
 * - `reflection` 在 `KnowledgeType` 中不存在，`knowledgeType` 为 `null`，永不判分、
 *   永不做门禁承载。
 *
 * 注意：`PblObjectiveKind` 没有 `memory`。记忆型目标（陈述定律/公式）在 PBL
 * 目标分类里归 `concept`，其「可量化判分」身份由独立的 `knowledgeType: 'memory'`
 * 表达（`learning-plan` 的 `KnowledgeType` 才是掌握度引擎读取的判分依据）。
 */

/* ============================ 理论概念层 ============================ */

export type GatedKnowledgeType = Extract<KnowledgeType, 'memory' | 'procedure'>;
export type QualitativeKnowledgeType = Extract<KnowledgeType, 'concept' | 'design'>;

export interface OpticsTheoryConcept {
  /** 模板目标 id（门禁承载）。 */
  objectiveId: string;
  /** 题库 / 掌握度的知识键（`optics.*` 点分命名空间）。 */
  conceptId: string;
  knowledgeType: GatedKnowledgeType;
  title: string;
  description: string;
}

/** 4 个门禁承载理论概念：memory ×3 + procedure ×1（先理论后实践，缺一不可）。 */
export const OPTICS_THEORY_CONCEPTS: readonly OpticsTheoryConcept[] = [
  {
    objectiveId: 'opt-theory-reflection',
    conceptId: 'optics.reflection.law',
    knowledgeType: 'memory',
    title: '反射定律：三线共面、法线基准、角相等、光路可逆',
    description:
      '能陈述反射定律（入射角=反射角，均相对法线；三线共面），并说明平面镜成正立等大虚像。',
  },
  {
    objectiveId: 'opt-theory-refraction',
    conceptId: 'optics.refraction.law',
    knowledgeType: 'memory',
    title: '折射定律与折射率 n = c/v',
    description:
      '能陈述折射定律（n₁sinθ₁ = n₂sinθ₂）与折射率定义，判断光疏↔光密时折射角相对法线的偏向。',
  },
  {
    objectiveId: 'opt-theory-tir',
    conceptId: 'optics.tir.critical_angle',
    knowledgeType: 'memory',
    title: '全反射条件与临界角 sinC = n₂/n₁',
    description: '能写出全反射条件与临界角公式，判断哪些界面组合可能发生全反射。',
  },
  {
    objectiveId: 'opt-theory-lens',
    conceptId: 'optics.lens.ray_rules',
    knowledgeType: 'procedure',
    title: '薄透镜三条特殊光线与作图定像',
    description: '能用三条特殊光线作图定像，并按 u 与 2f/f 的关系判断像的性质。',
  },
];

/* ============================ 波动光学质化模块层 ============================ */

export interface OpticsWaveModule {
  moduleId: string;
  conceptId: string;
  knowledgeType: QualitativeKnowledgeType;
  title: string;
  description: string;
  /** 显式标记：波动模块是质化模块，永不做门禁承载 / 判分。 */
  gradingGated: false;
}

/** Evidence-first prompts used by the guided-practice assistant. These are
 * deliberately qualitative: they enrich the optics flow without weakening
 * the four-objective TheoryMastered gate. */
export interface OpticsWaveInquiryStep {
  id: string;
  conceptId: string;
  /** The pre-gate activity is a simulation/projection only; no apparatus work. */
  mode: 'simulation';
  physicalActivityGate: 'TheoryMastered';
  prompt: string;
  expectedEvidence: string;
  toolHint: 'knowledge_search' | 'simulation_runner' | 'data_analyzer';
}

export const OPTICS_WAVE_INQUIRY_STEPS: readonly OpticsWaveInquiryStep[] = [
  {
    id: 'opt-wave-diffraction-observe',
    conceptId: 'optics.wave.diffraction',
    mode: 'simulation',
    physicalActivityGate: 'TheoryMastered',
    prompt: 'In the virtual diffraction simulator, reduce the slit width while keeping the virtual source and screen distance fixed. What happens to the central bright band? Do not assemble physical apparatus before TheoryMastered.',
    expectedEvidence: 'A narrower slit produces a wider central diffraction envelope; record the simulated slit width and band width (no physical setup).',
    toolHint: 'simulation_runner',
  },
  {
    id: 'opt-wave-scattering-observe',
    conceptId: 'optics.wave.scattering',
    mode: 'simulation',
    physicalActivityGate: 'TheoryMastered',
    prompt: 'In the virtual scattering simulator, add a sealed fine-mist chamber without changing the virtual source. Why can the beam path become visible from the side? Do not handle mist or lasers before TheoryMastered.',
    expectedEvidence: 'The simulated particles redirect a small amount of light toward the observer; record visibility and keep the virtual enclosure closed (no physical setup).',
    toolHint: 'data_analyzer',
  },
];

/** 3 个质化波动模块（干涉 / 衍射 / 偏振），本期不判分、不做门禁承载。 */
export const OPTICS_WAVE_MODULES: readonly OpticsWaveModule[] = [
  {
    moduleId: 'opt-wave-interference',
    conceptId: 'optics.wave.interference',
    knowledgeType: 'concept',
    title: '光的干涉：相干光源与明暗条纹条件',
    description: '理解两列相干光叠加形成明暗条纹的条件，能用生活现象（肥皂膜、油膜）定性解释。',
    gradingGated: false,
  },
  {
    moduleId: 'opt-wave-diffraction',
    conceptId: 'optics.wave.diffraction',
    knowledgeType: 'concept',
    title: '光的衍射：明显衍射条件与条纹特征',
    description: '理解障碍物/缝宽与波长可比时发生明显衍射，能定性比较单缝与双缝现象。',
    gradingGated: false,
  },
  {
    moduleId: 'opt-wave-scattering',
    conceptId: 'optics.wave.scattering',
    knowledgeType: 'concept',
    title: 'Scattering: why a beam becomes visible in a medium',
    description: 'Fine particles or density variations redirect light from the beam path toward an observer.',
    gradingGated: false,
  },
  {
    moduleId: 'opt-wave-polarization',
    conceptId: 'optics.wave.polarization',
    knowledgeType: 'design',
    title: '光的偏振：横波证据与偏振片应用',
    description: '理解偏振是横波的证据，能设计用两块偏振片验证横波性的小实验。',
    gradingGated: false,
  },
];

/**
 * 存量题库三条条目的旧 conceptId → 规范 conceptId 别名。
 *
 * `QUIZ_BANK` 中 `optics.reflection.q1` / `optics.refraction.q1` /
 * `optics.lens.q1` 沿用了旧键，不修改既有条目；本表让「题库每个条目的
 * conceptId 都存在于内容层」的全库不变量在 11 条条目上成立。
 */
export const OPTICS_LEGACY_CONCEPT_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  'optics.reflection': 'optics.reflection.law',
  'optics.refraction': 'optics.refraction.law',
  'optics.lens': 'optics.lens.ray_rules',
});

/* ============================ 模板目标树层 ============================ */

export interface OpticsObjective extends PblTemplateObjective {
  phase: PblPhase;
  /** 学习计划的知识类型；`reflection` 目标为 `null`（掌握度引擎无法判它）。 */
  knowledgeType: KnowledgeType | null;
  /** 关联知识键；`memory` / `procedure` 目标必填，其余为 `null`。 */
  conceptId: string | null;
}

/** 4 阶段 12 目标的完整目标树（recon-pedagogy §2.2）。 */
export const OPTICS_OBJECTIVES: readonly OpticsObjective[] = [
  /* ---------- exploration（质化，非门禁） ---------- */
  {
    id: 'opt-intent-observe',
    phase: 'exploration',
    kind: 'concept',
    knowledgeType: 'concept',
    conceptId: null,
    title: '观察光学现象，说出可测量的量',
    description: '观察反射/折射/透镜成像现象，说出可测量的量（角、距离、像的正倒大小）。',
    prerequisiteIds: [],
  },
  {
    id: 'opt-intent-question',
    phase: 'exploration',
    kind: 'design',
    knowledgeType: 'design',
    conceptId: null,
    title: '提出可探究问题与初步方案',
    description: '提出一个可探究问题并给出初步方案（自变量/因变量/控制变量）。',
    prerequisiteIds: ['opt-intent-observe'],
  },
  /* ---------- concept_mastery（门禁承载，必须 memory|procedure） ---------- */
  {
    id: 'opt-theory-reflection',
    phase: 'concept_mastery',
    kind: 'concept',
    knowledgeType: 'memory',
    conceptId: 'optics.reflection.law',
    title: '反射定律：法线基准、角相等、光路可逆',
    description: '陈述反射定律（法线基准、角相等、光路可逆），并说明平面镜成正立等大虚像。',
    prerequisiteIds: ['opt-intent-question'],
  },
  {
    id: 'opt-theory-refraction',
    phase: 'concept_mastery',
    kind: 'concept',
    knowledgeType: 'memory',
    conceptId: 'optics.refraction.law',
    title: '折射定律与折射率定义',
    description: '陈述折射定律与折射率定义，判断光疏↔光密时折射角相对法线的偏向。',
    prerequisiteIds: ['opt-theory-reflection'],
  },
  {
    id: 'opt-theory-tir',
    phase: 'concept_mastery',
    kind: 'concept',
    knowledgeType: 'memory',
    conceptId: 'optics.tir.critical_angle',
    title: '全反射条件与临界角公式',
    description: '写出全反射条件与临界角公式，判断哪些界面组合可能发生全反射。',
    prerequisiteIds: ['opt-theory-refraction'],
  },
  {
    id: 'opt-theory-lens',
    phase: 'concept_mastery',
    kind: 'procedure',
    knowledgeType: 'procedure',
    conceptId: 'optics.lens.ray_rules',
    title: '三条特殊光线作图定像',
    description: '用三条特殊光线作图定像，并按 u 与 2f/f 的关系判断像的性质。',
    prerequisiteIds: ['opt-theory-tir'],
  },
  /* ---------- guided_practice（experiment_report 类交付物，非门禁） ---------- */
  {
    id: 'opt-practice-setup',
    phase: 'guided_practice',
    kind: 'procedure',
    knowledgeType: 'procedure',
    conceptId: null,
    title: '搭建光路并校准法线与光轴',
    description: '搭建/配置光路（激光笔、水槽、透镜、光屏），校准法线与光轴。',
    prerequisiteIds: ['opt-theory-lens'],
  },
  {
    id: 'opt-practice-measure',
    phase: 'guided_practice',
    kind: 'procedure',
    knowledgeType: 'procedure',
    conceptId: null,
    title: '采集角度与物像距数据',
    description: '采集入射角/折射角、物距/像距数据，记录不确定度。',
    prerequisiteIds: ['opt-practice-setup'],
  },
  {
    id: 'opt-practice-fit',
    phase: 'guided_practice',
    kind: 'procedure',
    knowledgeType: 'procedure',
    conceptId: null,
    title: '拟合数据求折射率与焦距',
    description: '拟合 sinθ₁–sinθ₂ 求折射率、拟合 1/u–1/v 求焦距，误差 ≤5%。',
    prerequisiteIds: ['opt-practice-measure'],
  },
  {
    id: 'opt-practice-report',
    phase: 'guided_practice',
    kind: 'design',
    knowledgeType: 'design',
    conceptId: null,
    title: '撰写探究报告',
    description: '撰写探究报告：装置图、数据表、拟合图、误差来源、结论边界。',
    prerequisiteIds: ['opt-practice-fit'],
  },
  /* ---------- deliverable_review（质化 / 归档，非门禁） ---------- */
  {
    id: 'opt-review-defend',
    phase: 'deliverable_review',
    kind: 'design',
    knowledgeType: 'design',
    conceptId: null,
    title: '答辩：解释装置选择与结论适用范围',
    description: '答辩：解释装置选择、数据可信度与结论适用范围。',
    prerequisiteIds: ['opt-practice-report'],
  },
  {
    id: 'opt-review-reflect',
    phase: 'deliverable_review',
    kind: 'reflection',
    knowledgeType: null,
    conceptId: null,
    title: '反思：最脆弱的假设与重做改进',
    description: '反思：哪一步假设最脆弱、如果重做会改什么。',
    prerequisiteIds: ['opt-review-defend'],
  },
];

/** 门禁承载目标 id（`TheoryMastered` 只由这 4 个 memory/procedure 目标决定）。 */
export const OPTICS_GATED_OBJECTIVE_IDS: readonly string[] = OPTICS_OBJECTIVES.filter(
  (objective) => objective.phase === 'concept_mastery',
).map((objective) => objective.id);

export function opticsObjectiveById(id: string): OpticsObjective | null {
  return OPTICS_OBJECTIVES.find((objective) => objective.id === id) ?? null;
}

/** 门禁承载目标的知识类型必须是 `memory` | `procedure`；否则判分打不开门禁。 */
export function assertOpticsObjectiveTypePolicy(): void {
  for (const objective of OPTICS_OBJECTIVES) {
    const gated = OPTICS_GATED_OBJECTIVE_IDS.includes(objective.id);
    if (gated) {
      if (objective.knowledgeType !== 'memory' && objective.knowledgeType !== 'procedure') {
        throw new Error(`门禁承载目标 ${objective.id} 的 knowledgeType 必须为 memory|procedure`);
      }
      if (objective.conceptId === null) {
        throw new Error(`门禁承载目标 ${objective.id} 必须关联 conceptId`);
      }
    }
    if (objective.kind === 'reflection') {
      if (objective.knowledgeType !== null) {
        throw new Error(`reflection 目标 ${objective.id} 不得携带 knowledgeType`);
      }
      if (gated) {
        throw new Error(`reflection 目标 ${objective.id} 不得作为门禁承载`);
      }
    }
  }
  for (const module of OPTICS_WAVE_MODULES) {
    if (module.gradingGated !== false) {
      throw new Error(`波动模块 ${module.moduleId} 必须标记为非门禁`);
    }
  }
}

/** 内容层是否认识某个 conceptId（规范键 + 波动模块键 + 存量旧键别名）。 */
export function opticsConceptExists(conceptId: string): boolean {
  const canonical =
    OPTICS_LEGACY_CONCEPT_ALIASES[conceptId] !== undefined
      ? OPTICS_LEGACY_CONCEPT_ALIASES[conceptId]
      : conceptId;
  return (
    OPTICS_THEORY_CONCEPTS.some((concept) => concept.conceptId === canonical) ||
    OPTICS_WAVE_MODULES.some((module) => module.conceptId === canonical)
  );
}

/** 门禁承载目标 → 理论概念；非门禁目标返回 null。 */
export function opticsTheoryConceptForObjective(objectiveId: string): OpticsTheoryConcept | null {
  return OPTICS_THEORY_CONCEPTS.find((concept) => concept.objectiveId === objectiveId) ?? null;
}

/* ============================ 阶段 / 排期 / 模板规格 ============================ */

export const OPTICS_PHASES: readonly PblTemplatePhase[] = [
  {
    phase: 'exploration',
    title: '阶段一：生活情境启发与探究课题确认',
    objectiveIds: ['opt-intent-observe', 'opt-intent-question'],
    gateCondition: 'student_confirmed_intent' as GateConditionId,
    deliverableType: 'project_intent_doc',
    evidenceProfile: null as EvidenceProfile | null,
    assignedAssistantId: 'qitu-intake-assistant',
  },
  {
    phase: 'concept_mastery',
    title: '阶段二：光学核心定律探索与概念掌握',
    objectiveIds: [
      'opt-theory-reflection',
      'opt-theory-refraction',
      'opt-theory-tir',
      'opt-theory-lens',
    ],
    gateCondition: 'TheoryMastered' as GateConditionId,
    deliverableType: 'mastery_checkpoint_report',
    evidenceProfile: null as EvidenceProfile | null,
    assignedAssistantId: 'optics-concept-coach',
  },
  {
    phase: 'guided_practice',
    title: '阶段三：光路搭建、数据采集与规律拟合',
    objectiveIds: [
      'opt-practice-setup',
      'opt-practice-measure',
      'opt-practice-fit',
      'opt-practice-report',
    ],
    gateCondition: 'experiment_report_validated' as GateConditionId,
    deliverableType: 'simulation_experiment_report',
    evidenceProfile: 'experiment_report' as EvidenceProfile,
    assignedAssistantId: 'optics-experiment-guide',
  },
  {
    phase: 'deliverable_review',
    title: '阶段四：答辩评审与反思成长归档',
    objectiveIds: ['opt-review-defend', 'opt-review-reflect'],
    gateCondition: 'review_completed_and_archived' as GateConditionId,
    deliverableType: 'growth_archive_record',
    evidenceProfile: null as EvidenceProfile | null,
    assignedAssistantId: 'optics-review-assessor',
  },
];

export const OPTICS_SCHEDULES: readonly PblTemplateSchedule[] = [
  { durationWeeks: 4, weeklyMinutes: 120, sessionsPerWeek: 2, sessionMinutes: 60, moduleCount: 4 },
];

export const OPTICS_TEMPLATE_SPEC: ProjectTemplateSpec = {
  contractVersion: PBL_LEARNING_CONTRACT_VERSION,
  id: 'pbl-optics-inquiry',
  version: 'v1',
  status: 'draft',
  title: '探究光的路径：从反射定律到透镜成像',
  description:
    '以「光为什么会在水面弯折、在光纤里锁住、在透镜后成像」为主线，完成反射、折射、全反射、透镜四条定律的概念掌握与定量实验。',
  targetDomain: 'physics_optics',
  ageRange: { min: 13, max: 15 },
  prerequisites: ['已掌握角的度量与三角比的基础含义'],
  materials: ['激光笔', '半圆形水槽/玻璃砖', '量角器', '凸透镜与凹透镜', '光屏', '直尺'],
  safetyRequirements: ['激光笔不得直射眼睛', '玻璃器材轻拿轻放，碎裂立即报告'],
  objectives: OPTICS_OBJECTIVES.map((objective) => ({
    id: objective.id,
    title: objective.title,
    description: objective.description,
    kind: objective.kind,
    prerequisiteIds: objective.prerequisiteIds,
  })),
  phases: OPTICS_PHASES,
  schedules: OPTICS_SCHEDULES,
  finalDeliverableType: 'simulation_experiment_report',
  rubricId: 'rubric-optics-inquiry-v1',
  teamId: 'team-optics-inquiry',
};

