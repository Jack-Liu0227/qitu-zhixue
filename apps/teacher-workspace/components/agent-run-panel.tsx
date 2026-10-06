'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AgentActivityFeed,
  AgentRunGraph,
  Button,
  ErrorState,
  OfflineBanner,
  PermissionDenied,
  SkeletonBlock,
} from '@qitu/ui';
import {
  teacherApi,
  TeacherOfflineError,
  TeacherPermissionError,
  type TeacherAgentRunProjection,
} from '../lib/teacherApi';

type PanelState =
  | { status: 'loading' }
  | { status: 'ready'; data: TeacherAgentRunProjection }
  | { status: 'empty' }
  | { status: 'offline' }
  | { status: 'permission' }
  | { status: 'error'; message: string };

/** Teacher-safe view of one student's latest Team run. */
export function AgentRunPanel({ studentId }: { studentId: string }) {
  const [state, setState] = useState<PanelState>({ status: 'loading' });
  const requestSequence = useRef(0);
  const load = useCallback(async () => {
    const requestId = ++requestSequence.current;
    setState({ status: 'loading' });
    try {
      const response = await teacherApi.agentRuns(studentId);
      if (requestId !== requestSequence.current) return;
      setState(response.data.runId === null && response.data.nodes.length === 0 ? { status: 'empty' } : { status: 'ready', data: response.data });
    } catch (error) {
      if (requestId !== requestSequence.current) return;
      if (error instanceof TeacherPermissionError) {
        setState({ status: 'permission' });
        return;
      } else if (error instanceof TeacherOfflineError) {
        setState({ status: 'offline' });
        return;
      } else if ((error as { status?: number } | null)?.status === 404) {
        setState({ status: 'error', message: 'Agent 执行记录接口尚未启用。Team Runtime 接入后会显示真实任务和活动。' });
      } else {
        setState({ status: 'error', message: error instanceof Error ? error.message : 'Agent 执行记录加载失败。' });
      }
    }
  }, [studentId]);

  useEffect(() => {
    void load();
    return () => {
      requestSequence.current += 1;
    };
  }, [load]);

  return (
    <section className="qtx-card qtx-agent-run-panel">
      <div className="qtx-panel-header">
        <div className="qtx-panel-title"><span className="dot" /> Agent 协作记录</div>
        <Button variant="ghost" size="sm" onClick={() => void load()} loading={state.status === 'loading'}>刷新</Button>
      </div>
      {state.status === 'loading' ? <p className="qtx-muted">正在加载最新执行记录...</p> : null}
      {state.status === 'loading' ? <SkeletonBlock lines={4} /> : null}
      {state.status === 'permission' ? <PermissionDenied description="你没有查看该学生 Agent 执行记录的权限。" /> : null}
      {state.status === 'offline' ? <OfflineBanner readOnly onRetry={() => void load()} /> : null}
      {state.status === 'error' ? <ErrorState title="执行记录加载失败" description={state.message} onRetry={() => void load()} /> : null}
      {state.status === 'empty' ? <p className="qtx-muted">暂无可查看的 Agent 执行记录。</p> : null}
      {state.status === 'ready' ? (
        <div className="qtx-agent-run-content">
          <AgentRunGraph
            nodes={state.data.nodes}
            description={`${state.data.runId ? `Run ${state.data.runId}` : '暂无 Run ID'} · ${state.data.generatedAt ?? '时间未知'}`}
          />
          <AgentActivityFeed items={state.data.activity} emptyMessage="该次运行没有可展示的 Activity。" />
        </div>
      ) : null}
    </section>
  );
}
