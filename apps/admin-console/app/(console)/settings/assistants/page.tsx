'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AdminAssistantConfig } from '@qitu/contracts';
import { Badge, Button, EmptyState, InfoRow, SectionCard } from '@qitu/ui';
import { fetchAdminAssistants, updateAdminAssistant } from '../../../../lib/api/assistants';
import { AdminStateViews } from '../../../../lib/components/AdminStateViews';
import { SettingsSubNav } from '../../../../lib/components/SettingsSubNav';
import '../ai-runtime/ai-runtime.css';

function statusBadge(status: AdminAssistantConfig['agentStatus']) {
  switch (status) {
    case 'online':
      return <Badge tone="completed">在线</Badge>;
    case 'offline':
      return <Badge tone="neutral">离线</Badge>;
    case 'missing':
      return <Badge tone="danger">配置缺失</Badge>;
    default:
      return <Badge tone="neutral">未检查</Badge>;
  }
}

export default function AdminAssistantsPage() {
  const [assistants, setAssistants] = useState<AdminAssistantConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<AdminAssistantConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAdminAssistants();
      setAssistants(data);
      if (data.length > 0 && !selectedId) {
        setSelectedId(data[0]?.id ?? null);
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error('加载助手列表失败'));
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return assistants;
    return assistants.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.role.toLowerCase().includes(q) ||
        a.id.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q),
    );
  }, [assistants, search]);

  const activeAssistant = useMemo(
    () => assistants.find((a) => a.id === selectedId) ?? assistants[0] ?? null,
    [assistants, selectedId],
  );

  const handleEditOpen = (assistant: AdminAssistantConfig) => {
    setEditing({ ...assistant });
    setSaveMessage(null);
  };

  const handleSave = async () => {
    if (!editing) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      const updated = await updateAdminAssistant(
        editing.id,
        {
          name: editing.name,
          role: editing.role,
          description: editing.description,
          instructions: editing.instructions,
          temperature: editing.temperature,
          enabled: editing.enabled,
        },
        `assistant-${editing.id}-${Date.now()}`,
      );
      setAssistants((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      setSaveMessage('助手配置已更新并生效');
      setEditing(null);
    } catch (err) {
      setSaveMessage(err instanceof Error ? err.message : '更新失败');
    } finally {
      setSaving(false);
    }
  };

  const stateView = AdminStateViews({ loading, error, onRetry: load });
  if (stateView) {
    return (
      <div className="admin-page-container">
        <SettingsSubNav />
        {stateView}
      </div>
    );
  }

  return (
    <div className="admin-page-container">
      <SettingsSubNav />

      <div className="admin-page-header">
        <div className="admin-page-header-title">
          <h1>AI 助手设置</h1>
          <Badge tone="completed">已注册 {assistants.length} 位</Badge>
        </div>
        <p>查看与管理已迁移至 SDK 运行时的独立 AI 助手角色、技能及模型默认参数</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '24px', marginTop: '20px' }}>
        {/* Left: Assistant Table */}
        <div>
          <SectionCard
            title="助手目录"
            action={
              <input
                type="search"
                placeholder="搜索助手名称 / 角色..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: '1px solid var(--qitu-border)',
                  fontSize: '0.85rem',
                }}
              />
            }
          >
            {filtered.length === 0 ? (
              <EmptyState title="未找到匹配的助手" description="请尝试更改搜索关键字。" />
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.88rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--qitu-border)', color: 'var(--qitu-muted)' }}>
                      <th style={{ padding: '10px 8px' }}>助手名称</th>
                      <th style={{ padding: '10px 8px' }}>角色定位</th>
                      <th style={{ padding: '10px 8px' }}>关联模型</th>
                      <th style={{ padding: '10px 8px' }}>状态</th>
                      <th style={{ padding: '10px 8px', textAlign: 'right' }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((item) => {
                      const isSelected = item.id === activeAssistant?.id;
                      return (
                        <tr
                          key={item.id}
                          onClick={() => setSelectedId(item.id)}
                          style={{
                            borderBottom: '1px solid var(--qitu-border-subtle, #eee)',
                            backgroundColor: isSelected ? 'var(--qitu-bg-hover, #f0f7ff)' : 'transparent',
                            cursor: 'pointer',
                            transition: 'background-color 0.15s ease',
                          }}
                        >
                          <td style={{ padding: '12px 8px', fontWeight: 600 }}>
                            <span style={{ marginRight: '8px', fontSize: '1.1rem' }}>{item.avatar || '🤖'}</span>
                            {item.name}
                            {item.source === 'builtin' && (
                              <span style={{ marginLeft: '6px', fontSize: '0.72rem', color: 'var(--qitu-primary)' }}>
                                [系统内置]
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '12px 8px', color: 'var(--qitu-text-secondary, #555)' }}>
                            {item.role}
                          </td>
                          <td style={{ padding: '12px 8px' }}>
                            <code style={{ fontSize: '0.8rem', background: '#f4f4f4', padding: '2px 6px', borderRadius: '4px' }}>
                              {item.modelId || '默认模型'}
                            </code>
                          </td>
                          <td style={{ padding: '12px 8px' }}>{statusBadge(item.agentStatus)}</td>
                          <td style={{ padding: '12px 8px', textAlign: 'right' }}>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e: React.MouseEvent) => {
                                e.stopPropagation();
                                handleEditOpen(item);
                              }}
                            >
                              配置
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </div>

        {/* Right: Selected Assistant Detail Inspector */}
        <div>
          {activeAssistant ? (
            <SectionCard
              title={`${activeAssistant.avatar || '🤖'} ${activeAssistant.name} · 详情与运行时参数`}
              action={
                <Button size="sm" onClick={() => handleEditOpen(activeAssistant)}>
                  编辑参数
                </Button>
              }
            >
              <div style={{ display: 'grid', gap: '14px' }}>
                <InfoRow label="助手标识 (ID)" value={<code>{activeAssistant.id}</code>} />
                <InfoRow label="角色职责" value={activeAssistant.role} />
                <InfoRow label="功能描述" value={activeAssistant.description} />
                <InfoRow
                  label="模型服务"
                  value={
                    <span>
                      {activeAssistant.modelProviderId || 'bailian'} / <code>{activeAssistant.modelId || 'qwen3.8-flash'}</code>
                    </span>
                  }
                />
                <InfoRow label="温度 (Temperature)" value={String(activeAssistant.temperature ?? 0.7)} />
                <InfoRow
                  label="已挂载技能 (Skills)"
                  value={
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {activeAssistant.enabledSkills.map((s) => (
                        <Badge key={s} tone="neutral">{s}</Badge>
                      ))}
                    </div>
                  }
                />
                <InfoRow
                  label="内置工具 (Tools)"
                  value={
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {activeAssistant.toolIds.length > 0 ? (
                        activeAssistant.toolIds.map((t) => (
                          <Badge key={t} tone="primary">{t}</Badge>
                        ))
                      ) : (
                        <span style={{ color: 'var(--qitu-muted)' }}>无限制调用</span>
                      )}
                    </div>
                  }
                />

                <div style={{ marginTop: '8px' }}>
                  <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--qitu-heading)' }}>
                    系统提示词 / 指令规范 (System Instructions)
                  </label>
                  <pre
                    style={{
                      marginTop: '6px',
                      padding: '12px',
                      borderRadius: '6px',
                      backgroundColor: 'var(--qitu-bg-subtle, #f8f9fa)',
                      border: '1px solid var(--qitu-border)',
                      fontSize: '0.82rem',
                      lineHeight: '1.5',
                      whiteSpace: 'pre-wrap',
                      maxHeight: '260px',
                      overflowY: 'auto',
                    }}
                  >
                    {activeAssistant.instructions}
                  </pre>
                </div>
              </div>
            </SectionCard>
          ) : (
            <EmptyState title="请选择助手" description="在左侧表格中点击任一助手查看详细运行时参数。" />
          )}
        </div>
      </div>

      {/* Edit Drawer/Modal */}
      {editing && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setEditing(null)}
        >
          <div
            style={{
              backgroundColor: '#fff',
              borderRadius: '8px',
              padding: '24px',
              width: '90%',
              maxWidth: '620px',
              maxHeight: '88vh',
              overflowY: 'auto',
              boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ margin: '0 0 16px', fontSize: '1.2rem' }}>
              编辑助手：{editing.name}
            </h2>

            <div style={{ display: 'grid', gap: '14px' }}>
              <div className="admin-agent-field">
                <span>名称</span>
                <input
                  type="text"
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                />
              </div>

              <div className="admin-agent-field">
                <span>角色定位</span>
                <input
                  type="text"
                  value={editing.role}
                  onChange={(e) => setEditing({ ...editing, role: e.target.value })}
                />
              </div>

              <div className="admin-agent-field">
                <span>功能描述</span>
                <textarea
                  value={editing.description}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                  rows={2}
                />
              </div>

              <div className="admin-agent-field">
                <span>温度参数 (0.0 - 1.5)</span>
                <input
                  type="number"
                  min="0"
                  max="1.5"
                  step="0.1"
                  value={editing.temperature ?? 0.7}
                  onChange={(e) => setEditing({ ...editing, temperature: parseFloat(e.target.value) || 0.7 })}
                />
              </div>

              <div className="admin-agent-field">
                <span>系统指令 / 提示词 (Instructions)</span>
                <textarea
                  value={editing.instructions}
                  onChange={(e) => setEditing({ ...editing, instructions: e.target.value })}
                  rows={6}
                  style={{ fontFamily: 'monospace' }}
                />
              </div>
            </div>

            {saveMessage && (
              <p style={{ marginTop: '12px', color: saveMessage.includes('失败') ? 'crimson' : 'green', fontSize: '0.88rem' }}>
                {saveMessage}
              </p>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
              <Button variant="ghost" onClick={() => setEditing(null)}>
                取消
              </Button>
              <Button variant="primary" onClick={handleSave} loading={saving}>
                保存配置
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
