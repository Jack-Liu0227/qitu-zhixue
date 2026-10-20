'use client';

import { AssistantGlyph } from '@qitu/ui';
import { visualToken } from '@qitu/contracts';
import { VisualAssetPicker, VisualSelector } from '../../../../lib/components/VisualAssetPicker';
import Link from 'next/link';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AdminAssistantConfig } from '@qitu/contracts';
import {
  fetchAdminAssistantConfigs,
  createPersistedAssistant,
  updatePersistedAssistant,
  deletePersistedAssistant,
} from '../../../../lib/api/assistants';
import { newIdempotencyKey } from '../../../../lib/api/modelRegistry';
import { fetchAvailableConfiguredModels, configuredModelKey, configuredModelLabel, configuredModelPatch, type ConfiguredModelItem } from '../../../../lib/api/configuredModels';
import { AdminStateViews } from '../../../../lib/components/AdminStateViews';

interface AssistantItem {
  id: string;
  source: 'builtin' | 'user';
  name: string;
  description: string;
  role: string;
  icon: string;
  enabled: boolean;
  model: string;
  permission: string;
  thinkingLevel: string;
  skillsCount: number;
  mcpSetting: string;
  systemPrompt: string;
  deletable: boolean;
  sortOrder: number;
}

function formatDefault(scalar?: { mode: string; value?: unknown }): string {
  if (!scalar) return '未设置';
  const value = Array.isArray(scalar.value)
    ? (scalar.value.length ? scalar.value.join(', ') : '空')
    : scalar.value;
  return typeof value === 'string' && value ? `${scalar.mode} · ${value}` : scalar.mode;
}

function mapConfigToItem(config: AdminAssistantConfig): AssistantItem {
  return {
    id: config.id,
    source: (config.source as any) || 'user',
    name: config.name,
    description: config.description || '',
    role: config.role || '导师助手',
    icon: config.avatar || '🤖',
    enabled: config.enabled,
    model: config.modelId ? configuredModelKey({ providerId: config.modelProviderId || '', id: config.modelId }) : '',
    permission: formatDefault(config.defaults?.permission),
    thinkingLevel: formatDefault(config.defaults?.thought_level),
    skillsCount: config.enabledSkills?.length ?? 0,
    mcpSetting: formatDefault(config.defaults?.mcps),
    systemPrompt: config.instructions || '',
    deletable: true, // 所有助手均支持管理员删除
    sortOrder: config.sortOrder ?? 0,
  };
}

export default function AdminAssistantsPage() {
  const [assistants, setAssistants] = useState<AssistantItem[]>([]);
  const [configuredModels, setConfiguredModels] = useState<ConfiguredModelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [editingAssistant, setEditingAssistant] = useState<AssistantItem | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [ruleTab, setRuleTab] = useState<'edit' | 'preview'>('edit');
  const [isRuleExpanded, setIsRuleExpanded] = useState(false);
  const [saveNotice, setSaveNotice] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [draftAvatarPicker, setDraftAvatarPicker] = useState(false);

  async function reloadVisuals() {
    const configs = await fetchAdminAssistantConfigs();
    const items = configs.map(mapConfigToItem);
    setAssistants(items);
    setEditingAssistant((current) => current ? { ...current, icon: items.find((item) => item.id === current.id)?.icon ?? current.icon } : null);
  }

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [backendConfigs, models] = await Promise.all([
        fetchAdminAssistantConfigs(),
        fetchAvailableConfiguredModels(),
      ]);

      setConfiguredModels(models);

      // 助手列表以后端接口为唯一真实来源；不再合并仅存 localStorage 的本地记录
      if (backendConfigs) {
        // 过滤掉任何残余的 cli 示例
        const filtered = backendConfigs
          .filter((c) => (c.source as string) !== 'cli' && !c.id.startsWith('cli-'))
          .map(mapConfigToItem);
        setAssistants(filtered);
      } else {
        setAssistants([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error('助手配置加载失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // 当带有 ?action=create 或 ?create=true 参数时，直接打开新建助手编辑器
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('action') === 'create' || params.get('create') === 'true') {
        openCreateNew();
      }
    }
  }, [configuredModels]);

  const toggleAssistantEnabled = async (assistant: AssistantItem, e: React.MouseEvent) => {
    e.stopPropagation();
    const nextState = !assistant.enabled;
    setAssistants((prev) =>
      prev.map((item) => (item.id === assistant.id ? { ...item, enabled: nextState } : item))
    );

    try {
      await updatePersistedAssistant(
        assistant.id,
        { enabled: nextState },
        newIdempotencyKey()
      );
    } catch (err) {
      console.warn('同步助手启用状态至服务端失败', err);
      setAssistants((prev) =>
        prev.map((item) => (item.id === assistant.id ? { ...item, enabled: assistant.enabled } : item))
      );
      setSaveNotice(err instanceof Error ? `状态同步失败：${err.message}` : '状态同步失败，请重试');
    }
  };

  const openEditor = (item: AssistantItem, creating = false) => {
    setEditingAssistant({ ...item });
    setIsCreating(creating);
    setSaveNotice('');
  };

  const openCreateNew = () => {
    const newItem: AssistantItem = {
      id: `assistant-${Date.now()}`,
      source: 'user',
      name: '',
      description: '',
      role: '',
      icon: '',
      enabled: true,
      model: '',
      permission: '未设置（创建后由服务端兜底）',
      thinkingLevel: '未设置（创建后由服务端兜底）',
      skillsCount: 0,
      mcpSetting: '未设置（创建后由服务端兜底）',
      systemPrompt: '',
      deletable: true,
      sortOrder: 10,
    };
    openEditor(newItem, true);
  };

  const handleSaveEditor = async () => {
    if (!editingAssistant) return;
    if (loading || error) { setSaveNotice('模型目录尚未就绪，请重新加载后保存。'); return; }
    if (!editingAssistant.name.trim()) {
      alert('请输入助手名称');
      return;
    }
    setSaveNotice('正在保存配置…');
    try {
      if (isCreating) {
        const created = await createPersistedAssistant(
          {
            name: editingAssistant.name,
            description: editingAssistant.description,
            role: editingAssistant.role || '导师助手',
            instructions: editingAssistant.systemPrompt,
            ...configuredModelPatch(editingAssistant.model, configuredModels),
            enabled: editingAssistant.enabled,
            ...(editingAssistant.icon ? { avatar: editingAssistant.icon } : {}),
          },
          newIdempotencyKey()
        );
        const mappedItem = mapConfigToItem(created);
        setAssistants((prev) => [...prev, mappedItem]);
      } else {
        await updatePersistedAssistant(
          editingAssistant.id,
          {
            name: editingAssistant.name,
            description: editingAssistant.description,
            role: editingAssistant.role,
            instructions: editingAssistant.systemPrompt,
            ...configuredModelPatch(editingAssistant.model, configuredModels),
            enabled: editingAssistant.enabled,
          },
          newIdempotencyKey()
        );
        setAssistants((prev) =>
          prev.map((item) => (item.id === editingAssistant.id ? { ...editingAssistant } : item))
        );
      }
      setSaveNotice('配置已保存到服务端 ✔');
      setTimeout(() => {
        setEditingAssistant(null);
        setIsCreating(false);
      }, 500);
    } catch (err: any) {
      // 保存失败时如实报错，不伪造「已保存」状态，也不关闭编辑器
      setSaveNotice(err?.message ? `保存失败：${err.message}` : '保存失败，请稍后重试');
    }
  };

  const handleDeleteAssistant = async (id: string, name: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const ok = window.confirm(`确定要彻底删除助手「${name}」吗？\n删除后不可恢复。`);
    if (!ok) return;

    try {
      await deletePersistedAssistant(id, newIdempotencyKey());
      setAssistants((prev) => prev.filter((a) => a.id !== id));
      if (editingAssistant?.id === id) {
        setEditingAssistant(null);
        setIsCreating(false);
      }
    } catch (err: any) {
      const msg = err?.message || '删除失败，请稍后重试';
      alert(`删除助手失败：${msg}`);
    }
  };

  const handleBulkSetEnabled = async (enabled: boolean) => {
    if (selected.size === 0) return;
    const targetIds = Array.from(selected);
    setAssistants((prev) =>
      prev.map((item) => (targetIds.includes(item.id) ? { ...item, enabled } : item))
    );
    try {
      await Promise.all(
        targetIds.map((id) =>
          updatePersistedAssistant(id, { enabled }, newIdempotencyKey()).catch(() => null)
        )
      );
      setSelected(new Set());
    } catch {
      // guard
    }
  };

  const handleBulkDelete = async () => {
    if (selected.size === 0) return;
    if (!window.confirm(`确定要彻底删除选中的 ${selected.size} 位导师助手吗？此操作不可逆。`)) return;
    const targetIds = Array.from(selected);
    try {
      await Promise.all(
        targetIds.map((id) =>
          deletePersistedAssistant(id, newIdempotencyKey()).catch(() => null)
        )
      );
      setAssistants((prev) => prev.filter((a) => !targetIds.includes(a.id)));
      setSelected(new Set());
    } catch (err: any) {
      alert(`批量删除失败：${err?.message || '未知错误'}`);
    }
  };

  const filteredAssistants = useMemo(() => {
    if (!searchQuery.trim()) return assistants;
    const q = searchQuery.toLowerCase();
    return assistants.filter(
      (a) => a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q) || a.role.toLowerCase().includes(q)
    );
  }, [assistants, searchQuery]);

  const stateView = AdminStateViews({ loading, error, onRetry: loadData });
  if (stateView && assistants.length === 0) return <div className="admin-settings-page">{stateView}</div>;

  // 编辑视图：严格对齐 AdminUI/助手编辑与设置.png
  if (editingAssistant) {
    return (
      <div className="admin-assistant-editor-view">
        <div className="admin-assistant-editor-topbar">
          <button
            type="button"
            className="admin-assistant-back-btn"
            onClick={() => {
              setEditingAssistant(null);
              setIsCreating(false);
            }}
          >
            ← 返回助手列表
          </button>
          <div className="admin-assistant-topbar-actions">
            {!isCreating && <Link href={`/settings/feishu?assistantId=${encodeURIComponent(editingAssistant.id)}`} className="settings-action-btn">绑定飞书机器人</Link>}
            {saveNotice ? <span className="admin-save-notice">{saveNotice}</span> : null}
            {!isCreating ? (
              <button
                type="button"
                className="settings-action-btn is-danger"
                onClick={() => void handleDeleteAssistant(editingAssistant.id, editingAssistant.name)}
                title="删除此助手"
              >
                删除助手
              </button>
            ) : null}
            <button
              type="button"
              className="settings-action-btn is-primary"
              onClick={handleSaveEditor}
            >
              保存配置
            </button>
            <button
              type="button"
              className="settings-action-btn"
              onClick={() => {
                setEditingAssistant(null);
                setIsCreating(false);
              }}
            >
              取消
            </button>
          </div>
        </div>

        {/* 模块一：身份（改动立即生效） */}
        <section className="admin-editor-card">
          <div className="admin-editor-card-header">
            <span className="admin-editor-section-title">身份</span>
            <span className="admin-editor-tag is-green">改动立即生效</span>
          </div>

          <div className="admin-identity-content">
            <div className="admin-identity-avatar-col">
              <div className="admin-identity-avatar-box">
                <span className="admin-identity-avatar-icon"><AssistantGlyph value={editingAssistant.icon} size={64} /></span>
              </div>
              {isCreating ? <><button type="button" className="admin-avatar-upload-btn" onClick={() => setDraftAvatarPicker(true)}>从素材库选择</button>{draftAvatarPicker && <VisualAssetPicker usage="avatar" onClose={() => setDraftAvatarPicker(false)} onSelect={(selection) => setEditingAssistant({ ...editingAssistant, icon: selection.kind === 'asset' ? visualToken(selection.assetId) : '' })} />}</> : <VisualSelector owner={{ kind: 'assistant', id: editingAssistant.id }} usage="avatar" label="从素材库选择" onSaved={() => void reloadVisuals().catch((failure: unknown) => setSaveNotice(failure instanceof Error ? failure.message : '头像回读失败'))} />}
            </div>

            <div className="admin-identity-fields">
              <div className="admin-form-row">
                <label className="admin-form-label">
                  <span className="required-star">*</span> 名称
                </label>
                <input
                  className="admin-input-text"
                  value={editingAssistant.name}
                  onChange={(e) =>
                    setEditingAssistant({ ...editingAssistant, name: e.target.value })
                  }
                  placeholder="如：数据分析与图表叙事助手"
                />
              </div>

              <div className="admin-form-row">
                <label className="admin-form-label">描述</label>
                <input
                  className="admin-input-text"
                  value={editingAssistant.description}
                  onChange={(e) =>
                    setEditingAssistant({ ...editingAssistant, description: e.target.value })
                  }
                  placeholder="科研数据质量分析、统计检查、图表设计与结果叙事助手"
                />
              </div>

              <div className="admin-form-row">
                <label className="admin-form-label">角色定位</label>
                <input
                  className="admin-input-text"
                  value={editingAssistant.role}
                  onChange={(e) =>
                    setEditingAssistant({ ...editingAssistant, role: e.target.value })
                  }
                  placeholder="如：Team Leader / 原理教练 / 代码向导"
                />
              </div>
            </div>
          </div>
        </section>

        {/* 模块二：默认配置（仅对新会话生效） */}
        <section className="admin-editor-card">
          <div className="admin-editor-card-header">
            <span className="admin-editor-section-title">默认配置</span>
            <span className="admin-editor-tag is-orange">仅对新会话生效</span>
          </div>

          <div className="admin-config-rows">
            {/* 模型选择 */}
            <div className="admin-config-row">
              <div className="admin-config-label-col">
                <span className="admin-config-icon">☁️</span>
                <span className="admin-config-name">模型</span>
              </div>
              <div className="admin-config-field-col">
                <select
                  className="admin-select"
                  value={editingAssistant.model}
                  onChange={(e) =>
                    setEditingAssistant({ ...editingAssistant, model: e.target.value })
                  }
                >
                  <option value="">未指定（跟随平台默认）</option>
                  {editingAssistant.model && !configuredModels.some((model) => configuredModelKey(model) === editingAssistant.model) ? <option value={editingAssistant.model} disabled>当前绑定不可用，请重新选择</option> : null}
                  {configuredModels.map((m) => (
                    <option key={`${m.providerId}-${m.id}`} value={configuredModelKey(m)}>
                      {m.name} ({m.providerName || m.providerId})
                    </option>
                  ))}
                  {configuredModels.length === 0 ? (
                    <option value="" disabled>暂无已配置的模型（请先在模型接入中配置）</option>
                  ) : null}
                </select>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px' }}>
                  <span className="admin-config-hint">
                    来自 NewAPI / 模型供应商通道自动拉取的可用模型。
                  </span>
                  <Link
                    href="/settings/model-providers"
                    style={{ fontSize: '11.5px', color: '#165dff', textDecoration: 'none', fontWeight: 500 }}
                  >
                    管理模型通道与拉取 ↗
                  </Link>
                </div>
              </div>
            </div>

            {/* 权限（服务端默认配置，只读展示） */}
            <div className="admin-config-row">
              <div className="admin-config-label-col">
                <span className="admin-config-icon">🛡️</span>
                <span className="admin-config-name">权限</span>
              </div>
              <div className="admin-config-field-col">
                <div className="admin-inline-selector">
                  <span className="admin-selector-pill">{editingAssistant.permission}</span>
                </div>
                <span className="admin-config-hint">来自服务端助手默认配置（defaults.permission），前端不可伪造修改。</span>
              </div>
            </div>

            {/* 思考强度（服务端默认配置，只读展示） */}
            <div className="admin-config-row">
              <div className="admin-config-label-col">
                <span className="admin-config-icon">🧠</span>
                <span className="admin-config-name">思考强度</span>
              </div>
              <div className="admin-config-field-col">
                <div className="admin-inline-selector">
                  <span className="admin-selector-pill">{editingAssistant.thinkingLevel}</span>
                </div>
                <span className="admin-config-hint">来自服务端助手默认配置（defaults.thought_level），前端不可伪造修改。</span>
              </div>
            </div>

            {/* 技能 */}
            <div className="admin-config-row">
              <div className="admin-config-label-col">
                <span className="admin-config-icon">⚡</span>
                <span className="admin-config-name">技能</span>
              </div>
              <div className="admin-config-field-col">
                <div className="admin-inline-selector">
                  <span className="admin-selector-pill">已选 {editingAssistant.skillsCount} 项</span>
                </div>
                <a href="/admin/settings/skills" className="admin-config-link">
                  前往技能中心管理
                </a>
              </div>
            </div>

            {/* MCP（服务端默认配置只读展示；具体授权在工具页矩阵中操作） */}
            <div className="admin-config-row">
              <div className="admin-config-label-col">
                <span className="admin-config-icon">📦</span>
                <span className="admin-config-name">MCP</span>
              </div>
              <div className="admin-config-field-col">
                <div className="admin-inline-selector">
                  <span className="admin-selector-pill">{editingAssistant.mcpSetting}</span>
                </div>
                <a href="/admin/settings/tools" className="admin-config-link">
                  前往工具页按助手勾选 MCP 授权
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* 模块三：规则（仅对新会话生效） */}
        <section className="admin-editor-card">
          <div className="admin-editor-card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="admin-editor-section-title">规则</span>
              <span className="admin-editor-tag is-orange">仅对新会话生效</span>
            </div>
            <div className="admin-rules-header-actions">
              <div className="admin-segmented-ctrl">
                <button
                  type="button"
                  className={`admin-segmented-item${ruleTab === 'edit' ? ' is-active' : ''}`}
                  onClick={() => setRuleTab('edit')}
                >
                  编辑
                </button>
                <button
                  type="button"
                  className={`admin-segmented-item${ruleTab === 'preview' ? ' is-active' : ''}`}
                  onClick={() => setRuleTab('preview')}
                >
                  预览
                </button>
              </div>
              <button
                type="button"
                className="admin-expand-toggle-btn"
                onClick={() => setIsRuleExpanded((prev) => !prev)}
              >
                {isRuleExpanded ? '收起' : '展开'}
              </button>
            </div>
          </div>

          <div className="admin-rules-body">
            {ruleTab === 'edit' ? (
              <textarea
                className={`admin-prompt-editor-box${isRuleExpanded ? ' is-expanded' : ''}`}
                value={editingAssistant.systemPrompt}
                onChange={(e) =>
                  setEditingAssistant({ ...editingAssistant, systemPrompt: e.target.value })
                }
                placeholder="# 角色\n在此定义助手角色、工作方式、约束条件与发问策略..."
                rows={isRuleExpanded ? 24 : 14}
              />
            ) : (
              <div className={`admin-rules-preview-pane${isRuleExpanded ? ' is-expanded' : ''}`}>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>
                  {editingAssistant.systemPrompt || '（未输入规则 Prompt）'}
                </pre>
              </div>
            )}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="admin-settings-page">
      {/* 顶部操作与搜索栏 */}
      <div className="settings-pagehead">
        <div className="settings-titlebox">
          <h1>AI 教学助手</h1>
          <div className="settings-desc">
            管理基于自主研发 Agent SDK 运行的导师智能体，为 PBL 项目式学习提供苏格拉底式启发教学。
          </div>
        </div>
        <div className="settings-page-actions">
          <div className="settings-search-box">
            <span aria-hidden="true" style={{ opacity: 0.6 }}>🔍</span>
            <input
              type="text"
              placeholder="搜索助手..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="settings-action-btn is-primary"
            onClick={openCreateNew}
          >
            <span>+ 新建助手</span>
          </button>
        </div>
      </div>

      {/* 助手卡片列表 */}
      <section className="admin-assistants-group-section">
        <div className="admin-group-title-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="admin-group-bar" />
            <h2 className="admin-group-title">自主研发 Agent SDK 导师阵容</h2>
            <span className="admin-group-count">{filteredAssistants.length}</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '16px', fontSize: '13px', color: '#475569', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={filteredAssistants.length > 0 && filteredAssistants.every((a) => selected.has(a.id))}
                onChange={(e) => {
                  if (e.target.checked) setSelected(new Set(filteredAssistants.map((a) => a.id)));
                  else setSelected(new Set());
                }}
                style={{ width: '15px', height: '15px', cursor: 'pointer' }}
              />
              <span>全选 ({selected.size}/{filteredAssistants.length})</span>
            </label>
          </div>
          {selected.size > 0 && (
            <div style={{ display: 'flex', gap: '8px' }}>
              <VisualSelector owners={[...selected].map((id) => ({ kind: 'assistant', id }))} usage="avatar" label="批量设置头像" onSaved={() => void reloadVisuals().catch((failure: unknown) => setSaveNotice(failure instanceof Error ? failure.message : '头像回读失败'))} />
              <button
                type="button"
                className="settings-action-btn"
                style={{ padding: '4px 12px', fontSize: '12px' }}
                onClick={() => void handleBulkSetEnabled(true)}
              >
                批量启用
              </button>
              <button
                type="button"
                className="settings-action-btn"
                style={{ padding: '4px 12px', fontSize: '12px' }}
                onClick={() => void handleBulkSetEnabled(false)}
              >
                批量停用
              </button>
              <button
                type="button"
                className="settings-action-btn is-danger"
                style={{ padding: '4px 12px', fontSize: '12px', color: '#dc2626', borderColor: '#fecaca', background: '#fef2f2' }}
                onClick={() => void handleBulkDelete()}
              >
                批量删除 ({selected.size})
              </button>
            </div>
          )}
        </div>

        {filteredAssistants.length === 0 ? (
          <div className="settings-empty">
            {searchQuery ? '没有找到符合条件的助手' : '暂无助手配置，点击右上角新建助手'}
          </div>
        ) : (
          <div className="admin-assistants-cards-grid">
            {filteredAssistants.map((item) => (
              <div
                key={item.id}
                className="admin-assistant-card"
                onClick={() => openEditor(item)}
              >
                <div className="admin-card-top-row">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <input
                      type="checkbox"
                      checked={selected.has(item.id)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) next.add(item.id);
                        else next.delete(item.id);
                        setSelected(next);
                      }}
                      style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                    />
                    <div className="admin-card-icon-box"><AssistantGlyph value={item.icon} size={30} /></div>
                  </div>
                  <div className="admin-card-actions-group">
                    <button
                      type="button"
                      className="admin-card-delete-icon-btn"
                      onClick={(e) => void handleDeleteAssistant(item.id, item.name, e)}
                      title="彻底删除助手"
                    >
                      🗑️
                    </button>
                    <div
                      className={`admin-toggle-switch${item.enabled ? ' is-on' : ''}`}
                      onClick={(e) => void toggleAssistantEnabled(item, e)}
                      title={item.enabled ? '已启用，点击禁用' : '已禁用，点击启用'}
                    >
                      <div className="admin-toggle-knob" />
                    </div>
                  </div>
                </div>

                <div className="admin-card-title-row">
                  <strong className="admin-card-title">{item.name}</strong>
                  <span className="admin-card-role-pill">{item.role}</span>
                </div>

                <p className="admin-card-desc">{item.description || '暂无描述'}</p>

                <div className="admin-card-bottom-row">
                  <span className="admin-agent-meta">
                    模型: <span className="admin-agent-tag" title={configuredModelLabel(item.model, configuredModels)}>{configuredModelLabel(item.model, configuredModels)}</span>
                  </span>
                  <div className="admin-card-buttons-wrap">
                    <button
                      type="button"
                      className="admin-card-action-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        openEditor(item);
                      }}
                    >
                      编辑配置
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
