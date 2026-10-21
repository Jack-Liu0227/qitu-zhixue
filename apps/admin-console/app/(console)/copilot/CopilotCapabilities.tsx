'use client';

import type { AdminCopilotCapabilities } from '@qitu/contracts';

export function CopilotCapabilities({ data, loading, error, scope, refresh }: {
  data: AdminCopilotCapabilities | null;
  loading: boolean;
  error: string | null;
  scope: 'global' | 'selected_template';
  refresh: () => void;
}) {
  if (loading) return <div role="status" style={{ padding: '8px 20px', fontSize: 12, color: '#64748b' }}>正在核验管家技能与操作目录…</div>;
  if (error || !data) return <div role="alert" style={{ padding: '10px 20px', background: '#fff7ed', color: '#9a3412', fontSize: 12 }}>
    {error ?? '管家操作目录为空'}。配置操作暂不可用。
    <button type="button" onClick={refresh} style={{ marginLeft: 12 }}>重新核验</button>
  </div>;
  const operations = data.operations.filter(operation => operation.scopes.some(allowed => allowed === scope));
  return <details style={{ padding: '8px 20px', borderBottom: '1px solid #e2e8f0', fontSize: 12, color: '#475569' }}>
    <summary style={{ cursor: 'pointer' }}>
      {scope === 'global' ? '全局配置' : '当前模板及关联资源'} · {operations.length} 项操作可用 · 管家技能 v{data.skill.version} 已核验
    </summary>
    <p style={{ margin: '8px 0', lineHeight: 1.7 }}>{operations.map(operation => operation.label).join('、')}</p>
    <p style={{ margin: '4px 0', color: '#64748b' }}>
      {scope === 'global' ? '可管理平台资源及跨项目配置。' : '本轮配置限定在选中的模板及其关联资源；平台设置请切回全局配置。'}
      保存、校验与启用分别显示执行回执。
    </p>
  </details>;
}
