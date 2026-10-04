import {
  Badge,
  ErrorState,
  InfoRow,
} from '@qitu/ui';
import type {
  AdminInitializationArea,
  AdminInitializationCheckStatus,
  AdminMcpConnectionStatus,
  AdminMcpTransport,
  AdminRuntimeDataMode,
  AdminRuntimeDatabaseStatus,
  AdminRuntimeHealth,
  AdminRuntimeItemStatus,
  AdminRuntimeSource,
  AdminRuntimeToolRiskLevel,
} from '@qitu/contracts';

/**
 * AI 运行时治理的纯展示组件。
 *
 * 只消费已脱敏的只读投影：任何状态都从契约字段映射到文案 / 徽标，
 * 不在此处做权限判断，也不渲染密钥、提示词或原始对话。
 */

type BadgeTone = 'neutral' | 'primary' | 'completed' | 'attention' | 'danger';

const HEALTH_LABEL: Record<AdminRuntimeHealth, { tone: BadgeTone; label: string }> = {
  ready: { tone: 'completed', label: '就绪' },
  degraded: { tone: 'attention', label: '部分可用' },
  not_ready: { tone: 'danger', label: '未就绪' },
  unknown: { tone: 'neutral', label: '未知' },
};

const ITEM_STATUS_LABEL: Record<AdminRuntimeItemStatus, { tone: BadgeTone; label: string }> = {
  enabled: { tone: 'completed', label: '已启用' },
  disabled: { tone: 'neutral', label: '已停用' },
  ready: { tone: 'completed', label: '就绪' },
  unavailable: { tone: 'attention', label: '不可用' },
  error: { tone: 'danger', label: '异常' },
  unknown: { tone: 'neutral', label: '未知' },
};

const MCP_STATUS_LABEL: Record<AdminMcpConnectionStatus, { tone: BadgeTone; label: string }> = {
  connected: { tone: 'completed', label: '已连接' },
  disconnected: { tone: 'neutral', label: '未连接' },
  error: { tone: 'danger', label: '连接失败' },
  not_configured: { tone: 'neutral', label: '未配置' },
  unknown: { tone: 'neutral', label: '未知' },
};

const INIT_STATUS_LABEL: Record<AdminInitializationCheckStatus, { tone: BadgeTone; label: string }> = {
  ready: { tone: 'completed', label: '就绪' },
  missing: { tone: 'attention', label: '缺失' },
  failed: { tone: 'danger', label: '失败' },
  not_applicable: { tone: 'neutral', label: '不适用' },
  unknown: { tone: 'neutral', label: '未知' },
};

const RISK_LABEL: Record<AdminRuntimeToolRiskLevel, { tone: BadgeTone; label: string }> = {
  low: { tone: 'completed', label: '低风险' },
  medium: { tone: 'attention', label: '中风险' },
  high: { tone: 'danger', label: '高风险' },
  unknown: { tone: 'neutral', label: '风险未知' },
};

const SOURCE_LABEL: Record<AdminRuntimeSource, string> = {
  builtin: '内置',
  configured: '已配置',
  runtime: 'Tutor 运行时',
  development: '开发期（不用于 Tutor）',
  unknown: '来源未知',
};

const TRANSPORT_LABEL: Record<AdminMcpTransport, string> = {
  stdio: 'stdio',
  sse: 'SSE',
  streamable_http: 'Streamable HTTP',
  unknown: '未知传输',
};

const AREA_LABEL: Record<AdminInitializationArea, string> = {
  database: '数据库',
  knowledge: '知识库',
  template: '模板',
  tutor: 'Tutor',
  registry: '运行时注册表',
  other: '其他',
};

const DATA_MODE_LABEL: Record<AdminRuntimeDataMode, string> = {
  live: '生产（live）',
  demo: '演示（demo）',
  test: '测试（test）',
  unknown: '未知',
};

const DATABASE_LABEL: Record<AdminRuntimeDatabaseStatus, string> = {
  connected: '已连接',
  in_memory: '内存实现',
  unavailable: '不可用',
  unknown: '未知',
};

export function RuntimeHealthBadge({ health, size = 'md' }: { health: AdminRuntimeHealth; size?: 'sm' | 'md' }) {
  const view = HEALTH_LABEL[health] ?? HEALTH_LABEL.unknown!;
  return (
    <Badge tone={view.tone} size={size}>
      {view.label}
    </Badge>
  );
}

export function RuntimeItemStatusBadge({ status, size = 'sm' }: { status: AdminRuntimeItemStatus; size?: 'sm' | 'md' }) {
  const view = ITEM_STATUS_LABEL[status] ?? ITEM_STATUS_LABEL.unknown!;
  return (
    <Badge tone={view.tone} size={size}>
      {view.label}
    </Badge>
  );
}

export function McpConnectionBadge({ status, size = 'sm' }: { status: AdminMcpConnectionStatus; size?: 'sm' | 'md' }) {
  const view = MCP_STATUS_LABEL[status] ?? MCP_STATUS_LABEL.unknown!;
  return (
    <Badge tone={view.tone} size={size}>
      {view.label}
    </Badge>
  );
}

export function InitializationCheckBadge({
  status,
  size = 'sm',
}: {
  status: AdminInitializationCheckStatus;
  size?: 'sm' | 'md';
}) {
  const view = INIT_STATUS_LABEL[status] ?? INIT_STATUS_LABEL.unknown!;
  return (
    <Badge tone={view.tone} size={size}>
      {view.label}
    </Badge>
  );
}

export function ToolRiskBadge({ level, size = 'sm' }: { level: AdminRuntimeToolRiskLevel; size?: 'sm' | 'md' }) {
  const view = RISK_LABEL[level] ?? RISK_LABEL.unknown!;
  return (
    <Badge tone={view.tone} size={size}>
      {view.label}
    </Badge>
  );
}

export function sourceLabel(source: AdminRuntimeSource): string {
  return SOURCE_LABEL[source] ?? SOURCE_LABEL.unknown!;
}

export function transportLabel(transport: AdminMcpTransport): string {
  return TRANSPORT_LABEL[transport] ?? TRANSPORT_LABEL.unknown!;
}

export function areaLabel(area: AdminInitializationArea): string {
  return AREA_LABEL[area] ?? AREA_LABEL.other!;
}

export function dataModeLabel(mode: AdminRuntimeDataMode): string {
  return DATA_MODE_LABEL[mode] ?? DATA_MODE_LABEL.unknown!;
}

export function databaseLabel(status: AdminRuntimeDatabaseStatus): string {
  return DATABASE_LABEL[status] ?? DATABASE_LABEL.unknown!;
}

export function formatRuntimeTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', { hour12: false });
}

/** 以「标签 + 值」的紧凑列表渲染 id 集合；空集合显示破折号而不是留白。 */
export function RuntimeIdList({ label, ids }: { label: string; ids: string[] }) {
  return (
    <InfoRow
      label={label}
      value={
        ids.length === 0 ? (
          <span className="admin-runtime-muted">—</span>
        ) : (
          <span className="admin-runtime-idlist">
            {ids.map((id) => (
              <code key={id} className="admin-console-fingerprint">
                {id}
              </code>
            ))}
          </span>
        )
      }
    />
  );
}

/**
 * 治理接口尚未部署（404）时的显式状态。
 *
 * 与「权限不足」和「离线」区分：这是「能力尚未上线」，不是网络或授权故障，
 * 也不应被当成空列表。给出可执行说明与重试入口。
 */
export function RuntimeUnavailableState({ onRetry }: { onRetry: () => void }) {
  return (
    <ErrorState
      title="AI 运行时治理接口尚未启用"
      description="当前环境的后端还没有提供只读运行时注册表端点（GET /api/v1/admin/ai-runtime）。这属于能力缺口而不是权限或网络故障：请确认后端已部署该接口后重试。"
      errorCode="ADMIN_AI_RUNTIME_UNAVAILABLE"
      onRetry={onRetry}
    />
  );
}
