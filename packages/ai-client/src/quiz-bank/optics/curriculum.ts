import type { PblTemplateSession, ProjectTemplateSpec } from '@qitu/contracts';
import { parseProjectTemplateSpec } from '@qitu/contracts';
import { OPTICS_OBJECTIVES, OPTICS_TEMPLATE_SPEC } from './content.js';

export const OPTICS_16_PROFILE_ID = 'optics-16x60-v2';

const THEORY_BLOCKS = { review: 10, theory: 30, check: 15, practice: 0, reflect: 5 };
const PRACTICE_BLOCKS = { review: 5, theory: 10, check: 5, practice: 35, reflect: 5 };
const REVIEW_BLOCKS = { review: 5, theory: 15, check: 10, practice: 0, reflect: 30 };
const GATE_BLOCKS = { review: 10, theory: 15, check: 30, practice: 0, reflect: 5 };

const SESSIONS: readonly Pick<PblTemplateSession,
  'title' | 'phase' | 'sessionType' | 'objectiveIds' | 'blocks' | 'learningGoal' | 'activityGuidance' | 'evidenceRequirements' | 'checkpoint' | 'interactiveSpec'
>[] = [
  {
    title: '光的宏观现象与观察指标', phase: 'exploration', sessionType: 'theory',
    objectiveIds: ['opt-intent-observe'], blocks: THEORY_BLOCKS,
    learningGoal: '观察反射、折射和透镜现象，区分观察与解释，识别角度、距离、虚实正倒等指标。',
    activityGuidance: {
      review: '从生活中的镜面、水面和透镜现象提出疑问。',
      theory: '使用图像与低风险模拟提示比较现象，用观察指标看板分类，不操作实验器材。',
      check: '说明角度的基准、距离的起止位置，以及哪些像的性质需要进一步验证。',
      reflect: '选择最想解释的现象，保留尚未解决的问题。',
    },
    evidenceRequirements: ['带指标与单位的现象观察表', '观察事实与初步解释的区分记录'],
  },
  {
    title: '提出探究假设与实验方案', phase: 'exploration', sessionType: 'theory',
    objectiveIds: ['opt-intent-question'], blocks: THEORY_BLOCKS,
    learningGoal: '提出可检验假设，设计自变量、因变量与控制变量，形成初步实验构想。',
    activityGuidance: {
      review: '从观察表挑选一个可测量的问题。',
      theory: '绘制变量关系图，预测可能结果，纸面设计对照与重复测量方案。',
      check: '检查假设是否可检验、变量是否混杂；请学生显式确认意图，未确认不创建正式项目。',
      reflect: '修订探究意向书，列出证据需求与安全审核事项。',
    },
    evidenceRequirements: ['可检验假设与变量设计表', '待学生确认的探究意向书草稿'],
    checkpoint: { requiredGate: 'student_confirmed_intent' },
  },
  {
    title: '光的直线传播与平面镜成像原理', phase: 'concept_mastery', sessionType: 'theory',
    objectiveIds: ['opt-theory-reflection'], blocks: THEORY_BLOCKS,
    learningGoal: '在均匀介质中用直线光线模型解释传播；说明像物对称、像物等大及虚像的物理意义。',
    activityGuidance: {
      review: '回顾现象中的物、镜面与观察位置。',
      theory: '通过光线示意图与低风险模拟提示构造反向延长线，比较物距与像距。',
      check: '作图解释为何虚像不能直接呈在光屏上，区分光线与反向延长线。',
      reflect: '整理平面镜成像模型的条件和适用范围。',
    },
    evidenceRequirements: ['标注物像距离与延长线的成像图', '对虚像含义的自主解释'],
  },
  {
    title: '反射定律公式与光路可逆性', phase: 'concept_mastery', sessionType: 'theory',
    objectiveIds: ['opt-theory-reflection'], blocks: THEORY_BLOCKS,
    learningGoal: '以法线为角度基准，用 theta_1 = theta_2 定量计算，完成光路可逆作图。',
    activityGuidance: {
      review: '从平面镜成像图定位入射点与法线。',
      theory: '用公式和光路图关联三线共面、角相等与可逆性。',
      check: '完成相对镜面角和相对法线角的转换题，反向画出传播路径。',
      reflect: '记录最易混淆的角度基准并解释纠正方式。',
    },
    evidenceRequirements: ['反射角计算与可逆光路图', '法线基准易错点修订记录'],
  },
  {
    title: '折射定律与介质折射率定义', phase: 'concept_mastery', sessionType: 'theory',
    objectiveIds: ['opt-theory-refraction'], blocks: THEORY_BLOCKS,
    learningGoal: '理解 n = c/v，使用 n_1 sin(theta_1) = n_2 sin(theta_2)，判断光疏与光密介质中的偏折。',
    activityGuidance: {
      review: '比较反射和折射示意图中的角度基准。',
      theory: '用低风险模拟提示比较介质组合，将折射率定义与斯涅尔定律连接。',
      check: '在给定折射率下计算折射角，并解释靠近或远离法线的原因。',
      reflect: '区分光学疏密与质量密度，记录模型前提。',
    },
    evidenceRequirements: ['折射角计算与偏折方向解释', '折射率定义及适用条件记录'],
  },
  {
    title: '全反射发生条件与临界角推导', phase: 'concept_mastery', sessionType: 'theory',
    objectiveIds: ['opt-theory-tir'], blocks: THEORY_BLOCKS,
    learningGoal: '明确 n_1 > n_2 且入射角大于临界角时发生全反射；推导 sin C = n_2/n_1，向空气传播时近似为 1/n_1。',
    activityGuidance: {
      review: '从折射定律预测折射角接近 90 度的情形。',
      theory: '推导临界角通式，区分临界状态与大于临界角的全反射。',
      check: '判断介质组合是否满足条件，解释为何 sin C = 1/n 不是任意界面的通式。',
      reflect: '用光纤情境解释介质条件与角度条件缺一不可。',
    },
    evidenceRequirements: ['临界角公式推导与条件判断', '临界状态和全反射状态的区别说明'],
  },
  {
    title: '凸透镜与凹透镜成像特殊光线作图', phase: 'concept_mastery', sessionType: 'theory',
    objectiveIds: ['opt-theory-lens'], blocks: THEORY_BLOCKS,
    learningGoal: '用三条特殊光线定像，根据物距 u 与焦距 f 判断像的虚实、正倒和大小。',
    activityGuidance: {
      review: '回顾实像与虚像、折射与光轴的含义。',
      theory: '分别画凸透镜与凹透镜特殊光线，用延长线表示虚像。',
      check: '对比 u > 2f、f < u < 2f、u < f 等情况，并解释 u = f 的边界。',
      reflect: '总结作图规则及其薄透镜近轴模型限制。',
    },
    evidenceRequirements: ['凸透镜和凹透镜成像作图', '物距区间与像性质对照表'],
  },
  {
    title: '理论综合闯关与门禁评测', phase: 'concept_mastery', sessionType: 'review',
    objectiveIds: ['opt-theory-reflection', 'opt-theory-refraction', 'opt-theory-tir', 'opt-theory-lens'], blocks: GATE_BLOCKS,
    learningGoal: '复核反射、折射、全反射和透镜四个理论目标的掌握证据；仅服务端 TheoryMastered 达标后可解锁实践。',
    activityGuidance: {
      review: '用关系图回顾四个理论目标。',
      theory: '针对已有证据薄弱处进行同目标补救，不用课次结束代替掌握。',
      check: '通过现有题目与判分 owner 检查四目标；未达标继续补救或请求教师介入。',
      reflect: '阅读服务端门禁结果并记录下一步，不因来到第 8 课时自动放行。',
    },
    evidenceRequirements: ['四个理论目标的服务端评测引用', '未达标目标的补救记录或复核请求'],
    checkpoint: { requiredGate: 'TheoryMastered' },
  },
  {
    title: '光具座搭建、法线与光轴校准', phase: 'guided_practice', sessionType: 'practice',
    objectiveIds: ['opt-practice-setup'], blocks: PRACTICE_BLOCKS,
    learningGoal: '在 TheoryMastered 通过且教师安全审核后，完成激光源、半圆水槽、透镜和光屏的同轴等高校准。',
    activityGuidance: {
      review: '核对服务端实践门禁和教师安全方案；缺少任一条件不进行真实实验。',
      theory: '说明法线、光轴与等高要求，区分装置示意图和真实装置。',
      check: '检查器材固定、光路封闭和观察位置，禁止直视或危险开放式激光操作。',
      practice: '按教师批准方案搭建并校准，记录调试前后的偏差，不生成任意实验脚本。',
      reflect: '说明校准误差如何影响后续测量。',
    },
    evidenceRequirements: ['装置图与同轴等高校准记录', '教师安全审核与服务端门禁的有效引用'],
  },
  {
    title: '折射角与物像距数据采集', phase: 'guided_practice', sessionType: 'practice',
    objectiveIds: ['opt-practice-measure'], blocks: PRACTICE_BLOCKS,
    learningGoal: '采集多组入射角、折射角及物距、像距，记录单位、仪器分辨率和实验不确定度。',
    activityGuidance: {
      review: '核对校准记录、门禁和教师批准的测量方案。',
      theory: '设计重复测量表，明确角度基准、距离零点和不确定度记录方式。',
      check: '检查变量控制、单位和读数位置是否一致。',
      practice: '依批准方案读取并记录多组数据，保留原始读数和异常值，不用公式计算冒充实测。',
      reflect: '分析读数差异与主要误差来源。',
    },
    evidenceRequirements: ['角度及物像距原始数据表，含单位与不确定度', '测量来源和异常值处理记录'],
  },
  {
    title: '单缝衍射现象与条纹特征探究', phase: 'guided_practice', sessionType: 'practice',
    objectiveIds: ['opt-practice-measure'], blocks: PRACTICE_BLOCKS,
    learningGoal: '在批准模型域内调整缝宽 a 与波长 lambda，比较中央亮纹宽度和 I(theta) 强度特征。',
    activityGuidance: {
      review: '确认服务端实践权限，回顾控制变量方法。',
      theory: '预测缝宽或波长改变的结果，说明单缝模型的近似条件。',
      check: '一次只改变一个变量；只有注册模型可用，不授权任意 HTML/JS 或开放浏览器。',
      practice: '使用注册的 diffraction_slit 模型，在服务端验证的参数范围内采集模拟观察。',
      reflect: '比较预测与结果，分别标注模型计算、模拟观察和真实测量，证据以 owner 回执为准。',
    },
    evidenceRequirements: ['缝宽、波长和中央亮纹特征的模拟观察对照', '模型版本、参数与观测证据引用；不是掌握度通过事实'],
    interactiveSpec: { enabled: true, domainTopic: 'diffraction_slit', allowHypothesisPrediction: true },
  },
  {
    title: '封闭细雾室介质散射探究', phase: 'guided_practice', sessionType: 'practice',
    objectiveIds: ['opt-practice-measure'], blocks: PRACTICE_BLOCKS,
    learningGoal: '解释微粒介质中光束的侧向可见性，比较瑞利散射与米氏散射的适用条件和模型边界。',
    activityGuidance: {
      review: '确认服务端实践权限，比较直射方向和侧向观察位置。',
      theory: '以粒径与波长的关系讨论散射；Rayleigh 关系只在批准域使用。',
      check: '非 Rayleigh 不等于一律白色 Mie，单色散射不会自动变白。',
      practice: '使用注册的 particle_scattering 封闭细雾室模型，在服务端验证参数域内对照观察。',
      reflect: '标注模拟来源与适用边界；真实细雾室实验另需教师安全审核，不能靠安全提示代替方案。',
    },
    evidenceRequirements: ['粒径、波长与侧向可见性的模拟观察对照', '瑞利和米氏模型边界说明及观测证据引用'],
    interactiveSpec: { enabled: true, domainTopic: 'particle_scattering', allowHypothesisPrediction: true },
  },
  {
    title: '数据线性化拟合与实验求参', phase: 'guided_practice', sessionType: 'practice',
    objectiveIds: ['opt-practice-fit'], blocks: PRACTICE_BLOCKS,
    learningGoal: '通过线性化拟合求折射率与焦距，说明坐标、符号约定、残差和参数不确定度。',
    activityGuidance: {
      review: '读取第 10 课时的数据及来源，不将模拟值混作实测。',
      theory: '令 x = sin(theta_1)、y = sin(theta_2)，斜率为 n_1/n_2；正距离实像约定下 1/v = -1/u + 1/f。',
      check: '说明拟合 1/v 对 1/u 时斜率为 -1、截距为 1/f；虚像或凹透镜必须另用明确的有符号约定。',
      practice: '作图拟合并由斜率或截距求参，保留残差、异常值规则和不确定度。',
      reflect: '比较参数与模型预期，讨论偏差而非预设所有误差小于固定百分比。',
    },
    evidenceRequirements: ['带坐标、单位和符号约定的拟合图与参数估计', '残差、不确定度和误差来源分析'],
  },
  {
    title: '实验报告撰写与 CER 科学论证', phase: 'guided_practice', sessionType: 'practice',
    objectiveIds: ['opt-practice-report'], blocks: PRACTICE_BLOCKS,
    learningGoal: '整合装置图、数据表与拟合误差分析，以 CER 连接主张、证据和推理，明确结论边界。',
    activityGuidance: {
      review: '检查装置、数据、拟合与观测证据链是否可追溯。',
      theory: '按 Claim、Evidence、Reasoning 组织论证，区分实测、模拟与理论计算。',
      check: '按现有 rubric 检查缺失证据和过度推断，摘要不能代替证据引用。',
      practice: '撰写并修订报告，引用装置图、原始数据、拟合结果及 CER/rubric 条目。',
      reflect: '向作品评审 owner 提交检查请求；没有通过回执不显示报告已通过。',
    },
    evidenceRequirements: ['包含装置图、数据表、拟合和 CER 的报告版本引用', 'rubric 对照、误差分析与结论边界'],
    checkpoint: { requiredGate: 'experiment_report_validated' },
  },
  {
    title: '实验探究成果答辩与同行质疑', phase: 'deliverable_review', sessionType: 'review',
    objectiveIds: ['opt-review-defend'], blocks: REVIEW_BLOCKS,
    learningGoal: '以可追溯证据说明装置选型、测量误差来源与结论适用范围，回应同行质疑。',
    activityGuidance: {
      review: '回顾已提交的报告版本和评审意见。',
      theory: '准备从问题、模型、装置、数据到结论的证据链展示。',
      check: '请同行追问控制变量、异常值与模型边界，用证据而非权威回答。',
      reflect: '记录答辩意见，修订薄弱论证并保留修改依据。',
    },
    evidenceRequirements: ['答辩展示与同行质疑回应记录', '依据证据的报告修订说明'],
  },
  {
    title: '学习反思与学科素养成长归档', phase: 'deliverable_review', sessionType: 'review',
    objectiveIds: ['opt-review-reflect'], blocks: REVIEW_BLOCKS,
    learningGoal: '反思光学建模与探究方法，以量规自评形成成长归档候选，由服务端 owner 完成正式归档。',
    activityGuidance: {
      review: '对照初始假设与最终证据，回顾探究路径。',
      theory: '归纳光线和波动模型的适用边界，提出可迁移的方法。',
      check: '依量规自评并注明证据引用；自评不是作品批准或成长事实。',
      reflect: '完成反思和改进计划，提交归档请求；只有 owner 回执才代表已归档。',
    },
    evidenceRequirements: ['量规自评与建模思维反思', '带有界证据引用的成长归档候选，不含原始学生对话'],
    checkpoint: { requiredGate: 'review_completed_and_archived' },
  },
];

/** New immutable source identity; never amend the v1 template in place. */
export const OPTICS_16_SESSION_TEMPLATE_SPEC: ProjectTemplateSpec = parseProjectTemplateSpec({
  ...OPTICS_TEMPLATE_SPEC,
  id: 'pbl-optics-inquiry-16s',
  version: 'v2-16s',
  title: '光学探究：从光路模型到衍射与散射证据',
  description: '以真实问题为起点，在概念检查后开展受限模拟、数据分析、CER 论证与反思；检查点不自动产生掌握或作品通过事实。',
  theme: { drivingQuestion: '我们如何用光路和波动模型解释观察到的现象，并用可追溯的证据说明模型的适用边界？' },
  safetyRequirements: [
    'TheoryMastered 前仅允许低风险模拟提示；实践操作仍由服务端校验。',
    '仅使用注册的单缝衍射和封闭细雾室散射模型，区分计算、模拟观察与真实测量。',
    '真实实验须教师安全审核；禁止直视光源或开放式危险激光操作。',
  ],
  materials: [...OPTICS_TEMPLATE_SPEC.materials, '教师批准的光具座与固定装置', '注册的单缝衍射与封闭细雾室散射模型'],
  objectives: OPTICS_OBJECTIVES.map((objective) => ({
    id: objective.id,
    title: objective.title,
    description: objective.id === 'opt-practice-fit'
      ? '用 sin(theta_2) 对 sin(theta_1) 拟合求折射率；在明确符号约定下用 1/v 对 1/u 拟合求焦距，分析残差与不确定度。'
      : objective.id === 'opt-practice-measure'
        ? '采集角度与物像距数据并记录不确定度；对注册衍射和散射模型记录有来源的模拟观察，不作为新增理论门禁目标。'
        : objective.description,
    kind: objective.kind,
    prerequisiteIds: [...objective.prerequisiteIds],
    knowledgeType: objective.knowledgeType,
    conceptId: objective.conceptId,
  })),
  schedules: [{ durationWeeks: 8, weeklyMinutes: 120, sessionsPerWeek: 2, sessionMinutes: 60, moduleCount: 8, sessionCount: 16 }],
  curriculum: {
    profiles: [{
      id: OPTICS_16_PROFILE_ID,
      schedule: { durationWeeks: 8, weeklyMinutes: 120, sessionsPerWeek: 2, sessionMinutes: 60 },
      sessions: SESSIONS.map((session, index) => ({
        ...session,
        id: `optics-v2-session-${index + 1}`,
        sessionIndex: index + 1,
        week: Math.floor(index / 2) + 1,
        session: index % 2 + 1,
        durationMinutes: 60,
      })),
    }],
  },
});
