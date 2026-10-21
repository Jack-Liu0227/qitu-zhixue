import { ApiError } from '@qitu/api-client';
import type { ProjectStage } from '@qitu/contracts';
import { schoolDate } from '@qitu/contracts';
import type { ActiveProjectSummary, IdeaDirection, NotificationList, TodayTask, TodayView } from '../types';
import type { TodayDataSource } from './todayDataSource';

/** 服务端 `GET /projects/:id/overview` 投影中本页用到的字段。 */
interface ProjectOverviewProjection {
  stages?: Array<{ id: string; index: number; name: string; status: 'done' | 'active' | 'pending' }>;
  tasks?: Array<{
    id: string;
    stageId: string;
    title: string;
    description: string;
    status: 'todo' | 'doing' | 'done' | 'locked';
    isTodayFocus: boolean;
  }>;
}

/**
 * 真实 API 数据源。所有字段只来自服务端投影：
 *  - 拉不到模板 → `directions` 为空（页面渲染既有空态），不编造推荐卡；
 *  - 拉不到任务 → `tasks` 为空（页面渲染「今天暂时没有任务」空态）；
 *  - 建议 / 统计没有服务端来源（Q1/Q3 gap）→ 返回 null，页面不渲染对应卡片；
 *  - 请求失败按数据源错误约定抛 `ApiError`，由 useTodayData 映射为
 *    offline / permission-denied / error 状态，绝不静默回退演示数据。
 */
export class ApiTodayDataSource implements TodayDataSource {
  private async fetchJson<T>(url: string): Promise<T | null> {
    let response: Response;
    try {
      response = await fetch(url, {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      });
    } catch {
      // status 0 → useTodayData 映射为 offline。
      throw new ApiError('网络不可用', 0, 'NETWORK_OFFLINE');
    }
    if (!response.ok) {
      throw new ApiError(`请求 ${url} 失败`, response.status);
    }
    const json = (await response.json().catch(() => null)) as { data?: T } | T | null;
    if (json === null) return null;
    return ((json as { data?: T }).data ?? json) as T;
  }

  private async findActiveProject(): Promise<{
    id: string;
    title: string;
    subtitle?: string;
    status: string;
    progressPercent?: number;
    currentStageIndex?: number;
    stageTotal?: number;
    templateVersionId?: string;
  } | null> {
    const projects = await this.fetchJson<Array<{ id: string; status: string; title: string; isCurrent: boolean }>>('/api/v1/projects');
    if (!projects || projects.length === 0) return null;
    return (
      projects.find((p) => p.isCurrent) ??
      null
    );
  }

  async getToday(): Promise<TodayView> {
    // 1. 探索推荐方向：只用模板库真实数据，副标题只用服务端 summary。
    const templates =
      (await this.fetchJson<Array<{ id: string; title: string; summary?: string | null; iconAssetId?: string | null }>>(
        '/api/v1/project-templates',
      )) ?? [];
    const directions: IdeaDirection[] = templates
      .filter((t) =>
        typeof t?.id === 'string' && typeof t?.title === 'string')
      .map((t) => ({
        templateId: t.id,
        iconAssetId: typeof t.iconAssetId === 'string' ? t.iconAssetId : null,
        title: t.title,
        subtitle: t.summary ?? '',
        coverUrl: '',
        href: `/student/inspiration?template=${encodeURIComponent(t.id)}`,
      }));

    // 2. 当前项目与今日任务：全部来自服务端 overview 投影。
    let activeTasks: TodayTask[] = [];
    let hasActiveProject = false;
    const active = await this.findActiveProject();
    if (active) {
      hasActiveProject = true;
      const overview = await this.fetchJson<ProjectOverviewProjection>(
        `/api/v1/projects/${encodeURIComponent(active.id)}/overview`,
      );
      const stageNames = new Map((overview?.stages ?? []).map((s) => [s.id, s.name]));
      activeTasks = (overview?.tasks ?? []).slice(0, 3).map((t) => ({
        id: t.id,
        projectId: active.id,
        stageId: t.stageId,
        stageName: stageNames.get(t.stageId) ?? t.stageId,
        title: t.title,
        description: t.description,
        isTodayFocus: t.isTodayFocus,
        status: t.status === 'done' ? ('done' as const) : ('todo' as const),
        // 导航路由，非业务数据：任务操作统一进入该项目的 AI 搭档。
        actionTarget: `/student/tutor/${active.id}`,
      }));
    }

    return {
      date: schoolDate(),
      // Q1 gap：C1 没有服务端问候名来源；页面当前不渲染该字段，留空而非编造。
      greetingName: '',
      avatarUrl: null,
      hasActiveProject,
      tasks: activeTasks,
      // Q3 gap：无服务端 AI 建议端点；null 时页面不渲染建议卡。
      suggestion: null,
      directions,
      quickStart: {
        enabled: true,
        mode: 'navigate',
        exploreHref: '/student/inspiration',
      },
      // Q1 gap：无服务端成长统计端点；null 而不是编造连续天数/完成数。
      stats: null,
    };
  }

  async getActiveProject(): Promise<ActiveProjectSummary | null> {
    const p = await this.findActiveProject();
    if (!p) return null;

    const overview = await this.fetchJson<ProjectOverviewProjection>(
      `/api/v1/projects/${encodeURIComponent(p.id)}/overview`,
    );

    return {
      id: p.id,
      title: p.title,
      subtitle: p.subtitle ?? '',
      coverUrl: '',
      templateVersionId: p.templateVersionId ?? 'unknown',
      // 服务端状态机值，客户端只透传，绝不推导或改写。
      stage: p.status as ProjectStage,
      stageIndex: p.currentStageIndex ?? 0,
      stageTotal: p.stageTotal ?? 0,
      progressPercent: p.progressPercent ?? 0,
      stages: (overview?.stages ?? []).map((s) => ({
        index: s.index,
        stageId: s.id,
        name: s.name,
        status: s.status,
      })),
    };
  }

  async getNotifications(): Promise<NotificationList> {
    // C3 (`GET /students/me/notifications`) 尚未实现：返回诚实空列表，
    // 不编造「导师团队已上线」之类的假通知。
    return { unreadCount: 0, items: [] };
  }
}
