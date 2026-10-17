'use client';

import { useState } from 'react';
import { ErrorState, OfflineBanner, PermissionDenied, SkeletonBlock } from '@qitu/ui';
import type { TutorTeamAgent, TutorTeamGraph } from '@qitu/contracts';
import type { TutorLoadStatus, TutorViewError } from '../types';
import { ToolCallTimeline } from './ToolCallTimeline';

const STATUS_LABELS: Record<TutorTeamAgent['status'], string> = {
  ready: '就绪',
  running: '执行中',
  waiting: '等待中',
  failed: '失败',
  offline: '离线',
};

const STATUS_COLORS: Record<TutorTeamAgent['status'], string> = {
  ready: '#16a34a',
  running: '#2563eb',
  waiting: '#b45309',
  failed: '#dc2626',
  offline: '#64748b',
};

export interface TeamAgentHudProps {
  graph: TutorTeamGraph | null;
  status: TutorLoadStatus;
  error: TutorViewError | null;
  offline: boolean;
  permissionDenied: boolean;
  onRetry: () => void;
}

/** Right-sidebar team tab. It renders only the server-filtered team graph. */
export function TeamAgentHud({
  graph,
  status,
  error,
  offline,
  permissionDenied,
  onRetry,
}: TeamAgentHudProps) {
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null);

  if (permissionDenied || error?.status === 403) {
    return <PermissionDenied title="无法查看团队智能体" description="当前项目的团队协作信息没有访问权限。" />;
  }
  if (offline || error?.code === 'NETWORK_OFFLINE') {
    return <OfflineBanner readOnly onRetry={onRetry} />;
  }
  if (status === 'loading') {
    return (
      <div className="qitu-tutor-state-panel" aria-busy="true">
        <SkeletonBlock lines={4} height={18} />
      </div>
    );
  }
  if (status === 'error') {
    return (
      <ErrorState
        title="团队智能体加载失败"
        description={error?.message ?? '暂时无法读取团队协作信息。'}
        errorCode={error?.code}
        onRetry={onRetry}
      />
    );
  }
  if (status === 'empty' || graph === null || graph.agents.length === 0) {
    return (
      <div className="qitu-tutor-state-panel" role="status">
        <strong>暂无团队智能体投影</strong>
        <p>服务端还没有返回可展示的协作成员。</p>
      </div>
    );
  }

  return (
    <section className="qitu-tutor-team-hud" aria-label="团队智能体">
      <div className="qitu-tutor-team-summary">
        <div className="qitu-tutor-team-summary-mark" aria-hidden="true">
          {graph.team.assistantAvatar ?? '👥'}
        </div>
        <div className="qitu-tutor-team-summary-copy">
          <strong>{graph.team.teamName ?? graph.team.assistantName}</strong>
          <span>{graph.agents.length} 位智能体 · {graph.team.assistantName} 接管当前对话</span>
        </div>
      </div>

      <div className="qitu-tutor-agent-list">
        {graph.agents.map((agent) => {
          const expanded = expandedAgentId === agent.slotId;
          return (
            <article className="qitu-tutor-agent-card" key={agent.slotId}>
              <button
                type="button"
                className="qitu-tutor-agent-toggle"
                aria-expanded={expanded}
                onClick={() => setExpandedAgentId(expanded ? null : agent.slotId)}
              >
                <span className="qitu-tutor-agent-avatar" style={{ borderColor: agent.color ?? '#cbd5e1' }}>
                  {agent.avatar ?? agent.name.slice(0, 1)}
                </span>
                <span className="qitu-tutor-agent-copy">
                  <strong>{agent.name}</strong>
                  <span>{agent.roleLabel ?? agent.role}</span>
                </span>
                <span className="qitu-tutor-agent-status" style={{ color: STATUS_COLORS[agent.status] }}>
                  <i aria-hidden="true" style={{ background: STATUS_COLORS[agent.status] }} />
                  {STATUS_LABELS[agent.status]}
                </span>
                <span className="qitu-tutor-agent-chevron" aria-hidden="true">{expanded ? '⌃' : '⌄'}</span>
              </button>
              {agent.currentTaskSummary ? (
                <p className="qitu-tutor-agent-task">{agent.currentTaskSummary}</p>
              ) : null}
              {expanded ? <AgentDetails agent={agent} /> : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function AgentDetails({ agent }: { agent: TutorTeamAgent }) {
  const toolCalls = agent.toolCalls.map((call) => ({
    callId: call.callId,
    name: call.name,
    label: call.label,
    status: call.status,
    result: call.summary ?? undefined,
  }));

  return (
    <div className="qitu-tutor-agent-details">
      <section>
        <h4>对话摘要</h4>
        {agent.messages.length === 0 ? (
          <p className="qitu-tutor-muted">当前阶段暂无可展示的对话事件。</p>
        ) : (
          <ol className="qitu-tutor-agent-messages">
            {agent.messages.map((message) => (
              <li key={message.messageId}>
                <span>{message.direction === 'outbound' ? '发出' : '收到'}</span>
                <p>{message.summary}</p>
                <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
              </li>
            ))}
          </ol>
        )}
      </section>
      <section>
        <h4>工具调用</h4>
        {toolCalls.length === 0 ? (
          <p className="qitu-tutor-muted">当前阶段暂无工具调用。</p>
        ) : (
          <ToolCallTimeline calls={toolCalls} />
        )}
      </section>
    </div>
  );
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间未知';
  return date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
