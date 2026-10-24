import { parseProjectTemplateSpec, type LessonActivity, type PblTemplateObjective, type PblTemplateSession } from '@qitu/contracts';
import { THUNDER_FIGHTER_PHASES } from '@qitu/ai-client';
import type { CreateTemplateInput, CreateTemplateVersionInput } from '../templates.types';

export const THUNDER_TEMPLATE_SLUG = 'thunder-fighter-zero-base';
export const THUNDER_BOOTSTRAP_KEY = 'thunder-fighter:8x60-zero-base-v2';
export const THUNDER_PROFILE_ID = 'thunder-fighter-8x60-v1';
export const THUNDER_TEAM_ID = 'team-thunder-fighter-zero-base';
export const THUNDER_THEORY_IDS = ['thunder-loop', 'thunder-coordinates', 'thunder-events', 'thunder-collision'] as const;
export const THUNDER_TEACHING_SKILLS = ['tutor-guided-learning', 'pbl-dynamic-lesson', 'pbl-understanding-coach',
  'pbl-visual-explainer', 'pbl-concept-probe', 'pbl-artifact-revision', 'pbl-reflection-coach'];
const CONCEPT = 'fighter-concept-coach', CODE = 'fighter-code-guide', REVIEW = 'fighter-review-assessor';
const objectives: readonly PblTemplateObjective[] = [
  { id: 'thunder-design', title: '定义我的第一版游戏', kind: 'design', prerequisiteIds: [], description: '用玩家、目标、操作和输赢条件说明一个可实现的最小飞行射击游戏。' },
  { id: 'thunder-loop', title: '游戏循环与程序状态', kind: 'concept', conceptId: 'thunder.loop', prerequisiteIds: [], description: '从变量、条件与重复开始，解释每帧处理事件、更新状态、绘制画面与刷新显示的顺序。' },
  { id: 'thunder-coordinates', title: '屏幕坐标与边界', kind: 'concept', conceptId: 'thunder.coordinates', prerequisiteIds: [], description: '认识屏幕左上角原点与向下增加的 y 坐标，预测移动后的坐标并解释边界限制。' },
  { id: 'thunder-events', title: '输入与运动', kind: 'concept', conceptId: 'thunder.events', prerequisiteIds: ['thunder-loop'], description: '区分按下一次和持续按住，解释输入如何改变速度，以及帧率与时间步长的区别。' },
  { id: 'thunder-collision', title: '矩形碰撞判断', kind: 'concept', conceptId: 'thunder.collision', prerequisiteIds: ['thunder-coordinates'], description: '先用图示判断矩形是否重叠，再说明碰撞如何改变分数、生命和游戏状态。' },
  { id: 'thunder-player', title: '窗口与玩家移动', kind: 'procedure', prerequisiteIds: ['thunder-loop', 'thunder-coordinates', 'thunder-events'], description: '在本地创建 Pygame 窗口并实现方向控制、边界限制和正常退出，提交代码与测试记录。' },
  { id: 'thunder-projectiles', title: '子弹与敌机', kind: 'procedure', prerequisiteIds: ['thunder-player', 'thunder-loop', 'thunder-events'], description: '逐步实现子弹发射、敌机生成与移出屏幕后的清理，记录一次调试过程。' },
  { id: 'thunder-rules', title: '计分、生命与重开', kind: 'design', prerequisiteIds: ['thunder-projectiles', 'thunder-collision'], description: '连接碰撞、得分、生命与游戏结束状态，测试连击、越界与重新开始。' },
  { id: 'thunder-playable', title: '可玩的第一版作品', kind: 'design', prerequisiteIds: ['thunder-rules', 'thunder-loop'], description: '整合可运行源码、环境说明、实机试玩记录和缺陷清单，提交作品供审核。' },
  { id: 'thunder-reflection', title: '答辩与改进', kind: 'reflection', prerequisiteIds: ['thunder-playable'], description: '用自己的代码和试玩证据解释设计选择，说明解决的一个问题和下一步改进。' },
];
const lessons = [
  { title: '我的战机游戏怎么玩？', phase: 'exploration', lead: CONCEPT, ids: ['thunder-design'], prompt: '先不写代码。你希望玩家控制什么，用什么方式得分，什么时候游戏结束？' },
  { title: '画面为什么会动？循环与坐标', phase: 'concept_mastery', lead: CONCEPT, ids: ['thunder-loop', 'thunder-coordinates'], prompt: '把连续画面想成一张张翻页图。先看战机的位置怎样用两个数字表示，再预测下一帧会在哪里。' },
  { title: '按键与碰撞怎样变成规则？', phase: 'concept_mastery', lead: CONCEPT, ids: ['thunder-events', 'thunder-collision'], prompt: '先画两个小矩形，判断何时算碰撞；再解释按住方向键和只按一下有什么不同。' },
  { title: '让第一架战机动起来', phase: 'guided_practice', lead: CODE, ids: ['thunder-player'], prompt: '先确认基础检查已经通过。接下来只完成窗口、退出和玩家移动，每次只增加一个可验证功能。' },
  { title: '加入子弹与敌机', phase: 'guided_practice', lead: CODE, ids: ['thunder-projectiles'], prompt: '先让一个子弹向上移动，再考虑多颗子弹与敌机。哪些对象离开屏幕后应当清理？' },
  { title: '完成得分、生命和重新开始', phase: 'guided_practice', lead: CODE, ids: ['thunder-rules'], prompt: '用一张状态图说明：击中敌机、玩家受伤和点击重新开始，分别改变哪些数据？' },
  { title: '测试并交付可玩的游戏', phase: 'guided_practice', lead: CODE, ids: ['thunder-playable'], prompt: '请另一位试玩者按你的环境说明启动游戏。先记录实际结果，再修复一个影响游玩的缺陷。' },
  { title: '展示作品，解释我的设计', phase: 'deliverable_review', lead: REVIEW, ids: ['thunder-reflection'], prompt: '选一段你真正理解的代码，结合一次测试说明它解决了什么问题，以及你怎样验证。' },
] satisfies readonly { title: string; phase: PblTemplateSession['phase']; lead: string; ids: readonly string[]; prompt: string }[];
const activities: readonly LessonActivity[] = ['review', 'theory', 'check', 'practice', 'reflect'];
const sessions = lessons.map((lesson, index): PblTemplateSession => {
  const n = index + 1, practical = lesson.phase === 'guided_practice';
  const blocks = practical ? { review: 5, theory: 15, check: 10, practice: 25, reflect: 5 }
    : n === 8 ? { review: 5, theory: 10, check: 15, practice: 0, reflect: 30 }
      : { review: 5, theory: 25, check: 20, practice: 0, reflect: 10 };
  const kinds = activities.filter(activity => blocks[activity] > 0);
  const mastery = lesson.phase === 'concept_mastery' ? [...lesson.ids] : [];
  return {
    id: `thunder-session-${n}`, sessionIndex: n, title: lesson.title, phase: lesson.phase,
    sessionType: practical ? 'practice' : n === 8 ? 'review' : 'theory', objectiveIds: lesson.ids,
    durationMinutes: 60, blocks, learningGoal: lesson.ids.map(id => objectives.find(o => o.id === id)!.description).join('\n'),
    leadAssistantId: lesson.lead, contentStrategy: 'adaptive.v1',
    opening: { version: 'lesson-opening.v1', scenario: lesson.title, prompt: lesson.prompt, options: [
      { id: 'start', label: '开始当前活动', text: lesson.prompt },
      { id: 'example', label: '我从零开始', text: '请从我完全不会开始，先解释一个概念，用图示演示，再让我尝试。' },
      { id: 'help', label: '我有疑问', text: '我想先说说自己卡住的地方。' },
    ] },
    requiredSkillIds: THUNDER_TEACHING_SKILLS, requiredToolIds: ['tutor.propose_lesson_activity'],
    teachingRequirements: ['dynamic_lesson'],
    activityGuidance: {
      review: '联系上一课已保存的证据；第一课先了解兴趣，不预设已有编程知识。',
      theory: '每次只解释一个新词或代码结构，用注册 BoardBlock、流程图或坐标示意演示，再让学生预测和解释。依据本课课程目标教学；没有编程知识库来源时明确是教学示例，不伪称检索过教材。',
      check: mastery.length ? '先完成讲解和示例，再通过正式题目检查本课目标；求助不替换待答题，未掌握时同目标补救。'
        : '请学生结合自己的图示、代码或测试说明理由，再给下一条有界提示。',
      ...(practical ? { practice: '仅在 TheoryMastered 后指导学生在自己的受控本地环境编写和运行代码。记录代码与实际测试，不执行模型生成的任意代码，不将静态语法通过宣称为可玩。' } : {}),
      reflect: n === 7 ? '提交源码、启动说明、实机试玩证据和缺陷修复记录，等待作品 owner 审核。'
        : '保存自己的解释、修改与测试证据，说明一个理解变化；最终反思仍需 owner 回执才算归档。',
    },
    activityRequirements: kinds.map(activity => ({ activity, evidence: activity === 'check' && mastery.length ? 'mastery'
      : n === 7 && activity === 'reflect' ? 'submitted_artifact' : 'session_response' })),
    evidenceRequirements: [n === 7 ? '源码、依赖与启动说明、试玩记录及作品审核回执' : '学生本人解释、设计或代码测试记录'],
    completionSpec: { version: 'learning-session-completion.v2', requiredMasteryObjectiveIds: mastery,
      requiredEvidence: [{ kind: 'session_response', scope: 'session', minimumCount: 1 },
        ...(n === 7 || n === 8 ? [{ kind: 'approved_artifact' as const, scope: 'project' as const, minimumCount: 1 }] : [])],
      qualityReview: { version: 'lesson-quality.v1', reviewer: 'current_teacher', criteria: [
        { id: `thunder-${n}-understanding`, description: '能结合本课目标用自己的话解释过程和依据。' },
        { id: `thunder-${n}-evidence`, description: practical ? '代码、测试输入和实际结果相互对应；不把静态检查当成可玩验证。' : '已保存与本课一致的真实学习回应或正式考核回执。' },
      ] },
    },
    ...(n === 3 ? { checkpoint: { requiredGate: 'TheoryMastered' } }
      : n === 7 ? { checkpoint: { requiredGate: 'code_playable_run_verified' } }
        : n === 8 ? { checkpoint: { requiredGate: 'review_completed_and_archived' } } : {}),
  };
});
export const THUNDER_TEMPLATE_SPEC = parseProjectTemplateSpec({
  contractVersion: 'qitu.pbl-learning.v1', id: 'pbl-thunder-fighter', version: 'v2-8s-zero-base', status: 'draft',
  title: '雷霆战机', description: '从零理解循环、坐标、输入和碰撞，逐步编写 Python/Pygame 飞行射击小游戏，完成测试、展示与反思。',
  targetDomain: 'programming_game_dev', ageRange: { min: 12, max: 18 },
  prerequisites: ['不预设会编程；从变量、条件、循环和坐标图开始。'],
  materials: ['可安装 Python 3 与 Pygame 的电脑', '本地编辑器', '学生原创或获授权的游戏素材', '测试记录表'],
  safetyRequirements: ['TheoryMastered 前学习概念与图示，正式代码实践由服务端门禁控制。', '只安装可信来源的开发依赖，不提供账号密码或系统密钥。', '教学对话不运行模型生成的任意 HTML/JS 或系统命令；代码在学生受控环境中运行。'],
  objectives, phases: THUNDER_FIGHTER_PHASES.map(phase => ({ phase: phase.phase, title: phase.title,
    objectiveIds: [...new Set(sessions.filter(s => s.phase === phase.phase).flatMap(s => s.objectiveIds))],
    gateCondition: phase.gateCondition, deliverableType: phase.deliverableType ?? null,
    evidenceProfile: phase.evidenceProfile ?? null, assignedAssistantId: phase.phase === 'exploration' ? CONCEPT : phase.assignedAssistantId,
  })),
  schedules: [{ lessonCount: 8, lessonMinutes: 60 }], finalDeliverableType: 'runnable_python_game',
  rubricId: 'thunder-playable-game-v1', teamId: THUNDER_TEAM_ID, lessonPolicy: 'lesson-guided.v1',
  theme: { drivingQuestion: '怎样从一个玩法想法出发，做出能控制、能得分、能失败重开的飞行射击小游戏，并证明它能玩？' },
  curriculum: { profiles: [{ id: THUNDER_PROFILE_ID, schedule: { lessonCount: 8, lessonMinutes: 60 }, sessions }] },
});
export const THUNDER_TEMPLATE_INPUT: CreateTemplateInput = {
  schoolId: null, slug: THUNDER_TEMPLATE_SLUG, title: THUNDER_TEMPLATE_SPEC.title, summary: THUNDER_TEMPLATE_SPEC.description,
  domain: 'programming_game_dev', ageRange: '12–18', difficulty: 'introductory', estimatedDurationMinutes: 480,
  requiredMaterials: [...THUNDER_TEMPLATE_SPEC.materials], learningObjectives: objectives.map(o => o.description),
  outcomeForm: '可玩的 Python/Pygame 飞行射击小游戏与测试档案', safetyNotes: THUNDER_TEMPLATE_SPEC.safetyRequirements.join('\n'),
};
export const THUNDER_VERSION_INPUT: CreateTemplateVersionInput = {
  stages: THUNDER_TEMPLATE_SPEC.phases.map(phase => ({ id: phase.phase, label: phase.title })),
  content: { bootstrapKey: THUNDER_BOOTSTRAP_KEY, pbl: THUNDER_TEMPLATE_SPEC, authoringReferences: [
    'https://www.pygame.org/docs/', 'https://www.pygame.org/docs/ref/rect.html', 'https://docs.python.org/3/tutorial/controlflow.html',
  ] },
  rubric: [{ id: 'playability', label: '可玩性', description: '可启动、可操作、可得分、有失败和重开，并有实机试玩证据。' },
    { id: 'understanding', label: '理解与调试', description: '能解释自己的核心代码，并展示一次可复核的调试和修订。' }],
};
