'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type {
  AdminProvidersResponse,
  ConnectionTestResponse,
  ModelApi,
  ModelDescriptor,
  ProviderConfigPublic,
  ProviderPreset,
  UpsertProviderRequest,
} from '@qitu/contracts';
import {
  createManualModel,
  deleteManualModel,
  deleteProvider,
  fetchProviders,
  newIdempotencyKey,
  refreshProvider,
  testModelConnection,
  testProviderConnection,
  upsertProvider,
} from '../../../../lib/api/modelRegistry';
import { UsageRoutingPanel } from '../../../../lib/components/UsageRoutingPanel';
import { AdminStateViews } from '../../../../lib/components/AdminStateViews';

const API_OPTIONS: Array<{ value: ModelApi; label: string; channelType: string }> = [
  { value: 'openai-completions', label: 'OpenAI Chat Completions', channelType: 'OpenAI' },
  { value: 'openai-responses', label: 'OpenAI Responses', channelType: 'OpenAI Responses' },
  { value: 'anthropic-messages', label: 'Anthropic Messages', channelType: 'Anthropic' },
  { value: 'google-gemini', label: 'Google Gemini (Native / OpenAI Compatible)', channelType: 'Gemini' },
];

const PRESET_ALL_MODELS: Array<{ id: string; name: string; group: 'OpenAI' | '阿里百炼 / 通义千问' | 'DeepSeek' | 'Anthropic Claude' | 'Google Gemini' | '其他' }> = [
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro (Thinking / 旗舰)', group: 'Google Gemini' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash (超极速)', group: 'Google Gemini' },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', group: 'Google Gemini' },
  { id: 'gemini-2.0-flash-thinking-exp-01-21', name: 'Gemini 2.0 Flash Thinking', group: 'Google Gemini' },
  { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', group: 'Google Gemini' },
  { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', group: 'Google Gemini' },
  { id: 'gpt-5.6-sol', name: 'GPT-5.6 Solar', group: 'OpenAI' },
  { id: 'gpt-5.5', name: 'GPT-5.5 Turbo', group: 'OpenAI' },
  { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', group: 'OpenAI' },
  { id: 'gpt-6-astra', name: 'GPT-6 Astra', group: 'OpenAI' },
  { id: 'gpt-6-sol', name: 'GPT-6 Solar', group: 'OpenAI' },
  { id: 'gpt-6.1-sol', name: 'GPT-6.1 Solar Pro', group: 'OpenAI' },
  { id: 'gpt-4o', name: 'GPT-4o Omni', group: 'OpenAI' },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', group: 'OpenAI' },
  { id: 'o1-preview', name: 'OpenAI o1 Reasoning Preview', group: 'OpenAI' },
  { id: 'o3-mini', name: 'OpenAI o3-mini', group: 'OpenAI' },
  { id: 'text-embedding-3-small', name: 'Embedding 3 Small', group: 'OpenAI' },
  { id: 'qwen3.5-flash', name: 'Qwen 3.5 Flash (千问极速版)', group: '阿里百炼 / 通义千问' },
  { id: 'qwen-plus', name: 'Qwen Plus', group: '阿里百炼 / 通义千问' },
  { id: 'qwen-max', name: 'Qwen Max (百炼旗舰)', group: '阿里百炼 / 通义千问' },
  { id: 'qwen-turbo', name: 'Qwen Turbo', group: '阿里百炼 / 通义千问' },
  { id: 'deepseek-chat', name: 'DeepSeek-V3 Chat', group: 'DeepSeek' },
  { id: 'deepseek-reasoner', name: 'DeepSeek-R1 Reasoner', group: 'DeepSeek' },
  { id: 'claude-3-7-sonnet', name: 'Claude 3.7 Sonnet', group: 'Anthropic Claude' },
  { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', group: 'Anthropic Claude' },
  { id: 'claude-3-5-haiku', name: 'Claude 3.5 Haiku', group: 'Anthropic Claude' },
  { id: 'custom-internal-pbl-v1', name: '启途智学 PBL 内置微调模型', group: '其他' },
];

function formatTime(value: string | null | undefined): string {
  if (!value) return '未同步';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '未同步' : date.toLocaleString('zh-CN', { hour12: false });
}

function classifyModelGroup(modelId: string): 'OpenAI' | '阿里百炼 / 通义千问' | 'DeepSeek' | 'Anthropic Claude' | 'Google Gemini' | '其他' {
  const lower = modelId.toLowerCase();
  if (lower.includes('gemini') || lower.includes('google')) {
    return 'Google Gemini';
  }
  if (lower.startsWith('gpt-') || lower.startsWith('o1-') || lower.startsWith('o3-') || lower.includes('openai') || lower.includes('embedding')) {
    return 'OpenAI';
  }
  if (lower.includes('qwen') || lower.includes('bailian') || lower.includes('wanx')) {
    return '阿里百炼 / 通义千问';
  }
  if (lower.includes('deepseek')) {
    return 'DeepSeek';
  }
  if (lower.includes('claude') || lower.includes('anthropic')) {
    return 'Anthropic Claude';
  }
  return '其他';
}

/* ========================================================================= */
/* 2. 选择模型模态弹窗（严格对齐用户提供的图片例子 Image 4）                      */
/* ========================================================================= */
interface SelectModelModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentModelIds: string[];
  candidateModels: Array<{ id: string; name?: string }>;
  onConfirm: (selectedModelIds: string[]) => void;
}

function SelectModelModal({ isOpen, onClose, currentModelIds, candidateModels, onConfirm }: SelectModelModalProps) {
  const [activeTab, setActiveTab] = useState<'new' | 'existing'>('new');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({
    'Google Gemini': true,
    OpenAI: true,
    '阿里百炼 / 通义千问': true,
    DeepSeek: true,
    'Anthropic Claude': true,
    其他: true,
  });

  // 合并候选模型与预置全量模型
  const mergedPool = useMemo(() => {
    const map = new Map<string, { id: string; name: string; group: 'OpenAI' | '阿里百炼 / 通义千问' | 'DeepSeek' | 'Anthropic Claude' | 'Google Gemini' | '其他' }>();
    for (const m of PRESET_ALL_MODELS) {
      map.set(m.id, m);
    }
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

  // 按分类归档
  const groupedDisplay = useMemo(() => {
    const groups: Record<string, typeof displayList> = {
      'Google Gemini': [],
      OpenAI: [],
      '阿里百炼 / 通义千问': [],
      DeepSeek: [],
      'Anthropic Claude': [],
      其他: [],
    };
    for (const item of displayList) {
      const target = groups[item.group] ?? groups['其他'];
      if (target) {
        target.push(item);
      }
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
          <button
            type="button"
            onClick={() => setSelectedIds(new Set(displayList.map((m) => m.id)))}
            style={{
              padding: '0 12px',
              height: '38px',
              borderRadius: '8px',
              border: '1px solid #bfdbfe',
              background: '#eff6ff',
              color: '#1d4ed8',
              fontSize: '12.5px',
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            全选
          </button>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            style={{
              padding: '0 12px',
              height: '38px',
              borderRadius: '8px',
              border: '1px solid #e2e8f0',
              background: '#f8fafc',
              color: '#64748b',
              fontSize: '12.5px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            清除模型
          </button>
        </div>

        {/* 分组与模型列表（支持二级折叠与多选） */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 22px 16px' }}>
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
              确定
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ========================================================================= */
/* 2.5 渠道的模型测试模态弹窗（严格对齐图片 media_1792165815300_79d39dda.png）  */
/* ========================================================================= */
interface ModelChannelTestModalProps {
  isOpen: boolean;
  onClose: () => void;
  channelName: string;
  baseUrl: string;
  apiKey?: string;
  api: ModelApi;
  providerId?: string;
  models: string[];
}

function ModelChannelTestModal({
  isOpen,
  onClose,
  channelName,
  baseUrl,
  apiKey,
  api,
  providerId,
  models,
}: ModelChannelTestModalProps) {
  const [endpointType, setEndpointType] = useState<'auto' | 'chat' | 'completions'>('auto');
  const [isStream, setIsStream] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set(models));
  const [testResults, setTestResults] = useState<
    Record<string, { status: 'idle' | 'running' | 'success' | 'error'; latencyMs?: number; error?: string }>
  >({});
  const [isBatchTesting, setIsBatchTesting] = useState(false);
  const cancelBatchRef = useRef(false);

  useEffect(() => {
    if (isOpen) {
      setSelectedKeys(new Set(models));
      setSearchQuery('');
      setTestResults({});
      setIsBatchTesting(false);
      cancelBatchRef.current = false;
    }
  }, [isOpen, models]);

  const filteredModels = useMemo(() => {
    if (!searchQuery.trim()) return models;
    const q = searchQuery.toLowerCase().trim();
    return models.filter((m) => m.toLowerCase().includes(q));
  }, [models, searchQuery]);

  if (!isOpen) return null;

  const runTestForModel = async (modelName: string) => {
    setTestResults((prev) => ({ ...prev, [modelName]: { status: 'running' } }));
    const startTime = performance.now();
    try {
      if (providerId) {
        const res = await testModelConnection(providerId, modelName);
        const elapsed = Math.round(performance.now() - startTime);
        if (res.ok) {
          setTestResults((prev) => ({
            ...prev,
            [modelName]: { status: 'success', latencyMs: res.latencyMs || elapsed },
          }));
        } else {
          setTestResults((prev) => ({
            ...prev,
            [modelName]: { status: 'error', error: res.error || '连接未通过' },
          }));
        }
      } else {
        const currentUrl = baseUrl.trim() || (api === 'google-gemini' ? 'https://generativelanguage.googleapis.com' : 'https://api.openai.com/v1');
        let success = false;
        let errMsg = '';
        if (api === 'google-gemini' || currentUrl.includes('googleapis.com')) {
          const geminiUrl = `${currentUrl.replace(/\/$/u, '')}/v1beta/models/${modelName}:generateContent${apiKey ? `?key=${encodeURIComponent(apiKey)}` : ''}`;
          const res = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(apiKey ? { 'x-goog-api-key': apiKey } : {}) },
            body: JSON.stringify({ contents: [{ parts: [{ text: 'hi' }] }] }),
          });
          if (res.ok) success = true;
          else {
            const err = await res.json().catch(() => null);
            errMsg = err?.error?.message || `HTTP ${res.status}`;
          }
        } else {
          const ep = endpointType === 'completions' ? '/completions' : '/chat/completions';
          const chatUrl = `${currentUrl.replace(/\/$/u, '')}${ep}`;
          const res = await fetch(chatUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            },
            body: JSON.stringify({
              model: modelName,
              messages: [{ role: 'user', content: 'hi' }],
              max_tokens: 5,
              stream: isStream,
            }),
          });
          if (res.ok) success = true;
          else {
            const err = await res.json().catch(() => null);
            errMsg = err?.error?.message || `HTTP ${res.status}`;
          }
        }
        const elapsed = Math.round(performance.now() - startTime);
        if (success) {
          setTestResults((prev) => ({
            ...prev,
            [modelName]: { status: 'success', latencyMs: elapsed },
          }));
        } else {
          setTestResults((prev) => ({
            ...prev,
            [modelName]: { status: 'error', error: errMsg || '测试失败' },
          }));
        }
      }
    } catch (err: any) {
      setTestResults((prev) => ({
        ...prev,
        [modelName]: { status: 'error', error: err?.message || '网络连接或跨域异常' },
      }));
    }
  };

  const runBatchTest = async () => {
    setIsBatchTesting(true);
    cancelBatchRef.current = false;
    const targets = models.filter((m) => selectedKeys.has(m));
    for (const m of targets) {
      if (cancelBatchRef.current) break;
      await runTestForModel(m);
    }
    setIsBatchTesting(false);
  };

  const handleCopySelected = () => {
    const list = Array.from(selectedKeys).join('\n');
    navigator.clipboard?.writeText(list);
    alert(`已复制 ${selectedKeys.size} 个模型名称到剪贴板`);
  };

  const handleSelectSuccess = () => {
    const successModels = models.filter((m) => testResults[m]?.status === 'success');
    setSelectedKeys(new Set(successModels));
  };

  const toggleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedKeys(new Set(filteredModels));
    } else {
      setSelectedKeys(new Set());
    }
  };

  const allSelected = filteredModels.length > 0 && filteredModels.every((m) => selectedKeys.has(m));

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.55)',
        backdropFilter: 'blur(4px)',
        zIndex: 1200,
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
          width: 'min(94vw, 840px)',
          maxHeight: '90vh',
          background: '#ffffff',
          borderRadius: '16px',
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.22)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: 'aionFadeIn 0.2s ease',
        }}
      >
        {/* 顶部标题栏 */}
        <div
          style={{
            padding: '16px 24px',
            borderBottom: '1px solid #f1f5f9',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: '#fafcff',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <strong style={{ fontSize: '16px', color: '#0f172a' }}>
              {channelName || baseUrl || '网关'} 渠道的模型测试
            </strong>
            <span style={{ fontSize: '13px', color: '#64748b' }}>共 {models.length} 个模型</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: '18px', color: '#94a3b8', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>

        <div style={{ padding: '16px 24px 10px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* 端点类型与流式控制栏 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#1e293b' }}>端点类型:</span>
              <select
                value={endpointType}
                onChange={(e) => setEndpointType(e.target.value as any)}
                style={{
                  height: '34px',
                  padding: '0 10px',
                  borderRadius: '6px',
                  border: '1px solid #dce4ee',
                  fontSize: '13px',
                  color: '#0f172a',
                  background: '#ffffff',
                }}
              >
                <option value="auto">自动检测</option>
                <option value="chat">Chat Completions (/chat/completions)</option>
                <option value="completions">Completions (/completions)</option>
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#1e293b' }}>流式:</span>
              <label style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={isStream}
                  onChange={(e) => setIsStream(e.target.checked)}
                  style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                />
              </label>
            </div>
          </div>

          {/* 蓝底说明条 */}
          <div
            style={{
              padding: '10px 14px',
              background: '#eff6ff',
              borderRadius: '8px',
              color: '#1d4ed8',
              fontSize: '12.5px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <span>ℹ️</span>
            <span>说明：本页测试为非流式请求；若渠道仅支持流式返回，可能出现测试失败，请以实际使用为准。</span>
          </div>

          {/* 搜索与快捷操作栏 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <span style={{ position: 'absolute', left: '10px', top: '8px', color: '#94a3b8' }}>🔍</span>
              <input
                type="text"
                placeholder="搜索模型..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  height: '34px',
                  paddingLeft: '32px',
                  paddingRight: '10px',
                  borderRadius: '6px',
                  border: '1px solid #dce4ee',
                  fontSize: '13px',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={handleCopySelected}
                style={{
                  padding: '6px 12px',
                  background: '#f8fafc',
                  border: '1px solid #cbd5e1',
                  borderRadius: '6px',
                  fontSize: '12.5px',
                  color: '#334155',
                  cursor: 'pointer',
                  fontWeight: 500,
                }}
              >
                复制已选
              </button>
              <button
                type="button"
                onClick={handleSelectSuccess}
                style={{
                  padding: '6px 12px',
                  background: '#f8fafc',
                  border: '1px solid #cbd5e1',
                  borderRadius: '6px',
                  fontSize: '12.5px',
                  color: '#334155',
                  cursor: 'pointer',
                  fontWeight: 500,
                }}
              >
                选择成功
              </button>
            </div>
          </div>
        </div>

        {/* 模型测试表格 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 24px 10px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e2e8f0', color: '#64748b', fontSize: '12.5px' }}>
                <th style={{ padding: '10px 8px', width: '36px' }}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={(e) => toggleSelectAll(e.target.checked)}
                    style={{ cursor: 'pointer' }}
                  />
                </th>
                <th style={{ padding: '10px 8px' }}>模型名称</th>
                <th style={{ padding: '10px 8px', width: '220px' }}>状态</th>
                <th style={{ padding: '10px 8px', width: '80px', textAlign: 'right' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredModels.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ padding: '24px', textAlign: 'center', color: '#94a3b8' }}>
                    未找到模型
                  </td>
                </tr>
              ) : (
                filteredModels.map((model) => {
                  const isChecked = selectedKeys.has(model);
                  const result = testResults[model];
                  return (
                    <tr
                      key={model}
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        background: isChecked ? '#fbfcfe' : '#ffffff',
                      }}
                    >
                      <td style={{ padding: '10px 8px' }}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            const next = new Set(selectedKeys);
                            if (e.target.checked) next.add(model);
                            else next.delete(model);
                            setSelectedKeys(next);
                          }}
                          style={{ cursor: 'pointer' }}
                        />
                      </td>
                      <td style={{ padding: '10px 8px' }}>
                        <strong style={{ color: '#0f172a' }}>{model}</strong>
                      </td>
                      <td style={{ padding: '10px 8px' }}>
                        {!result || result.status === 'idle' ? (
                          <span style={{ fontSize: '12px', color: '#64748b', background: '#f1f5f9', padding: '2px 8px', borderRadius: '4px' }}>
                            未开始
                          </span>
                        ) : result.status === 'running' ? (
                          <span style={{ fontSize: '12px', color: '#165dff', background: '#eff6ff', padding: '2px 8px', borderRadius: '4px', fontWeight: 600 }}>
                            ⚡ 测试中...
                          </span>
                        ) : result.status === 'success' ? (
                          <span style={{ fontSize: '12px', color: '#16a34a', background: '#ecfdf5', padding: '2px 8px', borderRadius: '4px', fontWeight: 600 }}>
                            ✓ 成功 · {result.latencyMs}ms
                          </span>
                        ) : (
                          <span style={{ fontSize: '12px', color: '#dc2626', background: '#fef2f2', padding: '2px 8px', borderRadius: '4px' }} title={result.error}>
                            ✕ 失败: {result.error?.slice(0, 36) || '未通过'}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '10px 8px', textAlign: 'right' }}>
                        <button
                          type="button"
                          onClick={() => void runTestForModel(model)}
                          disabled={result?.status === 'running'}
                          style={{
                            padding: '3px 10px',
                            borderRadius: '4px',
                            border: '1px solid #cbd5e1',
                            background: '#ffffff',
                            color: '#334155',
                            fontSize: '12px',
                            cursor: 'pointer',
                          }}
                        >
                          测试
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* 底部按钮栏 */}
        <div
          style={{
            padding: '12px 24px',
            borderTop: '1px solid #f1f5f9',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: '#ffffff',
          }}
        >
          <span style={{ fontSize: '12.5px', color: '#64748b' }}>
            显示第 1 条-第 {filteredModels.length} 条，共 {models.length} 条
          </span>
          <div style={{ display: 'flex', gap: '10px' }}>
            {isBatchTesting ? (
              <button
                type="button"
                className="settings-action-btn is-danger"
                onClick={() => {
                  cancelBatchRef.current = true;
                  setIsBatchTesting(false);
                }}
              >
                停止测试
              </button>
            ) : (
              <button type="button" className="settings-action-btn" onClick={onClose}>
                取消
              </button>
            )}
            <button
              type="button"
              className="settings-action-btn is-primary"
              disabled={isBatchTesting || selectedKeys.size === 0}
              onClick={() => void runBatchTest()}
            >
              {isBatchTesting ? '正在批量测试...' : `批量测试 ${selectedKeys.size} 个模型`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ========================================================================= */
/* 3. 更新渠道信息 / 新建渠道模态框（严格对齐用户提供的图片例子 Image 3）       */
/* ========================================================================= */
interface ChannelEditorModalProps {
  initial?: ProviderConfigPublic;
  preset?: ProviderPreset;
  isCopy?: boolean;
  onSaved: (provider: ProviderConfigPublic) => void;
  onClose: () => void;
}

function ChannelEditorModal({ initial, preset, isCopy, onSaved, onClose }: ChannelEditorModalProps) {
  const [channelType, setChannelType] = useState(() => {
    if (initial?.api === 'google-gemini') return 'Gemini';
    if (initial?.api === 'anthropic-messages') return 'Anthropic';
    return 'OpenAI';
  });
  const [id, setId] = useState(() => {
    if (isCopy && initial) return `${initial.id}-copy`;
    if (initial) return initial.id;
    return '';
  });
  const [name, setName] = useState(() => {
    if (isCopy && initial) return `${initial.name} (副本)`;
    if (initial) return initial.name;
    if (preset) return preset.name;
    return '';
  });
  const [baseUrl, setBaseUrl] = useState(() => {
    if (initial) return initial.baseUrl;
    if (preset) return preset.baseUrl;
    return '';
  });
  const [api, setApi] = useState<ModelApi>(() => {
    if (initial) return initial.api;
    if (preset) return preset.api;
    return 'openai-completions';
  });
  const [authHeader, setAuthHeader] = useState(initial?.authHeader ?? preset?.authHeader ?? true);
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [organization, setOrganization] = useState('');
  const [showKey, setShowKey] = useState(false);

  // 模型 Tags 列表 - 添加新模型时默认全部为空，仅复制Provider复用已有模型
  const [modelTags, setModelTags] = useState<string[]>(() => {
    if (isCopy && initial?.models?.length) return initial.models.map((m) => m.id);
    if (!isCopy && initial?.models?.length) return initial.models.map((m) => m.id);
    return [];
  });

  const [customModelInput, setCustomModelInput] = useState('');
  const [fetchingModels, setFetchingModels] = useState(false);
  const [testModalOpen, setTestModalOpen] = useState(false);

  // 高级设置状态
  const [detectUpstreamUpdate, setDetectUpstreamUpdate] = useState(false);
  const [autoSyncUpstreamUpdate, setAutoSyncUpstreamUpdate] = useState(false);
  const [ignoredModels, setIgnoredModels] = useState('gpt-4.1-nano,regex:^claude-.*$,regex:^sora-.*$');
  const [headerOverride, setHeaderOverride] = useState('');
  const [statusRewrite, setStatusRewrite] = useState<Array<{ from: string; to: string }>>([]);

  const [selectModelModalOpen, setSelectModelModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const keyRef = useRef<HTMLInputElement>(null);

  const removeModelTag = (tag: string) => {
    setModelTags((prev) => prev.filter((t) => t !== tag));
  };

  const handleAddCustomModel = () => {
    const val = customModelInput.trim();
    if (!val) return;
    if (!modelTags.includes(val)) {
      setModelTags((prev) => [...prev, val]);
    }
    setCustomModelInput('');
  };

  const handleFetchModels = async () => {
    const url = baseUrl.trim().replace(/\/$/u, '');
    const key = keyRef.current?.value || '';
    setFetchingModels(true);
    try {
      let fetchedList: string[] = [];
      if (api === 'google-gemini' || url.includes('googleapis.com')) {
        const gUrl = `${url || 'https://generativelanguage.googleapis.com'}/v1beta/models${key ? `?key=${encodeURIComponent(key)}` : ''}`;
        const res = await fetch(gUrl, { headers: key ? { 'x-goog-api-key': key } : {} });
        if (res.ok) {
          const json = await res.json();
          if (json?.models) {
            fetchedList = json.models.map((m: any) => m.name.replace('models/', ''));
          }
        }
      } else {
        const mUrl = `${url || 'https://api.openai.com/v1'}/models`;
        const headers: Record<string, string> = {};
        if (key) headers['Authorization'] = `Bearer ${key}`;
        const res = await fetch(mUrl, { headers });
        if (res.ok) {
          const json = await res.json();
          if (Array.isArray(json?.data)) {
            fetchedList = json.data.map((m: any) => m.id);
          }
        }
      }
      if (fetchedList.length > 0) {
        setModelTags((prev) => Array.from(new Set([...prev, ...fetchedList])));
        alert(`成功获取并添加 ${fetchedList.length} 个模型！`);
      } else {
        const allPresets = PRESET_ALL_MODELS.map((m) => m.id);
        setModelTags((prev) => Array.from(new Set([...prev, ...allPresets])));
        alert('已自动载入全量模型库（上游直接请求受浏览器同源策略限制时使用标准模型库）');
      }
    } catch {
      const allPresets = PRESET_ALL_MODELS.map((m) => m.id);
      setModelTags((prev) => Array.from(new Set([...prev, ...allPresets])));
      alert('已自动载入全量模型库（上游直接请求受浏览器同源策略限制时使用标准模型库）');
    } finally {
      setFetchingModels(false);
    }
  };

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let providerId = id.trim();
    if (!providerId) {
      providerId = name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 40) || `channel-${Date.now().toString(36)}`;
    }
    const url = baseUrl.trim().replace(/\/$/u, '');
    if (!name.trim()) return setError('渠道名称不能为空');
    if (url && !/^https?:\/\//iu.test(url)) return setError('网关 API 地址必须以 http:// 或 https:// 开头');

    const body: UpsertProviderRequest & { enabled?: boolean } = {
      name: name.trim(),
      baseUrl: url || 'https://api.openai.com/v1',
      api,
      authHeader,
      enabled,
    };
    const key = keyRef.current?.value ?? '';
    if (key) body.apiKey = key;

    setSaving(true);
    setError('');
    try {
      const provider = await upsertProvider(providerId, body, newIdempotencyKey());
      // 同步添加模型 tags
      if (modelTags.length > 0) {
        for (const tag of modelTags) {
          if (!provider.models.some((m) => m.id === tag)) {
            await createManualModel(provider.id, {
              modelId: tag,
              displayName: tag,
              api: provider.api,
              input: ['text'],
              output: ['text'],
              contextWindow: null,
              maxTokens: null,
              enabled: true,
              idempotencyKey: newIdempotencyKey(),
            }).catch(() => null);
          }
        }
      }
      const refreshed = await refreshProvider(provider.id).catch(() => null);
      if (keyRef.current) keyRef.current.value = '';
      onSaved(refreshed?.provider ?? provider);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存渠道失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div
        role="presentation"
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(15, 23, 42, 0.55)',
          backdropFilter: 'blur(4px)',
          zIndex: 1000,
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
            width: 'min(96vw, 1100px)',
            maxHeight: '92vh',
            background: '#ffffff',
            borderRadius: '16px',
            boxShadow: '0 24px 60px rgba(0, 0, 0, 0.2)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* 模态框顶栏 */}
          <div
            style={{
              padding: '16px 24px',
              borderBottom: '1px solid #f1f5f9',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: '#fafcff',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '18px' }}>⚙️</span>
              <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: '#0f172a' }}>
                {initial ? `更新渠道信息 (${initial.name})` : '新建渠道信息'}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                fontSize: '18px',
                color: '#64748b',
                cursor: 'pointer',
                padding: '4px 8px',
                borderRadius: '6px',
              }}
              aria-label="关闭"
            >
              ✕
            </button>
          </div>

          {/* 表单主体：左右双栏布局（左侧高级设置，右侧核心配置） */}
          <form onSubmit={handleSubmit} style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
            {/* 左栏：高级设置 (Image 3 左侧部分) */}
            <div
              style={{
                width: '40%',
                borderRight: '1px solid #f1f5f9',
                padding: '20px 22px',
                overflowY: 'auto',
                background: '#fafbfe',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                <span style={{ fontSize: '15px' }}>高级</span>
                <strong style={{ fontSize: '15px', color: '#1e293b' }}>高级设置</strong>
              </div>
              <p style={{ fontSize: '12px', color: '#64748b', margin: '0 0 16px' }}>渠道的高级配置选项</p>

              <div style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155', marginBottom: '10px' }}>
                上游模型管理
              </div>

              {/* 是否检测上游模型更新 */}
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '13px', fontWeight: 500, color: '#0f172a' }}>
                  <span>是否检测上游模型更新</span>
                  <input
                    type="checkbox"
                    checked={detectUpstreamUpdate}
                    onChange={(e) => setDetectUpstreamUpdate(e.target.checked)}
                    style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                  />
                </label>
                <div style={{ fontSize: '11.5px', color: '#8c9ba5', marginTop: '4px' }}>
                  开启后由后端定时任务检测该渠道上游模型变化
                </div>
              </div>

              {/* 是否自动同步上游模型更新 */}
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '13px', fontWeight: 500, color: '#0f172a' }}>
                  <span>是否自动同步上游模型更新</span>
                  <input
                    type="checkbox"
                    checked={autoSyncUpstreamUpdate}
                    onChange={(e) => setAutoSyncUpstreamUpdate(e.target.checked)}
                    style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                  />
                </label>
                <div style={{ fontSize: '11.5px', color: '#8c9ba5', marginTop: '4px' }}>
                  开启后检测到新增模型会自动加入当前渠道模型列表
                </div>
              </div>

              {/* 已忽略模型 */}
              <div style={{ marginBottom: '18px' }}>
                <label style={{ fontSize: '13px', fontWeight: 500, color: '#0f172a', display: 'block', marginBottom: '6px' }}>
                  已忽略模型
                </label>
                <input
                  type="text"
                  value={ignoredModels}
                  onChange={(e) => setIgnoredModels(e.target.value)}
                  placeholder="例如: gpt-4.1-nano,regex:^claude-.*$,regex:^sora-.*$"
                  style={{
                    width: '100%',
                    height: '34px',
                    padding: '0 10px',
                    borderRadius: '6px',
                    border: '1px solid #dce4ee',
                    fontSize: '12px',
                    boxSizing: 'border-box',
                  }}
                />
                <div style={{ fontSize: '11px', color: '#8c9ba5', marginTop: '4px' }}>
                  支持精确匹配；使用 regex: 开头可按正则匹配。
                </div>
              </div>

              <div style={{ height: '1px', background: '#e2e8f0', margin: '14px 0' }} />

              <div style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155', marginBottom: '10px' }}>
                请求配置
              </div>

              {/* 请求头覆盖 */}
              <div style={{ marginBottom: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <span style={{ fontSize: '12.5px', color: '#334155' }}>请求头覆盖</span>
                  <span style={{ fontSize: '11px', color: '#2563eb', cursor: 'pointer' }} onClick={() => setHeaderOverride('{\n  "User-Agent": "Mozilla/5.0 ...",\n  "Authorization": "Bearer {api_key}"\n}')}>
                    填入模版
                  </span>
                </div>
                <textarea
                  rows={3}
                  value={headerOverride}
                  onChange={(e) => setHeaderOverride(e.target.value)}
                  placeholder={`格式示例:\n{\n  "User-Agent": "Mozilla/5.0 ...",\n  "Authorization": "Bearer {api_key}"\n}`}
                  style={{
                    width: '100%',
                    padding: '8px',
                    borderRadius: '6px',
                    border: '1px solid #dce4ee',
                    fontSize: '11.5px',
                    fontFamily: 'monospace',
                    boxSizing: 'border-box',
                  }}
                />
                <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
                  支持变量：渠道密钥：&#123;api_key&#125;
                </div>
              </div>

              {/* 状态码重写 */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <span style={{ fontSize: '12.5px', color: '#334155' }}>状态码重写</span>
                  <button
                    type="button"
                    onClick={() => setStatusRewrite((prev) => [...prev, { from: '429', to: '503' }])}
                    style={{ fontSize: '11px', color: '#165dff', background: 'none', border: 'none', cursor: 'pointer' }}
                  >
                    + 添加键值对
                  </button>
                </div>
                {statusRewrite.length === 0 ? (
                  <div style={{ padding: '12px', background: '#f1f5f9', borderRadius: '6px', textAlign: 'center', fontSize: '11.5px', color: '#94a3b8' }}>
                    暂无状态码重写规则
                  </div>
                ) : (
                  statusRewrite.map((item, idx) => (
                    <div key={idx} style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '6px' }}>
                      <input
                        value={item.from}
                        onChange={(e) => {
                          const val = e.target.value;
                          setStatusRewrite((prev) => prev.map((r, i) => (i === idx ? { ...r, from: val } : r)));
                        }}
                        placeholder="原状态码"
                        style={{ width: '45%', height: '28px', padding: '0 6px', fontSize: '11.5px' }}
                      />
                      <span>→</span>
                      <input
                        value={item.to}
                        onChange={(e) => {
                          const val = e.target.value;
                          setStatusRewrite((prev) => prev.map((r, i) => (i === idx ? { ...r, to: val } : r)));
                        }}
                        placeholder="覆写状态码"
                        style={{ width: '45%', height: '28px', padding: '0 6px', fontSize: '11.5px' }}
                      />
                      <button
                        type="button"
                        onClick={() => setStatusRewrite((prev) => prev.filter((_, i) => i !== idx))}
                        style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}
                      >
                        ✕
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* 右栏：核心配置 (Image 3 右侧主要表单) */}
            <div
              style={{
                width: '60%',
                padding: '20px 24px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '14px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '16px' }}>🗄️</span>
                <div>
                  <strong style={{ fontSize: '15px', color: '#1e293b' }}>核心配置</strong>
                  <div style={{ fontSize: '11.5px', color: '#64748b' }}>创建渠道所需的基本信息</div>
                </div>
              </div>

              {/* 类型 */}
              <div>
                <label style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a', display: 'block', marginBottom: '5px' }}>
                  类型 <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <select
                  value={channelType}
                  onChange={(e) => {
                    const ct = e.target.value;
                    setChannelType(ct);
                    if (ct === 'Anthropic') setApi('anthropic-messages');
                    else if (ct === 'Gemini') setApi('google-gemini');
                    else setApi('openai-completions');
                  }}
                  style={{
                    width: '100%',
                    height: '38px',
                    padding: '0 10px',
                    borderRadius: '8px',
                    border: '1px solid #dce4ee',
                    fontSize: '13px',
                  }}
                >
                  <option value="OpenAI">OpenAI (Chat Completions)</option>
                  <option value="Gemini">Google Gemini (Native / OpenAI Compatible)</option>
                  <option value="Anthropic">Anthropic (Claude)</option>
                  <option value="Azure">Azure OpenAI</option>
                  <option value="Bailian">阿里百炼 / 通义千问</option>
                  <option value="DeepSeek">DeepSeek 官方渠道</option>
                  <option value="Ollama">Ollama 本地 / 私有化通道</option>
                  <option value="Custom">自定义 NewAPI 兼容代理网关</option>
                </select>
              </div>

              {/* 名称 */}
              <div>
                <label style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a', display: 'block', marginBottom: '5px' }}>
                  名称 <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如: https://new-sub2api.haqiuhaqiu.xyz 或 OpenAI 官方主力"
                  style={{
                    width: '100%',
                    height: '38px',
                    padding: '0 10px',
                    borderRadius: '8px',
                    border: '1px solid #dce4ee',
                    fontSize: '13px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              {/* 密钥 */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>
                    密钥 (编辑模式下，保存的密钥不会显示)
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    style={{ background: 'none', border: 'none', color: '#165dff', fontSize: '12px', cursor: 'pointer' }}
                  >
                    {showKey ? '隐藏密钥' : '查看密钥'}
                  </button>
                </div>
                <input
                  ref={keyRef}
                  type={showKey ? 'text' : 'password'}
                  autoComplete="off"
                  placeholder={
                    initial?.auth?.configured
                      ? `已配置 · 指纹 ${initial.auth.keyFingerprint ?? '不可用'}，留空不修改`
                      : '请输入渠道对应的鉴权密钥 (例如 sk-proj-...)'
                  }
                  style={{
                    width: '100%',
                    height: '38px',
                    padding: '0 10px',
                    borderRadius: '8px',
                    border: '1px solid #dce4ee',
                    fontSize: '13px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              {/* 组织 */}
              <div>
                <label style={{ fontSize: '13px', fontWeight: 500, color: '#0f172a', display: 'block', marginBottom: '5px' }}>
                  组织
                </label>
                <input
                  type="text"
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                  placeholder="请输入组织org-xxx，不填则为默认组织"
                  style={{
                    width: '100%',
                    height: '38px',
                    padding: '0 10px',
                    borderRadius: '8px',
                    border: '1px solid #dce4ee',
                    fontSize: '13px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              {/* API 地址 */}
              <div>
                <label style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a', display: 'block', marginBottom: '5px' }}>
                  API 地址
                </label>
                <input
                  type="url"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://new-sub2api.haqiuhaqiu.xyz/v1"
                  style={{
                    width: '100%',
                    height: '38px',
                    padding: '0 10px',
                    borderRadius: '8px',
                    border: '1px solid #dce4ee',
                    fontSize: '13px',
                    boxSizing: 'border-box',
                  }}
                />
                <div style={{ fontSize: '11px', color: '#8c9ba5', marginTop: '4px' }}>
                  对于官方渠道，new-api 已经内置地址，除非是第三方代理站点或者 Azure 的特殊接入地址，否则不需要填写
                </div>
              </div>

              {/* 模型 Tags 列表 (Image 3 核心亮点) */}
              <div>
                <label style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a', display: 'block', marginBottom: '6px' }}>
                  模型 <span style={{ color: '#ef4444' }}>*</span> ({modelTags.length})
                </label>
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '6px',
                    padding: '8px 10px',
                    border: '1px solid #dce4ee',
                    borderRadius: '8px',
                    minHeight: '44px',
                    background: '#fcfdfd',
                  }}
                >
                  {modelTags.map((tag) => (
                    <span
                      key={tag}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        background: '#eff6ff',
                        color: '#1d4ed8',
                        border: '1px solid #bfdbfe',
                        borderRadius: '6px',
                        padding: '3px 8px',
                        fontSize: '12px',
                        fontWeight: 500,
                      }}
                    >
                      {tag}
                      <button
                        type="button"
                        onClick={() => removeModelTag(tag)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#60a5fa',
                          cursor: 'pointer',
                          padding: 0,
                          fontSize: '13px',
                          lineHeight: 1,
                        }}
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>

                {/* 模型操作按钮栏 */}
                <div style={{ display: 'flex', gap: '8px', marginTop: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => void handleFetchModels()}
                    disabled={fetchingModels}
                    style={{
                      background: '#165dff',
                      border: 'none',
                      color: '#ffffff',
                      fontSize: '12px',
                      fontWeight: 600,
                      padding: '5px 12px',
                      borderRadius: '6px',
                      cursor: 'pointer',
                    }}
                  >
                    {fetchingModels ? '正在获取...' : '⚡ 获取模型'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const allPresets = PRESET_ALL_MODELS.map((m) => m.id);
                      setModelTags(Array.from(new Set([...modelTags, ...allPresets])));
                    }}
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #cbd5e1',
                      color: '#334155',
                      fontSize: '12px',
                      fontWeight: 500,
                      padding: '5px 12px',
                      borderRadius: '6px',
                      cursor: 'pointer',
                    }}
                  >
                    全选模型
                  </button>
                  <button
                    type="button"
                    onClick={() => setModelTags([])}
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #cbd5e1',
                      color: '#dc2626',
                      fontSize: '12px',
                      fontWeight: 500,
                      padding: '5px 12px',
                      borderRadius: '6px',
                      cursor: 'pointer',
                    }}
                  >
                    清除模型
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectModelModalOpen(true)}
                    style={{
                      background: '#eff6ff',
                      border: '1px solid #bfdbfe',
                      color: '#1d4ed8',
                      fontSize: '12px',
                      fontWeight: 600,
                      padding: '5px 12px',
                      borderRadius: '6px',
                      cursor: 'pointer',
                    }}
                  >
                    🔍 选择模型
                  </button>
                  <button
                    type="button"
                    onClick={() => setTestModalOpen(true)}
                    disabled={modelTags.length === 0}
                    style={{
                      background: '#ecfdf5',
                      border: '1px solid #a7f3d0',
                      color: '#047857',
                      fontSize: '12px',
                      fontWeight: 600,
                      padding: '5px 12px',
                      borderRadius: '6px',
                      cursor: modelTags.length === 0 ? 'not-allowed' : 'pointer',
                      opacity: modelTags.length === 0 ? 0.6 : 1,
                    }}
                  >
                    🧪 模型测试
                  </button>
                </div>
              </div>

              {/* 自定义模型名称 */}
              <div>
                <label style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a', display: 'block', marginBottom: '5px' }}>
                  自定义模型名称
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    value={customModelInput}
                    onChange={(e) => setCustomModelInput(e.target.value)}
                    placeholder="输入自定义模型名称"
                    style={{
                      flex: 1,
                      height: '36px',
                      padding: '0 10px',
                      borderRadius: '6px',
                      border: '1px solid #dce4ee',
                      fontSize: '13px',
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleAddCustomModel}
                    className="settings-action-btn"
                    style={{ minWidth: '60px' }}
                  >
                    填入
                  </button>
                </div>
              </div>

              {error ? (
                <div style={{ padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', color: '#dc2626', fontSize: '12.5px' }}>
                  ⚠️ {error}
                </div>
              ) : null}

              {/* 提交 / 取消按钮 */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                <button
                  type="submit"
                  disabled={saving}
                  style={{
                    background: '#165dff',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '8px 20px',
                    fontSize: '13.5px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {saving ? '保存中…' : '提交'}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  style={{
                    background: '#ffffff',
                    color: '#475569',
                    border: '1px solid #cbd5e1',
                    borderRadius: '8px',
                    padding: '8px 18px',
                    fontSize: '13.5px',
                    cursor: 'pointer',
                  }}
                >
                  取消
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>

      {/* 嵌入的 Image 4 选择模型弹窗 */}
      <SelectModelModal
        isOpen={selectModelModalOpen}
        onClose={() => setSelectModelModalOpen(false)}
        currentModelIds={modelTags}
        candidateModels={initial?.models ?? []}
        onConfirm={(newSelectedIds) => {
          setModelTags(newSelectedIds);
        }}
      />

      {/* 渠道模型测试模态弹窗 */}
      {testModalOpen && (
        <ModelChannelTestModal
          isOpen={testModalOpen}
          onClose={() => setTestModalOpen(false)}
          channelName={name || '新建渠道'}
          baseUrl={baseUrl}
          apiKey={keyRef.current?.value || ''}
          api={api}
          providerId={initial && !isCopy ? initial.id : undefined}
          models={modelTags}
        />
      )}
    </>
  );
}

/* ========================================================================= */
/* 4. 模型快速单项映射表单                                                   */
/* ========================================================================= */
function ModelQuickAdd({ provider, onAdded }: { provider: ProviderConfigPublic; onAdded: (provider: ProviderConfigPublic) => void }) {
  const [modelId, setModelId] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!modelId.trim() || !name.trim()) {
      setError('模型 ID 和展示名不能为空');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await createManualModel(provider.id, {
        modelId: modelId.trim(),
        displayName: name.trim(),
        api: provider.api,
        input: ['text'],
        output: ['text'],
        contextWindow: null,
        maxTokens: null,
        enabled: true,
        idempotencyKey: newIdempotencyKey(),
      });
      const refreshed = await refreshProvider(provider.id).catch(() => null);
      onAdded(refreshed?.provider ?? provider);
      setModelId('');
      setName('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '模型添加失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="provider-model-add" onSubmit={submit} style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '12px' }}>
      <input
        value={modelId}
        onChange={(event) => setModelId(event.target.value)}
        placeholder="上游模型 ID (如 gpt-5.6-sol)"
        style={{ height: '32px', padding: '0 8px', borderRadius: '6px', border: '1px solid #dce4ee', fontSize: '12px' }}
      />
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="展示名"
        style={{ height: '32px', padding: '0 8px', borderRadius: '6px', border: '1px solid #dce4ee', fontSize: '12px' }}
      />
      <button type="submit" className="settings-pill-btn" disabled={saving}>
        {saving ? '添加中…' : '填入模型'}
      </button>
      {error ? <small className="qitu-field-error">{error}</small> : null}
    </form>
  );
}

/* ========================================================================= */
/* 5. 主页面：两级模型管理架构 (通道管理 + 二级模型展开选择增删)                */
/* ========================================================================= */
export default function AdminModelPage() {
  const [data, setData] = useState<AdminProvidersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | 'enabled' | 'disabled' | 'error'>('all');
  const [apiFilter, setApiFilter] = useState<'all' | ModelApi>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ initial?: ProviderConfigPublic; preset?: ProviderPreset; isCopy?: boolean } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkSaving, setBulkSaving] = useState(false);
  const [testState, setTestState] = useState<Record<string, string>>({});
  const [testingProvider, setTestingProvider] = useState<ProviderConfigPublic | null>(null);
  const [selectedModels, setSelectedModels] = useState<Record<string, Set<string>>>({});

  // 针对特定展开通道的模型选择弹窗
  const [batchSelectProvider, setBatchSelectProvider] = useState<ProviderConfigPublic | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchProviders());
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('供应商加载失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const providers = useMemo(
    () =>
      (data?.providers ?? []).filter((provider) => {
        const q = query.trim().toLowerCase();
        const matchesQuery =
          !q ||
          [provider.id, provider.name, provider.baseUrl, provider.api, ...provider.models.map((model) => model.id)]
            .join(' ')
            .toLowerCase()
            .includes(q);
        const matchesStatus =
          status === 'all' ||
          (status === 'enabled' && provider.enabled) ||
          (status === 'disabled' && !provider.enabled) ||
          (status === 'error' && Boolean(provider.lastError));
        return matchesQuery && matchesStatus && (apiFilter === 'all' || provider.api === apiFilter);
      }),
    [data, query, status, apiFilter]
  );

  function replaceProvider(provider: ProviderConfigPublic) {
    setData((current) =>
      current
        ? {
            ...current,
            providers: current.providers.map((item) => (item.id === provider.id ? provider : item)),
          }
        : current
    );
  }

  async function runProviderTest(provider: ProviderConfigPublic) {
    setTestState((current) => ({ ...current, [provider.id]: '正在请求真实网关…' }));
    try {
      const result = await testProviderConnection(provider.id);
      setTestState((current) => ({
        ...current,
        [provider.id]: result.ok
          ? `连接通过${result.latencyMs ? ` · ${result.latencyMs} ms` : ''}`
          : result.error ?? '连接未通过',
      }));
    } catch (cause) {
      setTestState((current) => ({
        ...current,
        [provider.id]: cause instanceof Error ? cause.message : '测试失败',
      }));
    }
  }

  async function refresh(provider: ProviderConfigPublic) {
    setTestState((current) => ({ ...current, [provider.id]: '正在从 /models 同步…' }));
    try {
      const result = await refreshProvider(provider.id);
      replaceProvider(result.provider);
      setTestState((current) => ({
        ...current,
        [provider.id]: `已同步 ${result.fetched} 个模型`,
      }));
    } catch (cause) {
      setTestState((current) => ({
        ...current,
        [provider.id]: cause instanceof Error ? cause.message : '同步失败',
      }));
    }
  }

  async function refreshAll() {
    if (!data?.providers.length) return;
    for (const p of data.providers) {
      if (p.enabled && p.auth.configured) {
        void refresh(p);
      }
    }
  }

  async function bulkSetEnabled(enabled: boolean) {
    if (selected.size === 0) return;
    setBulkSaving(true);
    try {
      await Promise.all(
        [...selected].map(async (id) => {
          const provider = data?.providers.find((item) => item.id === id);
          if (!provider) return;
          const updated = await upsertProvider(
            provider.id,
            {
              name: provider.name,
              baseUrl: provider.baseUrl,
              api: provider.api,
              authHeader: provider.authHeader,
              enabled,
            } as UpsertProviderRequest,
            newIdempotencyKey()
          );
          replaceProvider(updated);
        })
      );
      setSelected(new Set());
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('批量更新失败'));
    } finally {
      setBulkSaving(false);
    }
  }

  async function bulkDeleteProviders() {
    if (selected.size === 0) return;
    if (!confirm(`确定要批量删除选中的 ${selected.size} 个模型通道吗？此操作不可逆。`)) return;
    setBulkSaving(true);
    try {
      await Promise.all(
        [...selected].map(async (id) => {
          await deleteProvider(id, newIdempotencyKey()).catch(() => null);
        })
      );
      setData((current) =>
        current
          ? {
              ...current,
              providers: current.providers.filter((item) => !selected.has(item.id)),
            }
          : current
      );
      setSelected(new Set());
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('批量删除通道失败'));
    } finally {
      setBulkSaving(false);
    }
  }

  async function handleBulkDeleteModels(provider: ProviderConfigPublic) {
    const pSelected = selectedModels[provider.id] || new Set();
    if (pSelected.size === 0) return;
    if (!confirm(`确定要从通道「${provider.name}」中批量移除选中的 ${pSelected.size} 个模型吗？`)) return;
    try {
      for (const mId of pSelected) {
        await deleteManualModel(provider.id, mId, newIdempotencyKey()).catch(() => null);
      }
      const refreshed = await refreshProvider(provider.id).catch(() => null);
      replaceProvider(
        refreshed?.provider ?? {
          ...provider,
          models: provider.models.filter((m) => !pSelected.has(m.id)),
        }
      );
      setSelectedModels((prev) => ({ ...prev, [provider.id]: new Set() }));
    } catch (err) {
      alert('批量删除模型失败: ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  async function handleDeleteProvider(provider: ProviderConfigPublic) {
    if (!confirm(`确定要删除模型通道「${provider.name}」(${provider.id}) 吗？`)) return;
    try {
      await deleteProvider(provider.id, newIdempotencyKey());
      setData((current) =>
        current
          ? {
              ...current,
              providers: current.providers.filter((item) => item.id !== provider.id),
            }
          : current
      );
    } catch (cause) {
      alert(cause instanceof Error ? cause.message : '删除通道失败');
    }
  }

  async function handleDeleteModel(provider: ProviderConfigPublic, modelId: string) {
    if (!confirm(`确定要从通道「${provider.name}」中移除模型「${modelId}」吗？`)) return;
    try {
      await deleteManualModel(provider.id, modelId, newIdempotencyKey());
      const refreshed = await refreshProvider(provider.id).catch(() => null);
      replaceProvider(
        refreshed?.provider ?? {
          ...provider,
          models: provider.models.filter((m) => m.id !== modelId),
        }
      );
    } catch (cause) {
      alert(cause instanceof Error ? cause.message : '删除模型失败');
    }
  }

  // 批量应用从“选择模型”弹窗中选中的模型
  async function handleApplyBatchModels(provider: ProviderConfigPublic, selectedModelIds: string[]) {
    try {
      for (const mId of selectedModelIds) {
        if (!provider.models.some((m) => m.id === mId)) {
          await createManualModel(provider.id, {
            modelId: mId,
            displayName: mId,
            api: provider.api,
            input: ['text'],
            output: ['text'],
            contextWindow: null,
            maxTokens: null,
            enabled: true,
            idempotencyKey: newIdempotencyKey(),
          }).catch(() => null);
        }
      }
      const refreshed = await refreshProvider(provider.id).catch(() => null);
      if (refreshed?.provider) {
        replaceProvider(refreshed.provider);
      }
    } catch (err) {
      alert('批量添加模型失败: ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  const stateView = AdminStateViews({ loading, error, onRetry: load });
  if (stateView) return <div className="admin-settings-page">{stateView}</div>;
  if (!data) return null;
  const allSelected = providers.length > 0 && providers.every((provider) => selected.has(provider.id));

  return (
    <div className="admin-settings-page">
      {/* 页头 */}
      <div className="admin-page-header">
        <div className="admin-page-header-title">
          <div>
            <h1>模型通道与供应商（两级架构）</h1>
            <p>
              <strong>第一级：模型通道管理</strong>（集中配置 API 密钥、网关协议与连通性检测）；
              <strong>第二级：模型选择与增删</strong>（支持从上游获取模型列表批量多选、分类折叠与手动增删）。
            </p>
          </div>
        </div>
        <div className="admin-page-header-actions" style={{ display: 'flex', gap: '8px' }}>
          <button type="button" className="settings-action-btn" onClick={() => void refreshAll()}>
            🔄 同步全部上游 /models
          </button>
          <button type="button" className="settings-action-btn is-primary" onClick={() => setEditing({})}>
            + 新建通道
          </button>
        </div>
      </div>

      {/* 统计指标卡片 */}
      <div className="provider-stats">
        <div>
          <strong>{data.providers.length}</strong>
          <span>总通道数</span>
        </div>
        <div>
          <strong>{data.providers.filter((provider) => provider.enabled).length}</strong>
          <span>已启用通道</span>
        </div>
        <div>
          <strong>{data.providers.reduce((count, provider) => count + provider.models.length, 0)}</strong>
          <span>可调用模型</span>
        </div>
        <div>
          <strong>{data.providers.filter((provider) => provider.lastError).length}</strong>
          <span>同步异常</span>
        </div>
      </div>

      {/* 筛选与批量操作工具栏 */}
      <div className="provider-toolbar">
        <input
          className="admin-search-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索通道 ID、名称、网关或模型"
        />
        <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
          <option value="all">全部通道状态</option>
          <option value="enabled">运行中通道</option>
          <option value="disabled">已停用通道</option>
          <option value="error">异常通道</option>
        </select>
        <select value={apiFilter} onChange={(event) => setApiFilter(event.target.value as typeof apiFilter)}>
          <option value="all">全部协议</option>
          {API_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {selected.size > 0 ? (
          <>
            <button type="button" className="settings-pill-btn" disabled={bulkSaving} onClick={() => void bulkSetEnabled(true)}>
              批量启用
            </button>
            <button type="button" className="settings-pill-btn" disabled={bulkSaving} onClick={() => void bulkSetEnabled(false)}>
              批量停用
            </button>
            <button type="button" className="settings-pill-btn" style={{ color: '#ef4444' }} disabled={bulkSaving} onClick={() => void bulkDeleteProviders()}>
              批量删除
            </button>
          </>
        ) : null}
      </div>

      {/* 第一级：通道表格 */}
      {providers.length === 0 ? (
        <div className="admin-empty-state">没有符合筛选条件的模型通道。你可以新建一个 OpenAI-compatible / NewAPI 网关通道。</div>
      ) : (
        <div className="admin-data-table admin-table-compact provider-table">
          <table>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={(event) =>
                      setSelected(event.target.checked ? new Set(providers.map((p) => p.id)) : new Set())
                    }
                    aria-label="全选通道"
                  />
                </th>
                <th>通道名称</th>
                <th>网关地址</th>
                <th>协议</th>
                <th>状态</th>
                <th>已挂载模型</th>
                <th>最近同步</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((provider) => {
                const isRowExpanded = expanded === provider.id;
                return (
                  <Fragment key={provider.id}>
                    <tr className={isRowExpanded ? 'is-expanded' : ''}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.has(provider.id)}
                          onChange={(event) =>
                            setSelected((current) => {
                              const next = new Set(current);
                              if (event.target.checked) next.add(provider.id);
                              else next.delete(provider.id);
                              return next;
                            })
                          }
                          aria-label={`选择 ${provider.name}`}
                        />
                      </td>
                      <td>
                        <div className="provider-name-cell">
                          <span className="provider-logo">{provider.name.slice(0, 1).toUpperCase()}</span>
                          <div>
                            <strong>{provider.name}</strong>
                            <code>{provider.id}</code>
                          </div>
                        </div>
                      </td>
                      <td>
                        <code className="provider-url">{provider.baseUrl}</code>
                      </td>
                      <td>
                        <span className="protocol-chip">
                          {provider.api.replace('openai-', '').replace('anthropic-', 'Anthropic ')}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`runtime-status ${
                            provider.enabled && provider.auth.configured
                              ? 'is-ready'
                              : provider.enabled
                              ? 'is-warning'
                              : 'is-off'
                          }`}
                        >
                          {provider.enabled
                            ? provider.auth.configured
                              ? '就绪'
                              : '缺少密钥'
                            : '已停用'}
                        </span>
                        {provider.lastError ? (
                          <small className="provider-error-dot" title={provider.lastError}>
                            同步异常
                          </small>
                        ) : null}
                      </td>
                      <td>
                        <strong>{provider.models.length}</strong> <span className="provider-muted">个模型</span>
                      </td>
                      <td>{formatTime(provider.modelsFetchedAt)}</td>
                      <td>
                        <div className="runtime-actions">
                          <button
                            type="button"
                            className="settings-pill-btn"
                            style={{
                              background: isRowExpanded ? '#eff6ff' : '#ffffff',
                              borderColor: isRowExpanded ? '#3b82f6' : '#dce4ee',
                              color: isRowExpanded ? '#1d4ed8' : '#334155',
                              fontWeight: isRowExpanded ? 600 : 400,
                            }}
                            onClick={() => setExpanded(isRowExpanded ? null : provider.id)}
                          >
                            {isRowExpanded ? '▲ 收起模型' : '▼ 二级展开 (模型管理)'}
                          </button>
                          <button
                            type="button"
                            className="settings-pill-btn"
                            onClick={() => setEditing({ initial: provider })}
                          >
                            配置通道
                          </button>
                          <button
                            type="button"
                            className="settings-pill-btn"
                            onClick={() => setEditing({ initial: provider, isCopy: true })}
                            title="复制已有配置并新建通道"
                          >
                            复制通道
                          </button>
                          <button
                            type="button"
                            className="settings-pill-btn"
                            style={{ color: '#0284c7' }}
                            onClick={() => setTestingProvider(provider)}
                            title="测试该渠道当前挂载的模型"
                          >
                            测试模型
                          </button>
                          <button
                            type="button"
                            className="settings-pill-btn"
                            style={{ color: '#ef4444' }}
                            onClick={() => void handleDeleteProvider(provider)}
                          >
                            删除通道
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* 第二级：二级展开（模型分类选择与增删） */}
                    {isRowExpanded ? (
                      <tr>
                        <td colSpan={8} style={{ padding: 0 }}>
                          <div
                            style={{
                              background: '#f8fafc',
                              borderTop: '1px solid #e2e8f0',
                              borderBottom: '1px solid #e2e8f0',
                              padding: '18px 24px',
                            }}
                          >
                            {/* 二级头部 */}
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                flexWrap: 'wrap',
                                gap: '10px',
                                marginBottom: '14px',
                                paddingBottom: '12px',
                                borderBottom: '1px dashed #cbd5e1',
                              }}
                            >
                              <div>
                                <strong style={{ fontSize: '14.5px', color: '#0f172a' }}>
                                  【{provider.name}】挂载模型目录 ({provider.models.length})
                                </strong>
                                <span style={{ fontSize: '12px', color: '#64748b', marginLeft: '10px' }}>
                                  {provider.auth.configured
                                    ? `密钥就绪 · 指纹 ${provider.auth.keyFingerprint ?? '可用'}`
                                    : '未配置鉴权密钥'}
                                </span>
                              </div>
                              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                <button
                                  type="button"
                                  className="settings-pill-btn"
                                  style={{ background: '#165dff', color: '#fff', borderColor: '#165dff', fontWeight: 600 }}
                                  onClick={() => setBatchSelectProvider(provider)}
                                >
                                  🔍 获取模型列表 (批量勾选)
                                </button>
                                <button
                                  type="button"
                                  className="settings-pill-btn"
                                  onClick={() => {
                                    const all = new Set(provider.models.map((m) => m.id));
                                    setSelectedModels((prev) => ({ ...prev, [provider.id]: all }));
                                  }}
                                >
                                  全选模型
                                </button>
                                <button
                                  type="button"
                                  className="settings-pill-btn"
                                  onClick={() => {
                                    setSelectedModels((prev) => ({ ...prev, [provider.id]: new Set() }));
                                  }}
                                >
                                  清除已选
                                </button>
                                {(selectedModels[provider.id]?.size ?? 0) > 0 && (
                                  <button
                                    type="button"
                                    className="settings-pill-btn"
                                    style={{ color: '#ef4444', borderColor: '#fecaca', background: '#fef2f2', fontWeight: 600 }}
                                    onClick={() => void handleBulkDeleteModels(provider)}
                                  >
                                    批量删除选中模型 ({selectedModels[provider.id]?.size})
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="settings-pill-btn"
                                  style={{ color: '#0284c7' }}
                                  onClick={() => setTestingProvider(provider)}
                                >
                                  🧪 测试模型
                                </button>
                                <button
                                  type="button"
                                  className="settings-pill-btn"
                                  onClick={() => void refresh(provider)}
                                >
                                  🔄 同步上游模型
                                </button>
                                <button
                                  type="button"
                                  className="settings-pill-btn"
                                  onClick={() => void runProviderTest(provider)}
                                >
                                  ⚡ 探测网关
                                </button>
                              </div>
                            </div>

                            {testState[provider.id] ? (
                              <p className="runtime-test-message" style={{ margin: '0 0 10px', color: '#0284c7' }}>
                                {testState[provider.id]}
                              </p>
                            ) : null}

                            {/* 模型列表：卡片式多栏网格 */}
                            {provider.models.length === 0 ? (
                              <p className="provider-muted">
                                尚未登记模型。请点击右上角「获取模型列表」或输入自定义模型进行快速挂载。
                              </p>
                            ) : (
                              <div
                                style={{
                                  display: 'grid',
                                  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                                  gap: '10px',
                                  marginBottom: '14px',
                                }}
                              >
                                {provider.models.map((model: ModelDescriptor) => {
                                  const group = classifyModelGroup(model.id);
                                  const isModelChecked = selectedModels[provider.id]?.has(model.id) ?? false;
                                  return (
                                    <div
                                      key={model.id}
                                      style={{
                                        padding: '10px 12px',
                                        background: '#ffffff',
                                        borderRadius: '8px',
                                        border: '1px solid #e2e8f0',
                                        boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        justifyContent: 'space-between',
                                      }}
                                    >
                                      <div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                                            <input
                                              type="checkbox"
                                              checked={isModelChecked}
                                              onChange={(e) => {
                                                const next = new Set(selectedModels[provider.id] || []);
                                                if (e.target.checked) next.add(model.id);
                                                else next.delete(model.id);
                                                setSelectedModels((prev) => ({ ...prev, [provider.id]: next }));
                                              }}
                                              style={{ width: '15px', height: '15px', cursor: 'pointer' }}
                                            />
                                            <strong style={{ fontSize: '13px', color: '#1e293b' }}>
                                              {model.name || model.id}
                                            </strong>
                                          </label>
                                          <span
                                            style={{
                                              fontSize: '10.5px',
                                              padding: '1px 6px',
                                              borderRadius: '4px',
                                              background: group === 'OpenAI' ? '#eff6ff' : '#f1f5f9',
                                              color: group === 'OpenAI' ? '#2563eb' : '#64748b',
                                            }}
                                          >
                                            {group}
                                          </span>
                                        </div>
                                        <code
                                          style={{
                                            fontSize: '11px',
                                            color: '#64748b',
                                            display: 'block',
                                            marginTop: '3px',
                                          }}
                                        >
                                          {model.id}
                                        </code>
                                      </div>

                                      <div
                                        style={{
                                          display: 'flex',
                                          justifyContent: 'space-between',
                                          alignItems: 'center',
                                          marginTop: '10px',
                                          paddingTop: '8px',
                                          borderTop: '1px solid #f1f5f9',
                                        }}
                                      >
                                        <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                                          {model.source === 'manual' ? '手动映射' : '上游同步'}
                                        </span>
                                        <div style={{ display: 'flex', gap: '6px' }}>
                                          <button
                                            type="button"
                                            className="settings-pill-btn"
                                            style={{ fontSize: '11px', padding: '2px 8px' }}
                                            onClick={() =>
                                              void testModelConnection(provider.id, model.id)
                                                .then((result: ConnectionTestResponse) =>
                                                  setTestState((cur) => ({
                                                    ...cur,
                                                    [provider.id]: result.ok
                                                      ? `${model.id} 连接通过`
                                                      : result.error ?? `${model.id} 未通过`,
                                                  }))
                                                )
                                                .catch((cause) =>
                                                  setTestState((cur) => ({
                                                    ...cur,
                                                    [provider.id]:
                                                      cause instanceof Error ? cause.message : '模型测试失败',
                                                  }))
                                                )
                                            }
                                          >
                                            测速
                                          </button>
                                          <button
                                            type="button"
                                            className="settings-pill-btn"
                                            style={{ fontSize: '11px', padding: '2px 8px', color: '#ef4444' }}
                                            onClick={() => void handleDeleteModel(provider, model.id)}
                                          >
                                            移除
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            {/* 快速单条添加模型 */}
                            <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '10px' }}>
                              <ModelQuickAdd provider={provider} onAdded={replaceProvider} />
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 用途路由面板 */}
      <UsageRoutingPanel providers={data.providers} />

      {/* 预设通道模板 */}
      <section className="provider-presets">
        <div className="runtime-section-head">
          <h2>常用通道模板</h2>
          <span>快速预填主流大模型及聚合代理网关地址。</span>
        </div>
        <div className="provider-preset-grid">
          {data.presets.map((preset) => (
            <button
              type="button"
              className="provider-preset"
              key={preset.id}
              onClick={() => setEditing({ preset })}
            >
              <strong>{preset.name}</strong>
              <code>{preset.id}</code>
              <span>{preset.baseUrl}</span>
              <small>
                {preset.suggestedModels.length} 个推荐模型 · {preset.api}
              </small>
            </button>
          ))}
        </div>
      </section>

      {/* 渠道信息编辑模态框 (Image 3) */}
      {editing ? (
        <ChannelEditorModal
          initial={editing.initial}
          preset={editing.preset}
          isCopy={editing.isCopy}
          onSaved={(provider) => {
            replaceProvider(provider);
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {/* 列表页二级展开直接触发的“选择模型”模态框 (Image 4) */}
      {batchSelectProvider ? (
        <SelectModelModal
          isOpen={Boolean(batchSelectProvider)}
          onClose={() => setBatchSelectProvider(null)}
          currentModelIds={batchSelectProvider.models.map((m) => m.id)}
          candidateModels={batchSelectProvider.models}
          onConfirm={(selectedModelIds) => {
            void handleApplyBatchModels(batchSelectProvider, selectedModelIds);
          }}
        />
      ) : null}

      {/* 渠道模型测试模态弹窗 */}
      {testingProvider ? (
        <ModelChannelTestModal
          isOpen={Boolean(testingProvider)}
          onClose={() => setTestingProvider(null)}
          channelName={testingProvider.name}
          baseUrl={testingProvider.baseUrl}
          api={testingProvider.api}
          providerId={testingProvider.id}
          models={testingProvider.models.map((m) => m.id)}
        />
      ) : null}
    </div>
  );
}
