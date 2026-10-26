'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ModelApi } from '@qitu/contracts';
import { ModelChannelTestModal } from './ModelChannelTestModal';
import { classifyModelGroup, type ModelGroup } from './types';

export interface SelectModelModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentModelIds: string[];
  candidateModels: Array<{ id: string; name?: string }>;
  onConfirm: (selectedModelIds: string[]) => void;
  onFetchModels?: () => Promise<string[] | void>;
  providerId?: string;
  channelName?: string;
  baseUrl?: string;
  apiKey?: string;
  api?: ModelApi;
}

export function SelectModelModal({
  isOpen,
  onClose,
  currentModelIds,
  candidateModels,
  onConfirm,
  onFetchModels,
  providerId,
  channelName,
  baseUrl,
  apiKey,
  api,
}: SelectModelModalProps) {
  const [activeTab, setActiveTab] = useState<'new' | 'existing'>('new');
  const [searchQuery, setSearchQuery] = useState('');
  const [isTestingSelected, setIsTestingSelected] = useState(false);
  const [isFetchingInModal, setIsFetchingInModal] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});

  const mergedPool = useMemo(() => {
    const map = new Map<string, { id: string; name: string; group: ModelGroup }>();
    for (const c of candidateModels) {
      if (!map.has(c.id)) {
        map.set(c.id, {
          id: c.id,
          name: c.name || c.id,
          group: classifyModelGroup(c.id),
        });
      }
    }
    return Array.from(map.values());
  }, [candidateModels]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(currentModelIds));

  useEffect(() => {
    if (isOpen) {
      setSelectedIds(new Set(currentModelIds));
      setSearchQuery('');
    }
  }, [isOpen, currentModelIds]);

  const existingModels = useMemo(() => mergedPool.filter((m) => currentModelIds.includes(m.id)), [mergedPool, currentModelIds]);
  const newModels = useMemo(() => mergedPool.filter((m) => !currentModelIds.includes(m.id)), [mergedPool, currentModelIds]);

  const displayList = useMemo(() => {
    const base = activeTab === 'new' ? newModels : existingModels;
    if (!searchQuery.trim()) return base;
    const q = searchQuery.toLowerCase().trim();
    return base.filter((m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q));
  }, [activeTab, newModels, existingModels, searchQuery]);

  const groupedDisplay = useMemo(() => {
    const groups: Record<string, typeof displayList> = {};
    for (const item of displayList) {
      const target = groups[item.group] ?? (groups[item.group] = []);
      target.push(item);
    }
    return groups;
  }, [displayList]);

  if (!isOpen) return null;

  const toggleCategory = (cat: string) => {
    setExpandedCategories((prev) => ({ ...prev, [cat]: !prev[cat] }));
  };

  const toggleSelectAllCategory = (cat: string, items: typeof displayList) => {
    const allSelected = items.length > 0 && items.every((i) => selectedIds.has(i.id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        for (const i of items) next.delete(i.id);
      } else {
        for (const i of items) next.add(i.id);
      }
      return next;
    });
  };

  const toggleItem = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAllFiltered = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const item of displayList) next.add(item.id);
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const item of displayList) next.delete(item.id);
        return next;
      });
    }
  };

  const allFilteredSelected = displayList.length > 0 && displayList.every((item) => selectedIds.has(item.id));

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.5)',
        backdropFilter: 'blur(4px)',
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(92vw, 620px)',
          maxHeight: '85vh',
          background: '#ffffff',
          borderRadius: '16px',
          boxShadow: '0 24px 48px rgba(0, 0, 0, 0.18)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: 'aionFadeIn 0.2s ease',
        }}
      >
        {/* 顶部标题与标签切换 */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '16px 22px',
            borderBottom: '1px solid #f1f5f9',
          }}
        >
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>选择模型</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
            <button
              type="button"
              onClick={() => setActiveTab('new')}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontWeight: activeTab === 'new' ? 700 : 500,
                color: activeTab === 'new' ? '#165dff' : '#64748b',
                padding: '4px 6px',
              }}
            >
              新获取的模型 ({newModels.length})
            </button>
            <span style={{ color: '#cbd5e1' }}>/</span>
            <button
              type="button"
              onClick={() => setActiveTab('existing')}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontWeight: activeTab === 'existing' ? 700 : 500,
                color: activeTab === 'existing' ? '#165dff' : '#64748b',
                padding: '4px 6px',
              }}
            >
              已有的模型 ({existingModels.length})
            </button>
          </div>
        </div>

        {/* 搜索框与快捷操作 */}
        <div style={{ padding: '14px 22px 10px', display: 'flex', gap: '10px', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <span style={{ position: 'absolute', left: '12px', top: '9px', color: '#94a3b8' }}>🔍</span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索模型名称或模型 ID"
              style={{
                width: '100%',
                height: '38px',
                paddingLeft: '34px',
                paddingRight: '12px',
                borderRadius: '8px',
                border: '1px solid #dce4ee',
                fontSize: '13px',
                boxSizing: 'border-box',
                outline: 'none',
              }}
            />
          </div>
          {onFetchModels ? (
            <button
              type="button"
              disabled={isFetchingInModal}
              onClick={async () => {
                setIsFetchingInModal(true);
                try {
                  const fetched = await onFetchModels();
                  if (Array.isArray(fetched) && fetched.length > 0) {
                    setSearchQuery('');
                  }
                } finally {
                  setIsFetchingInModal(false);
                }
              }}
              style={{
                padding: '0 12px',
                height: '38px',
                borderRadius: '8px',
                border: 'none',
                background: '#165dff',
                color: '#ffffff',
                fontSize: '12.5px',
                fontWeight: 600,
                cursor: isFetchingInModal ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {isFetchingInModal ? '正在获取...' : '获取模型列表（只读）'}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() =>
              setSelectedIds((prev) => {
                const next = new Set(prev);
                for (const item of displayList) next.add(item.id);
                return next;
              })
            }
            disabled={displayList.length === 0}
            style={{
              padding: '0 12px',
              height: '38px',
              borderRadius: '8px',
              border: '1px solid #bfdbfe',
              background: '#eff6ff',
              color: '#1d4ed8',
              fontSize: '12.5px',
              fontWeight: 600,
              cursor: displayList.length === 0 ? 'not-allowed' : 'pointer',
              opacity: displayList.length === 0 ? 0.6 : 1,
              whiteSpace: 'nowrap',
            }}
          >
            全选当前列表
          </button>
          <button
            type="button"
            disabled={selectedIds.size === 0}
            onClick={() => setSelectedIds(new Set())}
            style={{
              padding: '0 12px',
              height: '38px',
              borderRadius: '8px',
              border: '1px solid #e2e8f0',
              background: '#f8fafc',
              color: '#dc2626',
              fontSize: '12.5px',
              fontWeight: 500,
              cursor: selectedIds.size === 0 ? 'not-allowed' : 'pointer',
              opacity: selectedIds.size === 0 ? 0.6 : 1,
              whiteSpace: 'nowrap',
            }}
          >
            清除所有模型
          </button>
          {providerId ? (
            <button
              type="button"
              disabled={selectedIds.size === 0}
              onClick={() => setIsTestingSelected(true)}
              style={{
                padding: '0 12px',
                height: '38px',
                borderRadius: '8px',
                border: '1px solid #a7f3d0',
                background: '#ecfdf5',
                color: '#047857',
                fontSize: '12.5px',
                fontWeight: 600,
                cursor: selectedIds.size === 0 ? 'not-allowed' : 'pointer',
                opacity: selectedIds.size === 0 ? 0.6 : 1,
                whiteSpace: 'nowrap',
              }}
            >
              🧪 模型测试 ({selectedIds.size})
            </button>
          ) : null}
        </div>

        {/* 分组与模型列表（支持二级折叠与多选） */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 22px 16px' }}>
          {mergedPool.length === 0 ? (
            <div
              style={{
                padding: '36px 20px',
                textAlign: 'center',
                color: '#64748b',
                fontSize: '13px',
                background: '#f8fafc',
                border: '1px dashed #cbd5e1',
                borderRadius: '10px',
                margin: '10px 0',
              }}
            >
              <div style={{ fontSize: '15px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                该通道还没有可选模型
              </div>
              <div>
                请先点击上方「获取模型列表（只读）」从上游网关获取候选模型，
                再勾选并点击「确定」保存。获取失败时会展示具体原因，不会填入任何预设模型。
              </div>
            </div>
          ) : displayList.length === 0 ? (
            <div style={{ padding: '28px 20px', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>
              当前标签页 / 搜索条件下没有匹配的模型
            </div>
          ) : null}
          {Object.entries(groupedDisplay).map(([groupName, items]) => {
            if (items.length === 0) return null;
            const isExpanded = expandedCategories[groupName] ?? true;
            const isCatAllSelected = items.every((i) => selectedIds.has(i.id));

            return (
              <div
                key={groupName}
                style={{
                  marginBottom: '10px',
                  border: '1px solid #eef2f6',
                  borderRadius: '10px',
                  overflow: 'hidden',
                }}
              >
                {/* 一级分类行 */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    background: '#f8fafc',
                    cursor: 'pointer',
                  }}
                  onClick={() => toggleCategory(groupName)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontWeight: 600, fontSize: '13px', color: '#1e293b' }}>
                      {groupName} ({items.length})
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <input
                      type="checkbox"
                      checked={isCatAllSelected}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleSelectAllCategory(groupName, items)}
                      title={`全选 ${groupName} 分类下的模型`}
                      style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                    />
                    <span style={{ color: '#64748b', fontSize: '12px' }}>{isExpanded ? '▲' : '▼'}</span>
                  </div>
                </div>

                {/* 二级展开模型项 */}
                {isExpanded && (
                  <div style={{ padding: '8px 14px', background: '#ffffff', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {items.map((model) => {
                      const isChecked = selectedIds.has(model.id);
                      return (
                        <label
                          key={model.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '6px 8px',
                            borderRadius: '6px',
                            background: isChecked ? '#f0f7ff' : 'transparent',
                            cursor: 'pointer',
                            transition: 'background 0.15s ease',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleItem(model.id)}
                              style={{ cursor: 'pointer', width: '15px', height: '15px' }}
                            />
                            <div>
                              <span style={{ fontSize: '13px', fontWeight: 500, color: '#0f172a' }}>{model.id}</span>
                              {model.name && model.name !== model.id ? (
                                <span style={{ fontSize: '11.5px', color: '#64748b', marginLeft: '6px' }}>({model.name})</span>
                              ) : null}
                            </div>
                          </div>
                          <span style={{ fontSize: '10.5px', color: '#94a3b8', background: '#f1f5f9', padding: '1px 6px', borderRadius: '4px' }}>
                            {model.group}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* 底部按钮栏 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 22px',
            borderTop: '1px solid #f1f5f9',
            background: '#ffffff',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#475569' }}>
            <span>已选择 {selectedIds.size} / {displayList.length}</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', marginLeft: '8px' }}>
              <input type="checkbox" checked={allFilteredSelected} onChange={handleSelectAllFiltered} />
              <span style={{ fontSize: '12px' }}>全选</span>
            </label>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '12px', marginLeft: '6px' }}
            >
              清除已选
            </button>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              type="button"
              className="settings-action-btn"
              onClick={onClose}
              style={{ minWidth: '72px' }}
            >
              取消
            </button>
            <button
              type="button"
              className="settings-action-btn is-primary"
              onClick={() => {
                onConfirm(Array.from(selectedIds));
                onClose();
              }}
              style={{ minWidth: '72px' }}
            >
              保存模型选择
            </button>
          </div>
        </div>
        {isTestingSelected && (
          <ModelChannelTestModal
            isOpen={isTestingSelected}
            onClose={() => setIsTestingSelected(false)}
            channelName={channelName || '已选模型测试'}
            baseUrl={baseUrl || ''}
            apiKey={apiKey}
            api={api || 'openai-completions'}
            providerId={providerId}
            models={Array.from(selectedIds)}
          />
        )}
      </div>
    </div>
  );
}
