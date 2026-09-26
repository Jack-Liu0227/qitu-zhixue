'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { projectsDataSource } from '../data';
import { DEMO_DENIED, DEMO_ERROR, isOffline, toProjectsError } from '../lib/loadable';
import type { Loadable, ProjectsError, ScreenScenario } from '../lib/loadable';
import type {
  MentorNoteView,
  NextStep,
  ProjectListItem,
  ProjectOverview,
  ProjectTab,
  TemplateStage,
  TheoryMaterial,
  TheoryQuestion,
} from '../types';

export interface AsyncResource<T> {
  state: Loadable<T>;
  retry: () => void;
  retrying: boolean;
}

export interface ResourceOptions<T> {
  /** 演示/测试场景，用于触达五态；未传时按真实加载。 */
  scenario?: ScreenScenario;
  isEmpty?: (data: T) => boolean;
}

/**
 * 通用异步资源 hook：把数据源结果映射为五态。
 *
 * - `offline`：浏览器断网或 scenario=offline 时，持有缓存数据但只读。
 * - `denied`：403 / scenario=denied。
 * - `error`：其余异常，带 retry。
 * - `empty`：数据为空（默认数组长度为 0，可自定义）。
 */
export function useProjectsResource<T>(
  load: () => Promise<T>,
  deps: ReadonlyArray<unknown>,
  options: ResourceOptions<T> = {},
): AsyncResource<T> {
  const { scenario, isEmpty } = options;
  const loadRef = useRef(load);
  loadRef.current = load;
  const isEmptyRef = useRef(isEmpty);
  isEmptyRef.current = isEmpty;

  // 最近一次成功加载的数据，仅内存缓存，供断网只读渲染（不做 localStorage 持久化）。
  const cacheRef = useRef<T | null>(null);

  const [refresh, setRefresh] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [state, setState] = useState<Loadable<T>>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    const run = async (): Promise<void> => {
      if (scenario === 'loading') {
        setState({ status: 'loading' });
        return;
      }
      if (scenario === 'error') {
        setState({ status: 'error', error: DEMO_ERROR });
        return;
      }
      if (scenario === 'denied') {
        setState({ status: 'denied', error: DEMO_DENIED });
        return;
      }

      setState({ status: 'loading' });
      try {
        const data = await loadRef.current();
        if (cancelled) return;
        cacheRef.current = data;
        const empty = isEmptyRef.current
          ? isEmptyRef.current(data)
          : Array.isArray(data) && data.length === 0;
        if (empty) {
          setState({ status: 'empty' });
          return;
        }
        const offline = scenario === 'offline' || isOffline();
        setState(offline ? { status: 'offline', data } : { status: 'ready', data });
      } catch (error) {
        if (cancelled) return;
        const parsed: ProjectsError = toProjectsError(error);
        if (parsed.status === 403) {
          setState({ status: 'denied', error: parsed });
          return;
        }
        // 网络失败（无 HTTP 状态 / status=0）按断网处理，保留缓存只读展示。
        if ((parsed.status === 0 || isOffline()) && cacheRef.current !== null) {
          setState({ status: 'offline', data: cacheRef.current });
          return;
        }
        setState({ status: 'error', error: parsed });
      } finally {
        if (!cancelled) setRetrying(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
    // deps 由调用方保证长度稳定
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, scenario, ...deps]);

  // 监听真实网络状态：断网立即切到 offline（有缓存时），恢复后自动重取。
  useEffect(() => {
    const handleOffline = (): void => {
      if (cacheRef.current !== null) {
        setState({ status: 'offline', data: cacheRef.current });
      }
    };
    const handleOnline = (): void => {
      setRetrying(true);
      setRefresh((value) => value + 1);
    };
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  const retry = useCallback(() => {
    setRetrying(true);
    setRefresh((value) => value + 1);
  }, []);

  return { state, retry, retrying };
}

export function useProjectList(
  tab: ProjectTab,
  q: string,
  options?: ResourceOptions<ProjectListItem[]>,
): AsyncResource<ProjectListItem[]> {
  const load = useCallback(
    () => projectsDataSource.listProjects({ tab, q }),
    [tab, q],
  );
  return useProjectsResource(load, [tab, q], options);
}

export function useProjectOverview(
  projectId: string,
  options?: ResourceOptions<ProjectOverview>,
): AsyncResource<ProjectOverview> {
  const load = useCallback(async (): Promise<ProjectOverview> => {
    const [project, stages, tasks, nextStep] = await Promise.all([
      projectsDataSource.getProject(projectId),
      projectsDataSource.getStages(projectId),
      projectsDataSource.getTasks(projectId),
      projectsDataSource.getNextStep(projectId),
    ]);
    return { project, stages, tasks, nextStep };
  }, [projectId]);
  return useProjectsResource(load, [projectId], {
    ...options,
    isEmpty: options?.isEmpty ?? ((data) => data.project === null),
  });
}

export function useProjectNextStep(
  projectId: string | undefined,
  options?: ResourceOptions<NextStep | null>,
): AsyncResource<NextStep | null> {
  const load = useCallback(async (): Promise<NextStep | null> => {
    if (!projectId) return null;
    return projectsDataSource.getNextStep(projectId);
  }, [projectId]);
  return useProjectsResource(load, [projectId], {
    ...options,
    isEmpty: options?.isEmpty ?? ((data) => data === null),
  });
}

export function useTemplateStages(
  templateVersionId: string,
  options?: ResourceOptions<TemplateStage[]>,
): AsyncResource<TemplateStage[]> {
  const load = useCallback(
    () => projectsDataSource.getTemplateStages(templateVersionId),
    [templateVersionId],
  );
  return useProjectsResource(load, [templateVersionId], options);
}

export interface TheoryContent {
  material: TheoryMaterial | null;
  questions: TheoryQuestion[];
}

export function useTheoryContent(
  projectId: string,
  options?: ResourceOptions<TheoryContent>,
): AsyncResource<TheoryContent> {
  const load = useCallback(async (): Promise<TheoryContent> => {
    const [material, questions] = await Promise.all([
      projectsDataSource.getTheoryMaterial(projectId),
      projectsDataSource.getTheoryQuestions(projectId),
    ]);
    return { material, questions };
  }, [projectId]);
  return useProjectsResource(load, [projectId], options);
}

export function useMentorNote(
  projectId: string,
  options?: ResourceOptions<MentorNoteView | null>,
): AsyncResource<MentorNoteView | null> {
  const load = useCallback(
    () => projectsDataSource.getMentorNote(projectId),
    [projectId],
  );
  return useProjectsResource(load, [projectId], {
    ...options,
    isEmpty: options?.isEmpty ?? ((data) => data === null),
  });
}
