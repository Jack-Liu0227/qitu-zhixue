import type { ActiveProjectSummary, IdeaDirection, NotificationList, TodayTask, TodayView } from '../types';
import type { TodayDataSource } from './todayDataSource';

const FALLBACK_DIRECTIONS: IdeaDirection[] = [
  {
    templateId: 'template-python-mini-project',
    title: '雷霆战机小游戏 PBL',
    subtitle: '基于 Pygame 打造具有主循环与 AABB 碰撞检测的太空射击游戏',
    coverUrl: '',
    href: '/student/inspiration?template=template-python-mini-project',
  },
  {
    templateId: 'template-kinetic-energy',
    title: '动手学动能定理 PBL',
    subtitle: '合外力做功与动能变化规律仿真探究与 Python 数值绘图',
    coverUrl: '',
    href: '/student/inspiration?template=template-kinetic-energy',
  },
];

export class ApiTodayDataSource implements TodayDataSource {
  private async fetchJson<T>(url: string): Promise<T | null> {
    try {
      const res = await fetch(url, {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      });
      if (!res.ok) return null;
      const json = await res.json();
      return (json.data ?? json) as T;
    } catch {
      return null;
    }
  }

  async getToday(): Promise<TodayView> {
    // 1. 获取真实模板列表以动态生成探索推荐 (IdeaDirection)
    let directions: IdeaDirection[] = [];
    try {
      const templates = await this.fetchJson<Array<{ id: string; title: string; summary?: string }>>('/api/v1/project-templates') ||
                        await this.fetchJson<Array<{ id: string; title: string; summary?: string }>>('/api/v1/admin/project-templates');
      if (templates && templates.length > 0) {
        directions = templates.map((t) => ({
          templateId: t.id,
          title: t.title,
          subtitle: t.summary || (t.id.includes('thunder') || t.id.includes('python') ? 'Pygame 游戏引擎与碰撞算法' : '动能与做功物理探究'),
          coverUrl: '',
          href: `/student/inspiration?template=${encodeURIComponent(t.id)}`,
        }));
      }
    } catch {
      // 容错降级
    }

    if (directions.length === 0) {
      directions = FALLBACK_DIRECTIONS;
    }

    // 2. 获取学生真实项目与当前任务
    let activeTasks: TodayTask[] = [];
    let hasActiveProject = false;
    try {
      const projects = await this.fetchJson<Array<{ id: string; status: string; title: string }>>('/api/v1/projects');
      if (projects && projects.length > 0) {
        const active = projects.find((p) => p.status !== 'completed' && p.status !== 'archived') || projects[0];
        if (active) {
          hasActiveProject = true;
          const overview = await this.fetchJson<{ tasks?: Array<{ id: string; title: string; description?: string; stageName?: string; status?: string }> }>(`/api/v1/projects/${encodeURIComponent(active.id)}/overview`);
          if (overview?.tasks && overview.tasks.length > 0) {
            activeTasks = overview.tasks.slice(0, 3).map((t, idx) => ({
              id: t.id || `task-${idx}`,
              projectId: active.id,
              stageId: 'stage-current',
              stageName: t.stageName || '当前阶段',
              title: t.title,
              description: t.description || '按引导完成沙箱探究或理论反思。',
              isTodayFocus: idx === 0,
              status: (t.status === 'done' || t.status === 'completed' ? 'done' : 'todo') as 'todo' | 'done',
              actionTarget: `/student/tutor/${active.id}`,
            }));
          }
        }
      }
    } catch {
      // 容错
    }

    if (activeTasks.length === 0 && hasActiveProject) {
      activeTasks = [
        {
          id: 'task-thunder-1',
          projectId: 'proj-active',
          stageId: 'stage-theory',
          stageName: '理论探究',
          title: '理解 Pygame 主循环与事件队列原理',
          description: '与 AI 导师探讨游戏每秒刷新的主循环结构与按键事件机制。',
          isTodayFocus: true,
          status: 'todo',
          actionTarget: '/student/tutor',
        },
        {
          id: 'task-thunder-2',
          projectId: 'proj-active',
          stageId: 'stage-theory',
          stageName: '理论探究',
          title: '通过 AABB 矩形包围盒碰撞检测测验',
          description: '完成 TheoryMastered 概念门禁，方可解锁编写代码。',
          isTodayFocus: false,
          status: 'todo',
          actionTarget: '/student/tutor',
        },
      ];
    }

    const todayDate = new Date().toISOString().split('T')[0] || '2026-10-12';

    return {
      date: todayDate,
      greetingName: '小启同学',
      avatarUrl: null,
      hasActiveProject,
      tasks: activeTasks,
      suggestion: {
        id: 'sug-live-1',
        title: '苏格拉底式启发学习提示',
        body: '遇到问题时先尝试将大目标拆解为独立模块；在理论探究阶段重点理解概念本质，严禁直接抄写现成代码。',
        computedAt: new Date().toISOString(),
      },
      directions,
      quickStart: {
        enabled: true,
        mode: 'navigate',
        exploreHref: '/student/inspiration',
      },
      stats: {
        streakDays: 3,
        tasksCompletedThisWeek: 4,
        projectsInProgress: hasActiveProject ? 1 : 0,
      },
    };
  }

  async getActiveProject(): Promise<ActiveProjectSummary | null> {
    try {
      const projects = await this.fetchJson<Array<{
        id: string;
        title: string;
        subtitle?: string;
        status: string;
        progressPercent?: number;
        currentStageIndex?: number;
        stageTotal?: number;
        templateVersionId?: string;
      }>>('/api/v1/projects');

      if (!projects || projects.length === 0) return null;
      const p = projects.find((item) => item.status !== 'completed' && item.status !== 'archived') || projects[0];
      if (!p) return null;

      const overview = await this.fetchJson<{
        stages?: Array<{ index: number; stageId: string; name: string; status: 'done' | 'active' | 'pending' }>;
      }>(`/api/v1/projects/${encodeURIComponent(p.id)}/overview`);

      const stages = overview?.stages || [
        { index: 1, stageId: 'stage-1', name: '意图确认', status: 'done' as const },
        { index: 2, stageId: 'stage-2', name: '理论探究 (TheoryMastered)', status: 'active' as const },
        { index: 3, stageId: 'stage-3', name: '沙箱实践', status: 'pending' as const },
        { index: 4, stageId: 'stage-4', name: '答辩反思', status: 'pending' as const },
      ];

      return {
        id: p.id,
        title: p.title || '雷霆战机小游戏开发',
        subtitle: p.subtitle || '基于 Pygame 打造太空射击小游戏',
        coverUrl: '',
        templateVersionId: p.templateVersionId || 'template-python-mini-project@v1',
        stage: 'theory_learning',
        stageIndex: p.currentStageIndex ?? 2,
        stageTotal: p.stageTotal ?? 4,
        progressPercent: p.progressPercent ?? 35,
        stages,
      };
    } catch {
      return null;
    }
  }

  async getNotifications(): Promise<NotificationList> {
    return {
      unreadCount: 1,
      items: [
        {
          id: 'note-1',
          type: 'mentor_todo',
          title: '你的 PBL 导师团队已上线，可随时进入「AI 搭档」开启启发对话',
          createdAt: new Date().toISOString(),
          targetHref: '/student/tutor',
        },
      ],
    };
  }
}
