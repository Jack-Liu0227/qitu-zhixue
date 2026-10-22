import { parseProjectTemplateSpec, derivePhasesFromPolicyAndSessions, findGovernancePolicy,
  type LessonActivity, type PblTemplateObjective, type PblTemplateSession } from '@qitu/contracts';

export const WAVE_OPTICS_PROFILE_ID = 'wave-optics-8x60-v1';
export const WAVE_OPTICS_READINESS_IDS = ['wave-ready-superposition', 'wave-ready-coherence', 'wave-ready-comparison'] as const;
const LEAD = 'optics-leader';
const CONCEPT = 'optics-concept-coach';
const LAB = 'optics-experiment-guide';
const REVIEW = 'optics-review-assessor';
const THEORY = { review: 5, theory: 25, check: 20, practice: 0, reflect: 10 };
const PRACTICE = { review: 5, theory: 15, check: 10, practice: 25, reflect: 5 };
const activities: readonly LessonActivity[] = ['review', 'theory', 'check', 'practice', 'reflect'];

const objectives: readonly PblTemplateObjective[] = [
  { id: 'wave-question', title: '从条纹提出可比较的问题', kind: 'design', prerequisiteIds: [],
    description: '区分单缝和双缝图样的观察与猜想，提出一个能通过比较检验的问题。' },
  { id: WAVE_OPTICS_READINESS_IDS[0], title: '波叠加的准备理解', kind: 'concept', knowledgeType: 'concept',
    conceptId: 'wave.readiness.superposition', prerequisiteIds: [],
    description: '区分同向和反向波幅的叠加；光强不为负，波的叠加不是能量凭空消失。' },
  { id: WAVE_OPTICS_READINESS_IDS[1], title: '稳定相干条件的准备理解', kind: 'concept', knowledgeType: 'concept',
    conceptId: 'wave.readiness.coherence', prerequisiteIds: [],
    description: '认识稳定条纹需要稳定的相位关系；两个任意独立光源不保证形成稳定条纹。' },
  { id: WAVE_OPTICS_READINESS_IDS[2], title: '受控比较与模型边界', kind: 'concept', knowledgeType: 'concept',
    conceptId: 'wave.readiness.comparison', prerequisiteIds: [],
    description: '一次只改一个变量，区分模型计算、模拟观察与真实测量；只使用获准模型和范围。' },
  ...([
    ['wave-double-paths', '双缝路径与明暗解释', '用两条路径和相位关系解释明暗，区分缝间距 d 与缝宽 a。'],
    ['wave-double-compare', '双缝受控比较', '预测并记录缝间距、波长或屏距变化对条纹间距的影响，每次只改一个变量。'],
    ['wave-single-observe', '单缝图样观察', '标注中央亮带及两侧条纹，用孔径内波的叠加解释单缝衍射。'],
    ['wave-single-compare', '单缝受控比较', '固定波长与屏距比较缝宽变化，记录中央亮带宽度及解释。'],
    ['wave-evidence-compare', '干涉与衍射证据比较', '结合两组记录解释细条纹与衍射包络，说明结论的模型边界。'],
  ] satisfies [string, string, string][]).map(([id, title, description]): PblTemplateObjective => ({
    id, title, description, kind: 'design', prerequisiteIds: [...WAVE_OPTICS_READINESS_IDS],
  })),
  { id: 'wave-showcase', title: '明暗条纹探究档案', kind: 'design', prerequisiteIds: ['wave-evidence-compare'],
    description: '展示可复核的参数、观察、解释和修订，回答同伴质疑。' },
  { id: 'wave-reflection', title: '证据与理解反思', kind: 'reflection', prerequisiteIds: ['wave-evidence-compare'],
    description: '说明自己改变了什么解释、依据是什么，以及还不能确定的地方。' },
];

interface LessonDesign {
  title: string; lead: string; phase: PblTemplateSession['phase']; objectives: readonly string[];
  goal: string; scenario: string; prompt: string; evidence: string;
  methods: readonly string[]; domain?: string; collaborator?: string;
}
const designs: readonly LessonDesign[] = [
  { title: '条纹从哪里来？', lead: LEAD, phase: 'exploration', objectives: ['wave-question'],
    goal: '先描述单缝和双缝图样，再提出一个可以比较的问题。',
    scenario: '同样是光通过狭缝，屏上却能出现不同的明暗图样。我们先看看它们有什么不同。',
    prompt: '你注意到的一个相同点和一个不同点是什么？先说观察，不急着解释原因。',
    evidence: '现象对照卡与一个可探究问题', methods: ['pbl-driving-question', 'pbl-visual-explainer'] },
  { title: '两列波相遇会怎样？', lead: CONCEPT, phase: 'concept_mastery', objectives: WAVE_OPTICS_READINESS_IDS,
    goal: '用图示解释波的叠加、稳定相位关系和受控比较，完成专题准备检查。',
    scenario: '先把一列波看清，再把另一列波放到同一个位置。叠加后的变化，能帮助我们解释明暗。',
    prompt: '先看一组同向与反向波幅的图示，你想怎样预测叠加结果？',
    evidence: '波叠加解释、相干条件与受控比较的服务端检查回执',
    methods: ['pbl-understanding-coach', 'pbl-concept-probe', 'pbl-visual-explainer'] },
  { title: '双缝为什么出现明暗？', lead: CONCEPT, phase: 'guided_practice', objectives: ['wave-double-paths'],
    goal: '连接两条路径、到达相位与明暗位置，区分缝间距和缝宽。',
    scenario: '屏上的同一个位置，可以接收到分别经过两条缝的光。两条路径有什么不同？',
    prompt: '先在双缝示意图上标出两条传播路径，再说说你会比较什么。',
    evidence: '双缝标注图与一次基于路径的判断', methods: ['pbl-concept-probe', 'pbl-visual-explainer'],
    domain: 'double_slit_interference', collaborator: LAB },
  { title: '怎样改变干涉条纹间距？', lead: LAB, phase: 'guided_practice', objectives: ['wave-double-compare'],
    goal: '先只改缝间距，再按需比较波长或屏距，记录预测与结果。',
    scenario: '现在保留同一个光源和光屏，只改变两条缝之间的距离。',
    prompt: '先提出你的预测，并说明哪些参数必须保持不变。',
    evidence: '至少一组受控双缝模拟观察与比较解释',
    methods: ['pbl-experiment-design', 'pbl-hypothesis-coach', 'pbl-data-literacy'],
    domain: 'double_slit_interference', collaborator: CONCEPT },
  { title: '一条缝为什么仍有条纹？', lead: CONCEPT, phase: 'guided_practice', objectives: ['wave-single-observe'],
    goal: '观察中央亮带和两侧条纹，用孔径内波的叠加解释图样。',
    scenario: '只留下一条缝后，屏上仍然有结构。先把真正看到的特征记录下来。',
    prompt: '中央和两侧的亮带有什么不同？请先标注，不急着套用双缝结论。',
    evidence: '单缝特征标注与初步解释', methods: ['pbl-concept-probe', 'pbl-visual-explainer'],
    domain: 'diffraction_slit', collaborator: LAB },
  { title: '缝变窄，图样怎样变化？', lead: LAB, phase: 'guided_practice', objectives: ['wave-single-compare'],
    goal: '固定波长和屏距比较缝宽，记录中央亮带宽度及适用条件。',
    scenario: '这次只改变一条缝的宽度。注意它与双缝的缝间距不是同一个量。',
    prompt: '你预测中央亮带会怎样变化？准备怎样比较两次记录？',
    evidence: '至少一组受控单缝模拟观察、单位与修订解释',
    methods: ['pbl-experiment-design', 'pbl-data-literacy', 'pbl-hypothesis-coach'],
    domain: 'diffraction_slit', collaborator: CONCEPT },
  { title: '干涉与衍射怎样联系？', lead: CONCEPT, phase: 'guided_practice', objectives: ['wave-evidence-compare'],
    goal: '结合两组证据解释有限宽双缝的细条纹与包络，完成比较档案。',
    scenario: '把两组记录放在一起，再观察有限宽双缝图样。哪些特征需要一起解释？',
    prompt: '选一组你已保存的证据，说说它支持什么结论，又不能证明什么。',
    evidence: '两类现象的证据比较档案及作品审核回执',
    methods: ['pbl-understanding-coach', 'pbl-cer-coach', 'pbl-visual-explainer'],
    domain: 'double_slit_interference', collaborator: REVIEW },
  { title: '别人能复核我的探究吗？', lead: REVIEW, phase: 'deliverable_review', objectives: ['wave-showcase', 'wave-reflection'],
    goal: '展示档案、回应质疑、根据证据修订并完成个人反思。',
    scenario: '请把你的探究讲给一个没有参加过程的人听，让对方能够找到依据。',
    prompt: '你最想展示哪条结论？先指出它对应的观察记录。',
    evidence: '最终作品、答辩回应、真实反思与归档回执',
    methods: ['pbl-artifact-revision', 'pbl-defense-coach', 'pbl-reflection-coach'], collaborator: LEAD },
];

const sessions: readonly PblTemplateSession[] = designs.map((design, index): PblTemplateSession => {
  const lesson = index + 1;
  const blocks = lesson < 3 ? THEORY : lesson === 7 ? { review: 5, theory: 20, check: 15, practice: 15, reflect: 5 }
    : lesson === 8 ? { review: 5, theory: 10, check: 15, practice: 0, reflect: 30 } : PRACTICE;
  const kinds = activities.filter(activity => blocks[activity] > 0);
  return {
    id: `wave-session-${lesson}`, sessionIndex: lesson, title: design.title, phase: design.phase,
    sessionType: lesson === 8 ? 'review' : lesson < 3 ? 'theory' : 'practice',
    objectiveIds: design.objectives, durationMinutes: 60, blocks, learningGoal: design.goal,
    leadAssistantId: design.lead, contentStrategy: 'adaptive.v1',
    opening: { version: 'lesson-opening.v1', scenario: design.scenario, prompt: design.prompt, options: [
      { id: 'start', label: '开始探究', text: design.prompt },
      { id: 'example', label: '看一个例子', text: '先用一个简单例子，帮我理解这次要比较什么。' },
      { id: 'question', label: '我有疑问', text: '我想先说说自己的疑问。' },
    ] },
    requiredSkillIds: ['tutor-guided-learning', 'pbl-dynamic-lesson', 'optics-coherent-wave-inquiry', ...design.methods],
    requiredToolIds: ['tutor.propose_wave_activity'],
    teachingRequirements: ['dynamic_lesson', 'project_knowledge'],
    activityGuidance: Object.fromEntries(kinds.map(activity => [activity,
      activity === 'review' ? '回顾已有观察或上一课证据；只讨论当前主题，不重复创建项目。'
        : activity === 'theory' ? `${design.goal} 根据当前理解推荐授权课件、生成新图示或引用后改编；先讲清一个问题。`
          : activity === 'check' ? lesson === 2 ? '通过服务端专题准备检查；求助不自动判错，未掌握则同目标补救。'
            : '根据学生本轮解释提出一个检查问题；题目可动态生成，不覆盖已有待答题。'
              : activity === 'practice' ? '先预测再使用本课注册模型；一次只改一个变量，保存参数和模拟观察，不写成实测。'
                : `${design.evidence}。用自己的话说明依据和一次修订；保存真实学习产物。`,
    ])),
    activityRequirements: kinds.map(activity => ({ activity, evidence: lesson === 2 && activity === 'check' ? 'mastery'
      : activity === 'practice' ? 'experiment_observation'
        : lesson === 7 && activity === 'reflect' ? 'submitted_artifact' : 'session_response' })),
    evidenceRequirements: [design.evidence],
    completionSpec: { version: 'learning-session-completion.v2',
      requiredMasteryObjectiveIds: lesson === 2 ? [...WAVE_OPTICS_READINESS_IDS] : [],
      requiredEvidence: [
        { kind: 'session_response', scope: 'session', minimumCount: 1 },
        ...(lesson >= 3 && lesson <= 7 ? [{ kind: 'experiment_observation' as const, scope: 'session' as const, minimumCount: lesson === 4 || lesson === 6 ? 2 : 1 }] : []),
        ...(lesson === 7 ? [{ kind: 'approved_artifact' as const, scope: 'session' as const, minimumCount: 1 }] : []),
        ...(lesson === 8 ? [{ kind: 'approved_artifact' as const, scope: 'project' as const, minimumCount: 1 }] : []),
      ],
      qualityReview: { version: 'lesson-quality.v1', reviewer: 'current_teacher', criteria: [
        { id: `wave-${lesson}-objective`, description: design.goal },
        { id: `wave-${lesson}-evidence`, description: `依据可追溯且与本课一致：${design.evidence}。` },
      ] },
    },
    ...(lesson === 2 ? { checkpoint: { requiredGate: 'TheoryMastered' as const } }
      : lesson === 7 ? { checkpoint: { requiredGate: 'experiment_report_validated' as const } }
        : lesson === 8 ? { checkpoint: { requiredGate: 'review_completed_and_archived' as const } } : {}),
    ...(design.domain ? { interactiveSpec: { enabled: true, domainTopic: design.domain, allowHypothesisPrediction: true } } : {}),
    ...(design.collaborator ? { collaborators: [{ assistantId: design.collaborator, activity: 'reflect' as const,
      trigger: 'after_evidence' as const, purpose: 'critique' as const, requiredSkillIds: ['tutor-guided-learning', 'optics-coherent-wave-inquiry'] }] } : {}),
  };
});

const policy = findGovernancePolicy('wave-optics-pbl:v1');
if (!policy) throw new Error('Wave optics governance policy unavailable');
export const WAVE_OPTICS_TEMPLATE_SPEC = parseProjectTemplateSpec({
  contractVersion: 'qitu.pbl-learning.v1', id: 'pbl-wave-interference-diffraction', version: 'v1-8s-guided',
  status: 'draft', title: '光为什么会出现明暗条纹？干涉与衍射探究',
  description: '通过双缝干涉、单缝衍射及两者联系的受控比较，完成有证据的明暗条纹探究档案。',
  targetDomain: 'physics', ageRange: { min: 13, max: 15 },
  prerequisites: ['读图与简单比较；波叠加、稳定相位关系及模型边界在专题准备中核验。'],
  materials: ['获准课件与教材', '服务端注册的单缝和双缝仿真', '模拟观察表与探究档案'],
  safetyRequirements: ['TheoryMastered 前仅展示获准低风险示意，不操作正式实践工具。',
    '本专题仅限模拟探究，不提供真实激光或器材操作指令。', '区分模型计算、模拟观察与真实测量。'],
  objectives, governancePolicyId: policy.id,
  phases: derivePhasesFromPolicyAndSessions(policy, sessions, { assignedAssistants: {
    exploration: LEAD, concept_mastery: CONCEPT, guided_practice: LAB, deliverable_review: REVIEW,
  } }),
  schedules: [{ lessonCount: 8, lessonMinutes: 60 }],
  finalDeliverableType: 'wave_optics_inquiry_portfolio', rubricId: 'wave-optics-evidence-v1',
  teamId: 'team-optics-inquiry', lessonPolicy: 'lesson-guided.v1',
  theme: { drivingQuestion: '怎样通过可复核的比较，解释单缝和双缝明暗图样，并预测改变条件后的结果？' },
  curriculum: { profiles: [{ id: WAVE_OPTICS_PROFILE_ID, schedule: { lessonCount: 8, lessonMinutes: 60 }, sessions }] },
});

export const WAVE_OPTICS_ROLE_REQUIREMENTS = [LEAD, CONCEPT, LAB, REVIEW].map(assistantId => ({
  assistantId, requiredToolIds: ['tutor.propose_lesson_activity', 'tutor.propose_wave_activity'],
  requiredSkillIds: [...new Set(sessions.filter(session => session.leadAssistantId === assistantId)
    .flatMap(session => session.requiredSkillIds ?? []))],
}));
