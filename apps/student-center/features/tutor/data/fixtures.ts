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
export const MOCK_PROJECT_ID = 'proj-plant-1001';

export const MOCK_ACTIVE_PROJECT: ProjectSummary = {
  id: MOCK_PROJECT_ID,
  title: '校园植物观察手册',
  stage: 'theory_learning',
  progress: 35,
};

/** Frozen-template stage labels for the display rail. */
export const MOCK_STAGES: TemplateStage[] = [
  { id: 'exploration', label: '探索' },
  { id: 'intent_confirmed', label: '确认意图' },
  { id: 'theory_learning', label: '理论学习' },
  { id: 'theory_check', label: '理论检验' },
  { id: 'practice_ready', label: '实践就绪' },
  { id: 'practice_building', label: '动手制作' },
  { id: 'artifact_review', label: '作品评审' },
  { id: 'reflection', label: '反思' },
  { id: 'published', label: '已发布' },
  { id: 'completed', label: '完成' },
];

/**
 * Left-column display projection. `progress` is server-computed and
 * illustrative only; `project.stage` is the single stage truth.
 */
export const MOCK_PROJECT_CONTEXT: TutorProjectContext = {
  project: MOCK_ACTIVE_PROJECT,
  progress: { currentStageIndex: 2, stageTotal: 10, progressPercent: 35 },
  stages: MOCK_STAGES,
  currentTask: {
    id: 'task-photosynthesis',
    title: '查一查：植物为什么需要阳光',
    detail: '找到 2 条证据，用自己的话说清楚光合作用。',
    isTodayFocus: true,
  },
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
    blocks: [
      {
        kind: 'questions',
        items: ['你觉得植物为什么需要阳光？', '如果把它放进黑暗的柜子里，你猜会发生什么？'],
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
    blocks: [{ kind: 'text', text: '我觉得它要靠阳光制造养分。' }],
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
    blocks: [
      {
        kind: 'options',
        items: [
          { label: 'A', text: '阳光给叶子提供能量' },
          { label: 'B', text: '阳光只是让植物暖和' },
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
    blocks: [{ kind: 'text', text: '我选 A。' }],
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
    blocks: [{ kind: 'evidence', ref: '科学课本 p.42 光合作用' }],
    hintLevel: null,
    stageBefore: 'theory_learning',
    stageAfter: 'theory_learning',
    seq: 5,
    createdAt: '2026-09-26T02:04:00.000Z',
    modality: 'text',
  },
  {
    turnId: 'turn-6',
    role: 'student',
    blocks: [{ kind: 'text', text: '可是叶子到底怎么把光变成养分的？我还是不太明白。' }],
    hintLevel: null,
    stageBefore: null,
    stageAfter: null,
    seq: 6,
    createdAt: '2026-09-26T02:05:00.000Z',
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
