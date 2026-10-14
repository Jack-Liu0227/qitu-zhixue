import type { DataMode } from '@qitu/contracts';
import { Badge } from '@qitu/ui';

interface DataModeBadgeProps {
  /**
   * 数据来源模式，复用服务端就绪探针 `ReadinessResponse.dataMode` 的既有词汇：
   * `live` | `demo` | `test`（见 `packages/contracts/src/index.ts`）。
   */
  dataMode: DataMode;
  /** 可选补充说明，例如「页面数据来自前端内置样例」。 */
  detail?: string;
}

/**
 * 页面级数据来源标注。
 *
 * 与 `DataSourceBadge`（读服务端响应里的 `dataSource`）的区别：那个组件用于
 * **接口驱动**的页面；本组件用于**前端硬编码样例**页面——这些页面没有任何
 * `lib/api` 数据请求，数据全部内联在 tsx 里，必须显式标注为演示数据，
 * 否则会被当成真实平台配置读取（AGENTS.md：mock/演示数据必须可见地标注）。
 *
 * 只做标注：不改变导航与信息架构，不改变任何交互。
 */
export function DataModeBadge({ dataMode, detail }: DataModeBadgeProps) {
  if (dataMode === 'live') return null;
  const label = dataMode === 'demo' ? '演示数据' : '测试数据';
  return (
    <span
      title={detail ?? (dataMode === 'demo' ? '本页数据为前端内置演示样例，非真实平台配置。' : '本页数据来自测试环境。')}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
    >
      <Badge tone="attention" size="sm">{label}</Badge>
      {detail ? <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{detail}</span> : null}
    </span>
  );
}
