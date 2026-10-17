import type {
  GetTutorSessionResponse,
  ProjectSummary,
  RealtimeServerEvent,
  TemplateStage,
  TutorSessionSummary,
  TutorTurn,
} from '@qitu/contracts';
import type { TutorProjectContext } from '../types';

export const MOCK_SESSION_ID = 'session-demo-001';
export const MOCK_PROJECT_ID = 'pbl-thunder-fighter';

export const MOCK_ACTIVE_PROJECT: ProjectSummary = {
  id: MOCK_PROJECT_ID,
  title: '雷霆战机：从零打造 Python 飞行射击小游戏',
  stage: 'theory_learning',
  progress: 40,
};

/** Frozen-template stage labels for the display rail. */
export const MOCK_STAGES: TemplateStage[] = [
  { id: 'exploration', label: '探索' },
  { id: 'intent_confirmed', label: '确认意图' },
  { id: 'theory_learning', label: '核心原理' },
  { id: 'theory_check', label: '原理掌握' },
  { id: 'practice_ready', label: '代码就绪' },
  { id: 'practice_building', label: '战机制作' },
  { id: 'artifact_review', label: '作品评审' },
  { id: 'reflection', label: '反思总结' },
  { id: 'published', label: '已发布' },
  { id: 'completed', label: '完成' },
];

/**
 * Left-column display projection. `progress` is server-computed and
 * illustrative only; `project.stage` is the single stage truth.
 */
export const MOCK_PROJECT_CONTEXT: TutorProjectContext = {
  project: MOCK_ACTIVE_PROJECT,
  progress: { currentStageIndex: 2, stageTotal: 10, progressPercent: 40 },
  stages: MOCK_STAGES,
  currentTask: {
    id: 'task-game-loop-and-aabb',
    title: '搞懂原理：游戏主循环与矩形碰撞检测',
    detail: '在战机概念教练引导下，理解事件更新绘制三步法与 AABB 几何相交原理。',
    isTodayFocus: true,
  },
  team: {
    teamId: 'team-demo-tutor',
    teamName: '雷霆战机团队',
    assistantId: 'fighter-concept-coach',
    assistantName: '概念教练',
    assistantAvatar: '🚀',
  },
  phases: [
    {
      phaseId: 'phase-concept', orderIndex: 1, name: '核心原理探索',
      assignedAssistantName: '概念教练', assignedRole: 'coach',
      requiresGateApproval: true, gateStatus: 'pending', status: 'active',
      requiredDeliverables: [{ id: 'deliverable-loop', title: '游戏主循环理解记录', submitted: false }],
    },
  ],
};

export const MOCK_TEAM_GRAPH: import('@qitu/contracts').TutorTeamGraph = {
  team: {
    teamId: 'team-demo-tutor',
    teamName: '雷霆战机团队',
    assistantId: 'fighter-concept-coach',
    assistantName: '概念教练',
    assistantAvatar: '🚀',
  },
  runId: 'run-demo-tutor',
  agents: [
    {
      slotId: 'slot-concept', assistantId: 'fighter-concept-coach', name: '概念教练',
      role: 'concept_coach', roleLabel: '概念教练', avatar: '🚀', color: '#2563eb',
      status: 'ready', currentTaskSummary: '引导理解游戏主循环与碰撞检测原理', pblPhase: 'concept_mastery',
      messages: [{ messageId: 'message-demo-1', summary: '已整理当前阶段的概念引导重点。', direction: 'outbound', createdAt: '2026-09-26T02:00:00.000Z' }],
      toolCalls: [{ callId: 'tool-demo-1', name: 'query_mastery_status', label: '查询掌握度与门禁状态', status: 'done', summary: '理论阶段待评估。', startedAt: '2026-09-26T02:00:00.000Z', finishedAt: '2026-09-26T02:00:01.000Z' }],
    },
  ],
};

/**
 * Initial persisted turns returned by `GET /tutor/session`. They exercise
 * the `questions` / `text` / `options` / `evidence` reply variants and carry
 * seq 1..6; live replay continues from seq 7.
 */
export const MOCK_TURNS: TutorTurn[] = [
  {
    turnId: 'turn-1',
    role: 'assistant',
    author: {
      id: 'fighter-concept-coach',
      name: '概念教练',
      role: '概念教练',
      color: '#2563eb',
    },
    blocks: [
      {
        kind: 'pbl_card',
        phase: 'concept_mastery',
        title: '项目阶段二：核心原理探索（启途互动课堂）',
        teammateLabel: '🕹️ 战机原理与概念教练',
        summary: '我们要一起制作《雷霆战机》小游戏。在动手写 Pygame 代码之前，我们先搞懂游戏的核心脉搏：游戏主循环（Game Loop）和坐标系移动。',
        tags: ['游戏主循环', '坐标系与向量', '碰撞检测几何原理'],
        actionLabel: '开始探索游戏循环',
      },
      {
        kind: 'think',
        content: '学生正在开启《雷霆战机》PBL 项目。遵循教学硬规则：在 TheoryMastered 达成之前不得进入代码实践阶段。当前步骤需要引导学生思考：游戏画面是如何动起来的？从帧率与状态更新切入，提问启发。',
        closed: true,
      },
      {
        kind: 'tool',
        call: {
          callId: 'call-check-mastery-1',
          name: 'query_mastery_status',
          label: '查询学生当前掌握度与门禁状态',
          status: 'done',
          result: '理论阶段待评估，未达 TheoryMastered，保持概念引导模式',
        },
      },
      {
        kind: 'questions',
        items: [
          '你在玩飞行射击游戏时，画面为什么能流畅地显示战机向前飞？',
          '如果一秒钟刷新 60 次画面，战机每帧向 y 轴负方向移动 5 个像素，视觉上会有什么效果？',
        ],
      },
    ],
    hintLevel: null,
    stageBefore: 'theory_learning',
    stageAfter: 'theory_learning',
    seq: 1,
    createdAt: '2026-09-26T02:00:00.000Z',
    modality: 'text',
  },
  {
    turnId: 'turn-2',
    role: 'student',
    blocks: [{ kind: 'text', text: '我觉得就像翻动画书一样，每秒刷新很多张图，每次飞机的位置往上移一点点！' }],
    hintLevel: null,
    stageBefore: null,
    stageAfter: null,
    seq: 2,
    createdAt: '2026-09-26T02:01:00.000Z',
    modality: 'text',
  },
  {
    turnId: 'turn-3',
    role: 'assistant',
    author: {
      id: 'fighter-concept-coach',
      name: '概念教练',
      role: '概念教练',
      color: '#2563eb',
    },
    blocks: [
      {
        kind: 'think',
        content: '学生的回答非常敏锐！准确抓住了动画书（帧刷新）与位置增量的核心本质。下一步引导：建立游戏主循环的三个标准步骤（事件监听、状态更新、渲染绘制），并提问 options。',
        closed: true,
      },
      {
        kind: 'tool',
        call: {
          callId: 'call-concept-link-1',
          name: 'search_knowledge_chunk',
          label: '检索知识库：Pygame 游戏主循环标准模型',
          status: 'done',
          result: '命中知识点：while running 循环、clock.tick(60)、pygame.display.flip()',
        },
      },
      {
        kind: 'text',
        text: '太棒了！你的「翻动画书」比喻完全击中了游戏引擎的核心秘密。在 Pygame 中，我们把这个不断循环翻页的过程叫做「游戏主循环（Game Loop）」。',
      },
      {
        kind: 'options',
        items: [
          { label: 'A', text: '第一步：听用户的指令（如按上方向键）' },
          { label: 'B', text: '第二步：计算新位置（飞机 y 坐标减小）' },
          { label: 'C', text: '第三步：把新的战机画在屏幕上并刷新' },
        ],
        allowOther: true,
      },
    ],
    hintLevel: null,
    stageBefore: 'theory_learning',
    stageAfter: 'theory_learning',
    seq: 3,
    createdAt: '2026-09-26T02:02:00.000Z',
    modality: 'text',
  },
  {
    turnId: 'turn-4',
    role: 'student',
    blocks: [{ kind: 'text', text: '这三个步骤在每一帧都会按顺序发生一次对吗？那子弹碰到敌机是怎么判定的？' }],
    hintLevel: null,
    stageBefore: null,
    stageAfter: null,
    seq: 4,
    createdAt: '2026-09-26T02:03:00.000Z',
    modality: 'text',
  },
  {
    turnId: 'turn-5',
    role: 'assistant',
    author: {
      id: 'fighter-concept-coach',
      name: '概念教练',
      role: '概念教练',
      color: '#2563eb',
    },
    blocks: [
      {
        kind: 'think',
        content: '学生主动提出了第二大核心概念：碰撞检测（Collision Detection）。需要先解释几何包围盒矩形（Rect / AABB）相交原理，然后再做理论掌握度检测。',
        closed: true,
      },
      {
        kind: 'tool',
        call: {
          callId: 'call-collision-math-1',
          name: 'math_aabb_explainer',
          label: '调用几何碰撞检测计算器 (AABB Rect Overlap)',
          status: 'done',
          result: '判定公式：rect1.x < rect2.x + rect2.w && rect1.x + rect1.w > rect2.x',
        },
      },
      {
        kind: 'text',
        text: '完全正确！每一帧都在按顺序快速发生。至于子弹击中敌机，计算机把子弹和战机都看作一个透明的矩形盒子（Bounding Box）。只要两个矩形在 x 和 y 方向上同时发生了重叠，就被判定为「命中」！',
      },
      {
        kind: 'evidence',
        ref: '游戏编程思维导引：坐标系与轴对齐矩形碰撞（AABB）',
      },
      {
        kind: 'quiz',
        questionId: 'quiz-aabb-check',
        stem: '【启发式问答】如果子弹的 x 坐标是 100，宽度是 10；敌机的 x 坐标是 120，宽度是 20。请问此时在水平方向上发生碰撞了吗？',
        type: 'heuristic',
        options: [
          { key: 'A', text: '发生了碰撞，因为两个物体的距离小于 30', hint: '注意：子弹的最右端是 100+10=110，还没有触碰到敌机最左端的 120 噢！' },
          { key: 'B', text: '没有发生碰撞，子弹的最右边(110)还未到达敌机最左边(120)', hint: '非常敏锐！区间 [100, 110] 与 [120, 140] 在 x 轴上没有交集。' },
          { key: 'C', text: '无法判断，必须先知道 y 轴高度', hint: '只要任意一根轴没有交集，就一定不碰撞！' },
        ],
        explanation: '在二维空间中，两个矩形发生碰撞必须满足：X 轴方向有重叠，并且 Y 轴方向也有重叠。任一维度未重合即表示未相交。',
      },
      {
        kind: 'artifact',
        fileName: 'game_loop_and_collision_prototype.py',
        fileType: 'code',
        title: '游戏主循环与碰撞检测验证代码',
        summary: '搭档为你整理的轻量验证脚本，实现了 60FPS 事件监听、矩形更新与相交算法。',
        content: `import pygame\nimport sys\n\n# 初始化 Pygame\npygame.init()\nscreen = pygame.display.set_mode((480, 700))\nclock = pygame.time.Clock()\n\n# 玩家战机与敌机矩形\nplayer_rect = pygame.Rect(200, 550, 40, 40)\nenemy_rect = pygame.Rect(200, 100, 40, 40)\n\n# 游戏主循环\nwhile True:\n    for event in pygame.event.get():\n        if event.type == pygame.QUIT:\n            pygame.quit()\n            sys.exit()\n\n    # 碰撞检测判定\n    is_hit = player_rect.colliderect(enemy_rect)\n    screen.fill((16, 42, 92))\n    pygame.display.flip()\n    clock.tick(60)`,
        sizeText: '2.4 KB',
        nodeRef: '核心原理 03',
      },
    ],
    hintLevel: null,
    stageBefore: 'theory_learning',
    stageAfter: 'theory_learning',
    seq: 5,
    createdAt: '2026-09-26T02:04:00.000Z',
    modality: 'text',
  },
];

export const MOCK_SESSION: GetTutorSessionResponse = {
  sessionId: MOCK_SESSION_ID,
  projectId: MOCK_PROJECT_ID,
  explorationId: null,
  source: 'project',
  context: {
    kind: 'project',
    label: '项目学习',
    status: 'confirmed',
    projectId: MOCK_PROJECT_ID,
  },
  turns: MOCK_TURNS,
  lastSeq: 6,
};

export const MOCK_SUMMARY: TutorSessionSummary = {
  summary: '正在围绕「光合作用」连续引导，当前提示等级 1。',
  lastHintLevel: 1,
  stallCount: 0,
  escalated: false,
};

export const MOCK_STREAM_TURN_ID = 'turn-stream-7';

/**
 * Live / replayable events with monotonic seq starting after the persisted
 * turns. Delivered through `stream.replay` on subscribe so a reconnect from a
 * newer cursor naturally yields an empty (or partial) batch.
 */
export const MOCK_STREAM_EVENTS: RealtimeServerEvent[] = [
  {
    type: 'tutor.block',
    sessionId: MOCK_SESSION_ID,
    turnId: MOCK_STREAM_TURN_ID,
    seq: 7,
    timestamp: '2026-09-26T02:06:00.000Z',
    block: { kind: 'hint', level: 1, text: '先想一想：叶子抓住光的那部分叫什么？' },
  },
  {
    type: 'turn.done',
    sessionId: MOCK_SESSION_ID,
    turnId: MOCK_STREAM_TURN_ID,
    seq: 8,
    timestamp: '2026-09-26T02:06:01.000Z',
    turnSummary: { hintLevel: 1, stage: 'theory_learning' },
  },
];

/** Build a `stream.replay` envelope containing only events after `afterSeq`. */
export function createMockReplayEvent(afterSeq: number): RealtimeServerEvent {
  const events = MOCK_STREAM_EVENTS.filter((event) => event.seq > afterSeq);
  const lastEvent = events[events.length - 1];
  const seq = lastEvent !== undefined ? lastEvent.seq : afterSeq;
  return {
    type: 'stream.replay',
    sessionId: MOCK_SESSION_ID,
    turnId: '',
    seq,
    timestamp: '2026-09-26T02:06:02.000Z',
    events,
    nextSeq: seq + 1,
    cursorValid: true,
  };
}
