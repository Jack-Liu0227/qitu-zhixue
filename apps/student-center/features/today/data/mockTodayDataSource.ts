/**
 * Mock today data source.
 *
 * All fixture data for the 今天 module lives here, behind the single
 * `TodayDataSource` interface. Components never import fixtures directly.
 */
import { ApiError } from '@qitu/api-client';

import type { ActiveProjectSummary, NotificationList, TodayView } from '../types';
import type { TodayDataSource, TodayScenario } from './todayDataSource';

export interface MockTodayDataSourceOptions {
  scenario?: TodayScenario;
  /** Simulated network latency so the loading state is observable. */
  latencyMs?: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

const READY_VIEW: TodayView = {
  date: '2026-09-26',
  greetingName: '小启',
  avatarUrl: null,
  hasActiveProject: true,
  tasks: [
    {
      id: 'task-1',
      projectId: 'proj-1',
      stageId: 'stage-3',
      stageName: '理论学习',
      title: '完成「光线传感器」原理小测',
      description: '先看懂原理，再动手搭建。',
      isTodayFocus: true,
      status: 'todo',
      actionTarget: '/student/projects/proj-1/theory',
    },
    {
      id: 'task-2',
      projectId: 'proj-1',
      stageId: 'stage-3',
      stageName: '理论学习',
      title: '用自己的话复述原理',
      description: '向 AI搭档讲一遍你已经理解的部分。',
      isTodayFocus: false,
      status: 'todo',
      actionTarget: '/student/tutor/proj-1',
    },
  ],
  suggestion: {
    id: 'sug-1',
    title: '先试试分解问题',
    body: '你已经知道传感器会随光线变化，试着先说说它可能由哪几部分组成。',
    computedAt: '2026-09-26T08:00:00.000Z',
  },
  directions: [
    {
      templateId: 'tpl-robot',
      title: '桌面AI机器人',
      subtitle: '做一个会回应你的小机器人',
      coverUrl: '',
      href: '/student/inspiration?template=tpl-robot',
    },
    {
      templateId: 'tpl-study',
      title: '智能学习助手',
      subtitle: '让学习计划自己动起来',
      coverUrl: '',
      href: '/student/inspiration?template=tpl-study',
    },
    {
      templateId: 'tpl-story',
      title: '互动故事角色',
      subtitle: '让角色听懂你的选择',
      coverUrl: '',
      href: '/student/inspiration?template=tpl-story',
    },
  ],
  quickStart: {
    enabled: true,
    mode: 'navigate',
    exploreHref: '/student/inspiration',
  },
  stats: {
    streakDays: 3,
    tasksCompletedThisWeek: 5,
    projectsInProgress: 1,
  },
};

const READY_PROJECT: ActiveProjectSummary = {
  id: 'proj-1',
  title: '环境光线小夜灯',
  subtitle: '用传感器做一个会自己亮起的灯',
  coverUrl: '',
  templateVersionId: 'tpl-robot@v1',
  stage: 'theory_learning',
  stageIndex: 3,
  stageTotal: 4,
  progressPercent: 45,
  stages: [
    { index: 1, stageId: 'stage-1', name: '探索', status: 'done' },
    { index: 2, stageId: 'stage-2', name: '确认想法', status: 'done' },
    { index: 3, stageId: 'stage-3', name: '理论学习', status: 'active' },
    { index: 4, stageId: 'stage-4', name: '动手实践', status: 'pending' },
  ],
};

const READY_NOTIFICATIONS: NotificationList = {
  unreadCount: 1,
  items: [
    {
      id: 'note-1',
      type: 'mentor_todo',
      title: '班主任给你留了一条任务提醒',
      createdAt: '2026-09-26T07:30:00.000Z',
      targetHref: '/student/projects/proj-1',
    },
  ],
};

const EMPTY_VIEW: TodayView = {
  date: '2026-09-26',
  greetingName: '小启',
  avatarUrl: null,
  hasActiveProject: false,
  tasks: [],
  suggestion: null,
  directions: READY_VIEW.directions,
  quickStart: {
    enabled: true,
    mode: 'navigate',
    exploreHref: '/student/inspiration',
  },
  stats: {
    streakDays: 0,
    tasksCompletedThisWeek: 0,
    projectsInProgress: 0,
  },
};

const EMPTY_NOTIFICATIONS: NotificationList = { unreadCount: 0, items: [] };

function errorFor(scenario: TodayScenario): ApiError | null {
  if (scenario === 'error') {
    return new ApiError('今天的服务暂时不可用', 500, 'INTERNAL_ERROR');
  }
  if (scenario === 'permission-denied') {
    return new ApiError('当前账号无权访问', 403, 'FORBIDDEN');
  }
  if (scenario === 'offline') {
    return new ApiError('网络不可用', 0, 'NETWORK_OFFLINE');
  }
  return null;
}

export function createMockTodayDataSource(options: MockTodayDataSourceOptions = {}): TodayDataSource {
  const scenario = options.scenario ?? 'ready';
  const latencyMs = options.latencyMs ?? 250;

  async function resolve<T>(value: T): Promise<T> {
    await delay(latencyMs);
    return clone(value);
  }

  async function fail(error: ApiError): Promise<never> {
    await delay(latencyMs);
    throw error;
  }

  const failure = errorFor(scenario);

  return {
    async getToday() {
      if (failure) return fail(failure);
      return resolve(scenario === 'empty' ? EMPTY_VIEW : READY_VIEW);
    },
    async getActiveProject() {
      if (failure) return fail(failure);
      return resolve(scenario === 'empty' ? null : READY_PROJECT);
    },
    async getNotifications() {
      if (failure) return fail(failure);
      return resolve(scenario === 'empty' ? EMPTY_NOTIFICATIONS : READY_NOTIFICATIONS);
    },
  };
}
