import type { ReactNode } from 'react';

/**
 * Browser-safe projections for the server-owned Team runtime.
 *
 * These types intentionally live in the UI package instead of contracts: they
 * describe how a projection is rendered, not a trusted command or persistence
 * shape. Apps can adapt future API contracts without coupling the shared UI
 * to one transport version.
 */
export type TeamNodeKind = 'leader' | 'teammate' | 'system';
export type TeamNodeStatus = 'ready' | 'running' | 'waiting' | 'blocked' | 'failed' | 'disabled' | 'offline' | 'unknown';
export type TeamEdgeKind = 'delegate' | 'event' | 'message';
export type TeamRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'blocked' | 'cancelled' | 'unknown';

export interface TeamGraphNode {
  id: string;
  label: string;
  kind: TeamNodeKind;
  status?: TeamNodeStatus;
  description?: string | null;
  modelLabel?: string | null;
  capabilities?: readonly string[];
  meta?: ReactNode;
}

export interface TeamGraphEdge {
  id: string;
  from: string;
  to: string;
  kind: TeamEdgeKind;
  label?: string | null;
}

export interface TeamRunNode {
  id: string;
  agentId: string;
  label: string;
  status: TeamRunStatus;
  summary?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  durationMs?: number | null;
}

export interface TeamActivityItem {
  id: string;
  timestamp: string;
  actorId: string;
  actorLabel: string;
  type: string;
  status?: TeamRunStatus;
  summary: string;
  detail?: string | null;
}

const STATUS_LABEL: Record<TeamNodeStatus, string> = {
  ready: '就绪',
  running: '运行中',
  waiting: '等待调用',
  blocked: '已阻塞',
  failed: '失败',
  disabled: '已停用',
  offline: '离线',
  unknown: '未知',
};

const RUN_STATUS_LABEL: Record<TeamRunStatus, string> = {
  queued: '排队中',
  running: '运行中',
  succeeded: '已完成',
  failed: '失败',
  blocked: '需人工介入',
  cancelled: '已取消',
  unknown: '未知',
};

const EDGE_LABEL: Record<TeamEdgeKind, string> = {
  delegate: '委派',
  event: '事件触发',
  message: '消息',
};

export function TeamStatusBadge({ status = 'unknown' }: { status?: TeamNodeStatus }) {
  return (
    <span className={`qitu-team-status qitu-team-status-${status}`} role="status">
      <span className="qitu-team-status-dot" aria-hidden="true" />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function TeamRunStatusBadge({ status }: { status: TeamRunStatus }) {
  return (
    <span className={`qitu-team-status qitu-team-status-${status}`} role="status">
      <span className="qitu-team-status-dot" aria-hidden="true" />
      {RUN_STATUS_LABEL[status]}
    </span>
  );
}

/**
 * Read-only topology view. Edges are rendered explicitly below the nodes so
 * the meaning remains readable on narrow screens and with keyboard navigation.
 */
export function AgentTopologyGraph({
  nodes,
  edges,
  title = 'Agent 协作拓扑',
  description,
  emptyMessage = '暂无已注册的 Agent 协作关系',
}: {
  nodes: readonly TeamGraphNode[];
  edges: readonly TeamGraphEdge[];
  title?: string;
  description?: string;
  emptyMessage?: string;
}) {
  const leaders = nodes.filter((node) => node.kind === 'leader');
  const teammates = nodes.filter((node) => node.kind !== 'leader');

  return (
    <section className="qitu-team-graph" aria-label={title}>
      <header className="qitu-team-graph-header">
        <div>
          <h3>{title}</h3>
          {description ? <p>{description}</p> : null}
        </div>
        <span className="qitu-team-graph-count">{nodes.length} 个 Agent</span>
      </header>
      {nodes.length === 0 ? (
        <p className="qitu-team-empty">{emptyMessage}</p>
      ) : (
        <>
          <div className="qitu-team-node-lanes">
            <div className="qitu-team-lane">
              <span className="qitu-team-lane-label">Leader</span>
              <div className="qitu-team-node-list">
                {(leaders.length > 0 ? leaders : nodes.slice(0, 1)).map((node) => (
                  <TeamGraphNodeCard key={node.id} node={node} />
                ))}
              </div>
            </div>
            <div className="qitu-team-lane qitu-team-lane-teammates">
              <span className="qitu-team-lane-label">Teammates</span>
              <div className="qitu-team-node-list">
                {teammates.length > 0 ? teammates.map((node) => <TeamGraphNodeCard key={node.id} node={node} />) : (
                  <p className="qitu-team-muted">尚未注册子 Agent</p>
                )}
              </div>
            </div>
          </div>
          <div className="qitu-team-edges" aria-label="Agent 路由">
            <span className="qitu-team-lane-label">Routes</span>
            {edges.length > 0 ? edges.map((edge) => (
              <div className="qitu-team-edge" key={edge.id}>
                <code>{edge.from}</code>
                <span className="qitu-team-edge-arrow" aria-hidden="true">→</span>
                <code>{edge.to}</code>
                <span className="qitu-team-edge-kind">{edge.label ?? EDGE_LABEL[edge.kind]}</span>
              </div>
            )) : <p className="qitu-team-muted">暂无可用路由投影</p>}
          </div>
        </>
      )}
    </section>
  );
}

function TeamGraphNodeCard({ node }: { node: TeamGraphNode }) {
  const status = node.status ?? 'unknown';
  return (
    <article className={`qitu-team-node qitu-team-node-${node.kind}`}>
      <div className="qitu-team-node-head">
        <strong>{node.label}</strong>
        <TeamStatusBadge status={status} />
      </div>
      <code className="qitu-team-node-id">{node.id}</code>
      {node.description ? <p>{node.description}</p> : null}
      {node.modelLabel ? <span className="qitu-team-node-model">模型：{node.modelLabel}</span> : null}
      {node.capabilities && node.capabilities.length > 0 ? (
        <div className="qitu-team-node-capabilities">
          {node.capabilities.map((capability) => <span key={capability}>{capability}</span>)}
        </div>
      ) : null}
      {node.meta ? <div className="qitu-team-node-meta">{node.meta}</div> : null}
    </article>
  );
}

export function AgentRunGraph({
  nodes,
  title = '本次执行图',
  description,
  emptyMessage = '当前没有可查看的执行记录',
  action,
}: {
  nodes: readonly TeamRunNode[];
  title?: string;
  description?: string;
  emptyMessage?: string;
  action?: ReactNode;
}) {
  return (
    <section className="qitu-team-run-graph" aria-label={title}>
      <header className="qitu-team-graph-header">
        <div>
          <h3>{title}</h3>
          {description ? <p>{description}</p> : null}
        </div>
        {action ? <div className="qitu-team-graph-action">{action}</div> : null}
      </header>
      {nodes.length === 0 ? <p className="qitu-team-empty">{emptyMessage}</p> : (
        <ol className="qitu-team-run-list">
          {nodes.map((node) => (
            <li key={node.id} className="qitu-team-run-item">
              <span className="qitu-team-run-marker" aria-hidden="true" />
              <div className="qitu-team-run-content">
                <div className="qitu-team-run-head">
                  <strong>{node.label}</strong>
                  <TeamRunStatusBadge status={node.status} />
                </div>
                <code>{node.agentId}</code>
                {node.summary ? <p>{node.summary}</p> : null}
                {node.durationMs !== undefined && node.durationMs !== null ? (
                  <span className="qitu-team-run-meta">耗时 {formatDuration(node.durationMs)}</span>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function AgentActivityFeed({
  items,
  title = 'Activity',
  emptyMessage = '暂无协作活动',
}: {
  items: readonly TeamActivityItem[];
  title?: string;
  emptyMessage?: string;
}) {
  return (
    <section className="qitu-team-activity" aria-label={title}>
      <header className="qitu-team-graph-header"><h3>{title}</h3></header>
      {items.length === 0 ? <p className="qitu-team-empty">{emptyMessage}</p> : (
        <ol className="qitu-team-activity-list">
          {items.map((item) => (
            <li key={item.id} className="qitu-team-activity-item">
              <time dateTime={item.timestamp}>{formatActivityTime(item.timestamp)}</time>
              <div>
                <strong>{item.actorLabel}</strong>
                <span className="qitu-team-activity-type">{item.type}</span>
                <p>{item.summary}</p>
                {item.detail ? <small>{item.detail}</small> : null}
              </div>
              {item.status ? <TeamRunStatusBadge status={item.status} /> : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs} ms`;
  return `${(durationMs / 1000).toFixed(1)} s`;
}

function formatActivityTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}
