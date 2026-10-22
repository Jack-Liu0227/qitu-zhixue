'use client';

import type { AdminCopilotCapabilities } from '@qitu/contracts';

export function CopilotCapabilities({ data, loading, error, scope, refresh }: {
  data: AdminCopilotCapabilities | null;
  loading: boolean;
  error: string | null;
  scope: 'global' | 'selected_template';
  refresh: () => void;
}) {
  if (loading) {
    return (
      <div role="status" style={{ padding: '6px 24px', fontSize: '12px', color: '#64748b', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: '#3b82f6' }} />
        正在核验管家技能与操作目录…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div role="alert" style={{ padding: '8px 24px', background: '#fff7ed', borderBottom: '1px solid #fed7aa', color: '#9a3412', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>⚠️ {error ?? '管家操作目录为空'}。配置操作暂不可用。</span>
        <button type="button" onClick={refresh} style={{ padding: '2px 8px', background: '#ffffff', border: '1px solid #fdba74', borderRadius: '4px', fontSize: '11px', color: '#9a3412', cursor: 'pointer', fontWeight: 600 }}>重新核验</button>
      </div>
    );
  }
  const operations = data.operations.filter(operation => operation.scopes.some(allowed => allowed === scope));
  return (
    <details style={{ padding: '6px 24px', borderBottom: '1px solid #e2e8f0', background: '#fafbfc', fontSize: '12px', color: '#475569' }}>
      <summary style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, color: '#334155', userSelect: 'none' }}>
        <span style={{ fontSize: '13px' }}>⚡</span>
        <span>{scope === 'global' ? '全局管理能力' : '模板专有能力'}</span>
        <span style={{ fontSize: '11px', background: '#e0f2fe', color: '#0369a1', padding: '1px 6px', borderRadius: '4px', fontWeight: 600 }}>
          {operations.length} 项已核验操作
        </span>
        <span style={{ fontSize: '11px', color: '#94a3b8', marginLeft: 'auto' }}>
          管家技能 v{data.skill.version} · 点击展开详情
        </span>
      </summary>
      <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #f1f5f9' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
          {operations.map(operation => (
            <span key={operation.label} style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '2px 8px', fontSize: '11.5px', color: '#334155', fontWeight: 500, boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
              {operation.label}
            </span>
          ))}
        </div>
        <p style={{ margin: 0, fontSize: '11.5px', color: '#64748b', lineHeight: 1.6 }}>
          {scope === 'global' ? '可在全局范围管理平台助手、团队、技能与知识库。' : '本轮配置限定在选中的模板及其关联资源；平台级变更请切回全局配置。'}
          所有执行均在服务端校验并返回执行回执。
        </p>
      </div>
    </details>
  );
}
