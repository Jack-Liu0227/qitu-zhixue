'use client';

import { useRef, useState, type FormEvent } from 'react';
import type {
  ModelApi,
  ModelDescriptor,
  ProviderConfigPublic,
  ProviderPreset,
  UpsertProviderRequest,
} from '@qitu/contracts';
import {
  discoverProviderModels,
  newIdempotencyKey,
  probeModels,
  setProviderModels,
  upsertProvider,
} from '../../../../../lib/api/modelRegistry';
import { ModelChannelTestModal } from './ModelChannelTestModal';
import { SelectModelModal } from './SelectModelModal';
import { API_OPTIONS } from './types';

export interface ChannelEditorModalProps {
  initial?: ProviderConfigPublic;
  preset?: ProviderPreset;
  isCopy?: boolean;
  onSaved: (provider: ProviderConfigPublic) => void;
  onClose: () => void;
}

export function ChannelEditorModal({ initial, preset, isCopy, onSaved, onClose }: ChannelEditorModalProps) {
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

  const [modelTags, setModelTags] = useState<string[]>(() => {
    if (initial?.models?.length) return initial.models.map((model) => model.id);
    if (preset?.suggestedModels?.length) return preset.suggestedModels.map((model) => model.id);
    return [];
  });

  const [customModelInput, setCustomModelInput] = useState('');
  const [fetchingModels, setFetchingModels] = useState(false);
  const [testModalOpen, setTestModalOpen] = useState(false);

  const [candidateModels, setCandidateModels] = useState<Array<{ id: string; name?: string }>>(() => {
    if (initial?.models?.length) return initial.models.map((model) => ({ id: model.id, name: model.name }));
    return (preset?.suggestedModels ?? []).map((model) => ({ id: model.id, name: model.name }));
  });

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

  const handleFetchModels = async (): Promise<string[]> => {
    const url = baseUrl.trim().replace(/\/$/u, '');
    const key = keyRef.current?.value || '';
    setError('');
    if (!url) {
      setError('请先填写网关 API 地址，再获取模型');
      return [];
    }
    setFetchingModels(true);
    try {
      let models: ModelDescriptor[];
      if (initial?.id && !isCopy) {
        const res = await discoverProviderModels(initial.id);
        if (!res.ok) {
          setError(`获取模型失败：${res.error ?? '上游未返回模型列表'}`);
          return [];
        }
        models = res.models;
      } else {
        const res = await probeModels({
          baseUrl: url,
          api,
          apiKey: key || undefined,
          authHeader,
        });
        if (!res.ok) {
          setError(`获取模型失败：${res.error ?? '上游未返回模型列表'}`);
          return [];
        }
        models = res.models;
      }
      if (models.length === 0) {
        setError('上游返回了空的模型列表，请检查网关地址与密钥后重试');
        return [];
      }
      const ids = models.map((m) => m.id);
      setCandidateModels((prev) => {
        const map = new Map(prev.map((m) => [m.id, m]));
        for (const m of models) map.set(m.id, { id: m.id, name: m.name });
        return Array.from(map.values());
      });
      return ids;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '获取模型失败');
      return [];
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
      baseUrl: url || (api === 'google-gemini'
        ? 'https://generativelanguage.googleapis.com'
        : api === 'anthropic-messages'
          ? 'https://api.anthropic.com'
          : 'https://api.openai.com'),
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
      const catalog = new Map<string, ModelDescriptor>([
        ...candidateModels.map((model) => [model.id, {
          id: model.id,
          name: model.name ?? model.id,
          api: provider.api,
          input: ['text'],
          output: ['text'],
          contextWindow: null,
          maxTokens: null,
          source: 'fetched',
        } satisfies ModelDescriptor] as const),
        ...provider.models.map((model: ModelDescriptor) => [model.id, model] as const),
      ]);
      const selected = modelTags.map((modelId) => {
        const model = catalog.get(modelId);
        return {
          modelId,
          displayName: model?.name ?? modelId,
          input: model?.input ?? ['text'],
          output: model?.output ?? ['text'],
          contextWindow: model?.contextWindow ?? null,
          maxTokens: model?.maxTokens ?? null,
          source: model === undefined || model.source === 'manual' ? 'manual' as const : 'remote' as const,
        };
      });
      const savedProvider = (await setProviderModels(provider.id, { models: selected }, newIdempotencyKey())).provider;
      if (keyRef.current) keyRef.current.value = '';
      onSaved(savedProvider);
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

          {/* 表单主体：左右双栏布局 */}
          <form onSubmit={handleSubmit} style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
            {/* 左栏：高级设置 */}
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

            {/* 右栏：核心配置 */}
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

              {/* 协议 */}
              <div>
                <label style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a', display: 'block', marginBottom: '5px' }}>
                  协议 <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <select
                  value={api}
                  onChange={(e) => setApi(e.target.value as ModelApi)}
                  style={{ width: '100%', height: '38px', padding: '0 10px', borderRadius: '8px', border: '1px solid #dce4ee', fontSize: '13px' }}
                >
                  {API_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <small style={{ display: 'block', marginTop: '5px', color: '#64748b', fontSize: '11.5px' }}>
                  Gemini 使用原生 v1beta 协议；OpenAI 兼容网关请选择 Completions 或 Responses。
                </small>
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
                  placeholder="例如: SiliconFlow 网关 或 OpenAI 官方主力"
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
                  placeholder="https://api.openai.com/v1"
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

              {/* 模型 Tags 列表 */}
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
                    onClick={() => setSelectModelModalOpen(true)}
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
                    获取模型列表并选择
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setModelTags((prev) =>
                        Array.from(new Set([...prev, ...candidateModels.map((m) => m.id)])),
                      );
                    }}
                    disabled={candidateModels.length === 0}
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #cbd5e1',
                      color: '#334155',
                      fontSize: '12px',
                      fontWeight: 500,
                      padding: '5px 12px',
                      borderRadius: '6px',
                      cursor: candidateModels.length === 0 ? 'not-allowed' : 'pointer',
                      opacity: candidateModels.length === 0 ? 0.6 : 1,
                    }}
                  >
                    全选候选模型
                  </button>
                  <button
                    type="button"
                    disabled={modelTags.length === 0}
                    onClick={() => setModelTags([])}
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #cbd5e1',
                      color: '#dc2626',
                      fontSize: '12px',
                      fontWeight: 500,
                      padding: '5px 12px',
                      borderRadius: '6px',
                      cursor: modelTags.length === 0 ? 'not-allowed' : 'pointer',
                      opacity: modelTags.length === 0 ? 0.6 : 1,
                    }}
                  >
                    清除所有模型
                  </button>
                  <span style={{ padding: '5px 4px', color: '#475569', fontSize: '12px' }}>
                    已选 {modelTags.length} 个模型
                  </span>
                  <button
                    type="button"
                    onClick={() => setTestModalOpen(true)}
                    disabled={modelTags.length === 0 || !initial || isCopy}
                    style={{
                      background: '#ecfdf5',
                      border: '1px solid #a7f3d0',
                      color: '#047857',
                      fontSize: '12px',
                      fontWeight: 600,
                      padding: '5px 12px',
                      borderRadius: '6px',
                      cursor: modelTags.length === 0 || !initial || isCopy ? 'not-allowed' : 'pointer',
                      opacity: modelTags.length === 0 || !initial || isCopy ? 0.6 : 1,
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

      {/* 嵌入的选择模型弹窗 */}
      <SelectModelModal
        isOpen={selectModelModalOpen}
        onClose={() => setSelectModelModalOpen(false)}
        currentModelIds={modelTags}
        candidateModels={candidateModels}
        onConfirm={(newSelectedIds) => {
          setModelTags(newSelectedIds);
        }}
        onFetchModels={handleFetchModels}
        providerId={initial && !isCopy ? initial.id : undefined}
        channelName={name || initial?.name || '通道模型测试'}
        baseUrl={baseUrl || initial?.baseUrl || ''}
        apiKey={keyRef.current?.value || ''}
        api={api || initial?.api || 'openai-completions'}
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
