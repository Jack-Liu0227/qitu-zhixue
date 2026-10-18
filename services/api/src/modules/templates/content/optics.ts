import type { KnowledgeType, PblPhase } from '@qitu/contracts';
import {
  assertOpticsObjectiveTypePolicy,
  OPTICS_GATED_OBJECTIVE_IDS,
  OPTICS_OBJECTIVES,
  OPTICS_PHASES,
  OPTICS_SCHEDULES,
  OPTICS_TEMPLATE_SPEC,
  OPTICS_WAVE_MODULES,
  OPTICS_WAVE_INQUIRY_STEPS,
} from '@qitu/ai-client/quiz-bank';
import type {
  CreateTemplateInput,
  CreateTemplateVersionInput,
  TemplateStage,
} from '../templates.types';

/**
 * 光学 PBL 模板定义（server 侧内容常量）。
 *
 * 只产出「模板 / 版本」的冻结输入，不写任何状态；真正落库由
 * `services/api/src/scripts/optics-template-bootstrap.ts` 经治理服务完成
 * （create → pilot → binding create → validate → activate），发布 / 验证
 * 必须由操作员带证据门手动执行。
 */

export const OPTICS_TEMPLATE_SLUG = 'optics-physical-inquiry';

/** 幂等解析标记：跨进程重跑时据此在 `listVersions` 里解析出同一版本。 */
export const OPTICS_BOOTSTRAP_KEY = 'optics-physical-inquiry:v1';

export const OPTICS_TEMPLATE_STAGES: TemplateStage[] = [
  { id: 'exploration', label: '生活情境启发与探究课题确认' },
  { id: 'concept_mastery', label: '光学核心定律探索与概念掌握' },
  { id: 'guided_practice', label: '光路搭建、数据采集与规律拟合' },
  { id: 'deliverable_review', label: '答辩评审与反思成长归档' },
];

export const OPTICS_TEMPLATE_INPUT: CreateTemplateInput = {
  schoolId: null,
  slug: OPTICS_TEMPLATE_SLUG,
  title: OPTICS_TEMPLATE_SPEC.title,
  summary: OPTICS_TEMPLATE_SPEC.description,
  domain: OPTICS_TEMPLATE_SPEC.targetDomain,
  ageRange: `${OPTICS_TEMPLATE_SPEC.ageRange.min}-${OPTICS_TEMPLATE_SPEC.ageRange.max}`,
  difficulty: 'medium',
  estimatedDurationMinutes: 240,
  requiredMaterials: [...OPTICS_TEMPLATE_SPEC.materials],
  learningObjectives: OPTICS_TEMPLATE_SPEC.objectives.map((objective) => objective.title),
  outcomeForm: '探究实验报告',
  safetyNotes: OPTICS_TEMPLATE_SPEC.safetyRequirements.join('；'),
};

/** rubric 正文落在 `project_template_versions.rubric`（现有种子简化形状）。 */
export const OPTICS_RUBRIC: unknown[] = [
  { id: 'r1', criterion: '定律陈述与公式准确（反射/折射/全反射/透镜）', weight: 30 },
  { id: 'r2', criterion: '光路搭建与数据采集规范、真实', weight: 40 },
  { id: 'r3', criterion: '拟合与误差分析深入，结论边界清楚', weight: 30 },
];

/** 课次模块：4 周 × 每周 2 节 × 60 分钟，覆盖全部 12 个目标。 */
export interface OpticsSessionModule {
  id: string;
  week: number;
  session: number;
  title: string;
  phase: PblPhase;
  objectiveIds: readonly string[];
  minutes: number;
}

export const OPTICS_8_SESSION_MODULES: readonly OpticsSessionModule[] = [
  {
    id: 'm1',
    week: 1,
    session: 1,
    title: '生活里的光：观察与提问',
    phase: 'exploration',
    objectiveIds: ['opt-intent-observe', 'opt-intent-question'],
    minutes: 60,
  },
  {
    id: 'm2',
    week: 1,
    session: 2,
    title: '反射定律与平面镜成像',
    phase: 'concept_mastery',
    objectiveIds: ['opt-theory-reflection'],
    minutes: 60,
  },
  {
    id: 'm3',
    week: 2,
    session: 1,
    title: '折射定律与折射率',
    phase: 'concept_mastery',
    objectiveIds: ['opt-theory-refraction'],
    minutes: 60,
  },
  {
    id: 'm4',
    week: 2,
    session: 2,
    title: '全反射与临界角',
    phase: 'concept_mastery',
    objectiveIds: ['opt-theory-tir'],
    minutes: 60,
  },
  {
    id: 'm5',
    week: 3,
    session: 1,
    title: '透镜三条特殊光线作图',
    phase: 'concept_mastery',
    objectiveIds: ['opt-theory-lens'],
    minutes: 60,
  },
  {
    id: 'm6',
    week: 3,
    session: 2,
    title: '搭建光路并采集角度 / 像距数据',
    phase: 'guided_practice',
    objectiveIds: ['opt-practice-setup', 'opt-practice-measure'],
    minutes: 60,
  },
  {
    id: 'm7',
    week: 4,
    session: 1,
    title: '拟合数据与撰写探究报告',
    phase: 'guided_practice',
    objectiveIds: ['opt-practice-fit', 'opt-practice-report'],
    minutes: 60,
  },
  {
    id: 'm8',
    week: 4,
    session: 2,
    title: '答辩与反思归档',
    phase: 'deliverable_review',
    objectiveIds: ['opt-review-defend', 'opt-review-reflect'],
    minutes: 60,
  },
];

export const OPTICS_16_SESSION_MODULES: readonly OpticsSessionModule[] = [
  {
    id: 'm1',
    week: 1,
    session: 1,
    title: '生活里的光：观察与提问',
    phase: 'exploration',
    objectiveIds: ['opt-intent-observe'],
    minutes: 60,
  },
  {
    id: 'm2',
    week: 1,
    session: 2,
    title: '问题聚焦与探究意向书确认',
    phase: 'exploration',
    objectiveIds: ['opt-intent-question'],
    minutes: 60,
  },
  {
    id: 'm3',
    week: 2,
    session: 1,
    title: '反射定律与光线模型',
    phase: 'concept_mastery',
    objectiveIds: ['opt-theory-reflection'],
    minutes: 60,
  },
  {
    id: 'm4',
    week: 2,
    session: 2,
    title: '平面镜成像规律与虚像作图',
    phase: 'concept_mastery',
    objectiveIds: ['opt-theory-reflection'],
    minutes: 60,
  },
  {
    id: 'm5',
    week: 3,
    session: 1,
    title: '折射定律与折射率',
    phase: 'concept_mastery',
    objectiveIds: ['opt-theory-refraction'],
    minutes: 60,
  },
  {
    id: 'm6',
    week: 3,
    session: 2,
    title: '全反射与临界角',
    phase: 'concept_mastery',
    objectiveIds: ['opt-theory-tir'],
    minutes: 60,
  },
  {
    id: 'm7',
    week: 4,
    session: 1,
    title: '透镜三条特殊光线作图',
    phase: 'concept_mastery',
    objectiveIds: ['opt-theory-lens'],
    minutes: 60,
  },
  {
    id: 'm8',
    week: 4,
    session: 2,
    title: '几何光学核心定律测验（TheoryMastered 门禁）',
    phase: 'concept_mastery',
    objectiveIds: [
      'opt-theory-reflection',
      'opt-theory-refraction',
      'opt-theory-tir',
      'opt-theory-lens',
    ],
    minutes: 60,
  },
  {
    id: 'm9',
    week: 5,
    session: 1,
    title: '搭建光路并校准仪器',
    phase: 'guided_practice',
    objectiveIds: ['opt-practice-setup'],
    minutes: 60,
  },
  {
    id: 'm10',
    week: 5,
    session: 2,
    title: '单缝衍射条纹宽度采集与仿真',
    phase: 'guided_practice',
    objectiveIds: ['opt-practice-measure'],
    minutes: 60,
  },
  {
    id: 'm11',
    week: 6,
    session: 1,
    title: '微粒介质散射效应与光束可见性仿真',
    phase: 'guided_practice',
    objectiveIds: ['opt-practice-measure'],
    minutes: 60,
  },
  {
    id: 'm12',
    week: 6,
    session: 2,
    title: '拟合数据与误差分析',
    phase: 'guided_practice',
    objectiveIds: ['opt-practice-fit'],
    minutes: 60,
  },
  {
    id: 'm13',
    week: 7,
    session: 1,
    title: 'CER 科学论证构建与实证主张',
    phase: 'guided_practice',
    objectiveIds: ['opt-practice-report'],
    minutes: 60,
  },
  {
    id: 'm14',
    week: 7,
    session: 2,
    title: '撰写探究报告（报告门禁）',
    phase: 'guided_practice',
    objectiveIds: ['opt-practice-report'],
    minutes: 60,
  },
  {
    id: 'm15',
    week: 8,
    session: 1,
    title: '同行盲审与答辩质疑',
    phase: 'deliverable_review',
    objectiveIds: ['opt-review-defend'],
    minutes: 60,
  },
  {
    id: 'm16',
    week: 8,
    session: 2,
    title: '反思归档与成长雷达评估',
    phase: 'deliverable_review',
    objectiveIds: ['opt-review-reflect'],
    minutes: 60,
  },
];

export const OPTICS_SESSION_MODULES: readonly OpticsSessionModule[] = OPTICS_16_SESSION_MODULES;

export function getOpticsSessionModules(weeks: 4 | 8 = 8): readonly OpticsSessionModule[] {
  return weeks === 4 ? OPTICS_8_SESSION_MODULES : OPTICS_16_SESSION_MODULES;
}

/** 每个目标显式登记知识类型（learning-plan `KnowledgeType`；reflection 为 null）。 */
export const OPTICS_KNOWLEDGE_TYPES: Readonly<Record<string, KnowledgeType | null>> =
  Object.fromEntries(OPTICS_OBJECTIVES.map((objective) => [objective.id, objective.knowledgeType]));

export const OPTICS_VERSION_CONTENT: Record<string, unknown> = {
  bootstrapKey: OPTICS_BOOTSTRAP_KEY,
  pbl: OPTICS_TEMPLATE_SPEC,
  modules: OPTICS_SESSION_MODULES,
  knowledgeTypes: OPTICS_KNOWLEDGE_TYPES,
  waveModules: OPTICS_WAVE_MODULES.map((module) => ({
    moduleId: module.moduleId,
    conceptId: module.conceptId,
    knowledgeType: module.knowledgeType,
    title: module.title,
    description: module.description,
  })),
  waveInquirySteps: OPTICS_WAVE_INQUIRY_STEPS,
};

export const OPTICS_VERSION_INPUT: CreateTemplateVersionInput = {
  stages: OPTICS_TEMPLATE_STAGES,
  content: OPTICS_VERSION_CONTENT,
  rubric: OPTICS_RUBRIC,
};

/**
 * 结构校验（bootstrap 落库前先跑）：保证模板正文自洽。
 * 任何违反都会 throw，bootstrap 不得继续。
 */
export function assertOpticsTemplateStructure(): void {
  assertOpticsObjectiveTypePolicy();

  const objectiveIds = new Set(OPTICS_OBJECTIVES.map((objective) => objective.id));
  for (const phase of OPTICS_PHASES) {
    for (const id of phase.objectiveIds) {
      if (!objectiveIds.has(id)) {
        throw new Error(`阶段 ${phase.phase} 引用了未定义目标：${id}`);
      }
    }
  }

  // 门禁承载集合必须与 content 层的推导一致，且全部为 memory|procedure。
  const phaseGate = OPTICS_PHASES.find((phase) => phase.phase === 'concept_mastery');
  if (phaseGate === undefined) {
    throw new Error('缺少 concept_mastery 阶段');
  }
  const gated = [...phaseGate.objectiveIds].sort();
  const expected = [...OPTICS_GATED_OBJECTIVE_IDS].sort();
  if (gated.length !== expected.length || gated.some((id, index) => id !== expected[index])) {
    throw new Error('concept_mastery 阶段目标集合与门禁承载集合不一致');
  }

  // 课次模块覆盖全部目标。
  const covered = new Set<string>();
  for (const module of OPTICS_SESSION_MODULES) {
    for (const id of module.objectiveIds) covered.add(id);
  }
  for (const id of objectiveIds) {
    if (!covered.has(id)) {
      throw new Error(`目标 ${id} 未被任何课次模块覆盖`);
    }
  }

  // 每个课次模块的 phase 必须是合法阶段，且目标属于该阶段。
  for (const module of OPTICS_SESSION_MODULES) {
    const phase = OPTICS_PHASES.find((item) => item.phase === module.phase);
    if (phase === undefined) {
      throw new Error(`模块 ${module.id} 的阶段 ${module.phase} 未在模板阶段中登记`);
    }
    for (const id of module.objectiveIds) {
      if (!phase.objectiveIds.includes(id)) {
        throw new Error(`模块 ${module.id} 的目标 ${id} 不属于阶段 ${module.phase}`);
      }
    }
  }

  const rubric = OPTICS_VERSION_INPUT.rubric ?? [];
  if (rubric.length === 0) {
    throw new Error('rubric 不能为空');
  }
  if (typeof OPTICS_VERSION_CONTENT.bootstrapKey !== 'string') {
    throw new Error('content.bootstrapKey 必须存在且为字符串');
  }
}
