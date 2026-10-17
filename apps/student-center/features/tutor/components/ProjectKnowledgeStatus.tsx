'use client';
import { useEffect, useState } from 'react';
export function ProjectKnowledgeStatus({ projectId }: { projectId: string }) {
  const [state, setState] = useState<{
    name: string;
    state: string;
    activeIndexVersionId: string | null;
  } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const response = await fetch(
          `/api/v1/student/projects/${encodeURIComponent(projectId)}/knowledge`,
          { credentials: 'include' },
        );
        if (!response.ok) throw new Error();
        const body = await response.json();
        if (closed) return;
        setState(body.data);
        setError('');
        if (!['ready', 'failed', 'empty', 'cancelled'].includes(body.data.state))
          timer = setTimeout(() => void load(), 8000);
      } catch {
        if (!closed) {
          setError('项目资料状态暂时无法读取');
          timer = setTimeout(() => void load(), 15000);
        }
      }
    };
    void load();
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
    };
  }, [projectId]);
  const labels: Record<string, string> = {
    queued: '正在准备项目资料',
    discovering: '正在发现相关资料',
    planning: '正在选取相关资料',
    collecting: '已选取相关资料，正在整理原文',
    indexing: '正在建立项目知识库',
    validating: '正在核对项目资料',
    ready: '项目资料已准备好',
    failed: '项目资料准备暂未完成，请稍后重试',
    empty: '暂无获授权的项目资料',
    cancelled: '项目资料准备已暂停',
  };
  return (
    <div
      role="status"
      style={{
        padding: '8px 16px',
        fontSize: 12,
        color: '#52637c',
        background: '#f2f7ff',
        borderBottom: '1px solid #e1eafa',
      }}
    >
      {error ||
        (state
          ? `${state.name} · ${labels[state.state] ?? '正在准备项目资料'}`
          : '正在读取项目资料状态…')}
    </div>
  );
}
