'use client';

import { useState } from 'react';
import type { ConnectionTestResponse, ModelDescriptor, ProviderConfigPublic } from '@qitu/contracts';
import {
  newIdempotencyKey,
  setProviderModels,
  testModelConnection,
  testProviderConnection,
} from '../../../../../lib/api/modelRegistry';
import { ModelQuickAdd } from './ModelQuickAdd';
import { classifyModelGroup } from './types';

export interface ChannelModelsDrawerProps {
  provider: ProviderConfigPublic | null;
  onClose: () => void;
  onUpdated: (provider: ProviderConfigPublic) => void;
  onOpenSelectModal: (provider: ProviderConfigPublic) => void;
  onOpenTestModal: (provider: ProviderConfigPublic) => void;
}

export function ChannelModelsDrawer({
  provider,
  onClose,
  onUpdated,
  onOpenSelectModal,
  onOpenTestModal,
}: ChannelModelsDrawerProps) {
  const [selectedModelIds, setSelectedModelIds] = useState<Set<string>>(new Set());
  const [testState, setTestState] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  if (!provider) return null;

  async function runProviderTest() {
    if (!provider) return;
    setTestState((cur) => ({ ...cur, [provider.id]: '正在探测网关连通性…' }));
    try {
      const result = await testProviderConnection(provider.id);
      setTestState((cur) => ({
        ...cur,
        [provider.id]: result.ok
          ? `网关连接通过${result.latencyMs ? ` · ${result.latencyMs} ms` : ''}`
          : result.error ?? '网关连接未通过',
      }));
    } catch (cause) {
      setTestState((cur) => ({
        ...cur,
        [provider.id]: cause instanceof Error ? cause.message : '探测网关失败',
      }));
    }
  }

  async function handleDeleteModel(modelId: string) {
    if (!provider) return;
    if (!confirm(`确定要从通道「${provider.name}」中移除模型「${modelId}」吗？`)) return;
    try {
      const models = provider.models
        .filter((model) => model.id !== modelId)
        .map((model) => ({
          modelId: model.id,
          displayName: model.name,
          input: model.input,
          output: model.output,
          contextWindow: model.contextWindow,
          maxTokens: model.maxTokens,
          source: model.source === 'manual' ? ('manual' as const) : ('remote' as const),
        }));
      const result = await setProviderModels(provider.id, { models }, newIdempotencyKey());
      onUpdated(result.provider);
    } catch (cause) {
      alert(cause instanceof Error ? cause.message : '删除模型失败');
    }
  }

  async function handleBulkDeleteModels() {
    if (!provider || selectedModelIds.size === 0) return;
    if (!confirm(`确定要从通道「${provider.name}」中批量删除选中的 ${selectedModelIds.size} 个模型吗？`)) return;
    setBusy(true);
    try {
      const models = provider.models
        .filter((model) => !selectedModelIds.has(model.id))
        .map((model) => ({
          modelId: model.id,
          displayName: model.name,
          input: model.input,
          output: model.output,
          contextWindow: model.contextWindow,
          maxTokens: model.maxTokens,
          source: model.source === 'manual' ? ('manual' as const) : ('remote' as const),
        }));
      const result = await setProviderModels(provider.id, { models }, newIdempotencyKey());
      onUpdated(result.provider);
      setSelectedModelIds(new Set());
    } catch (err) {
      alert('批量删除模型失败: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  }

  async function handleClearAllModels() {
    if (!provider || provider.models.length === 0) return;
    if (!confirm(`确定要清空通道「${provider.name}」下的所有 ${provider.models.length} 个模型吗？`)) return;
    setBusy(true);
    try {
      const result = await setProviderModels(provider.id, { models: [] }, newIdempotencyKey());
      onUpdated(result.provider);
      setSelectedModelIds(new Set());
    } catch (err) {
      alert('清空模型失败: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.4)',
        backdropFilter: 'blur(2px)',
        zIndex: 900,
        display: 'flex',
        justifyContent: 'flex-end',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(92vw, 680px)',
          height: '100%',
          background: '#ffffff',
          boxShadow: '-8px 0 24px rgba(0, 0, 0, 0.12)',
          display: 'flex',
          flexDirection: 'column',
          animation: 'aionSlideInRight 0.25s ease',
        }}
      >
        {/* 抽屉头部 */}
        <div
          style={{
            padding: '18px 24px',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: '#fafcff',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="provider-logo" style={{ width: '28px', height: '28px', fontSize: '14px' }}>
                {provider.name.slice(0, 1).toUpperCase()}
              </span>
              <strong style={{ fontSize: '16px', color: '#0f172a' }}>{provider.name} · 挂载模型管理</strong>
              <span
                style={{
                  fontSize: '11px',
                  padding: '2px 8px',
                  borderRadius: '12px',
                  background: provider.enabled ? '#ecfdf5' : '#f1f5f9',
                  color: provider.enabled ? '#15803d' : '#64748b',
                  fontWeight: 600,
                }}
              >
                {provider.enabled ? '运行中' : '已停用'}
              </span>
            </div>
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#64748b' }}>
              <code>{provider.baseUrl}</code> · {provider.models.length} 个已挂载模型
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '20px',
              color: '#64748b',
              cursor: 'pointer',
              padding: '4px 8px',
            }}
          >
            ✕
          </button>
        </div>

        {/* 顶部操作条 */}
        <div
          style={{
            padding: '12px 24px',
            borderBottom: '1px solid #f1f5f9',
            background: '#ffffff',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="settings-action-btn is-primary"
              style={{ fontSize: '12.5px', padding: '6px 12px' }}
              onClick={() => onOpenSelectModal(provider)}
            >
              🔍 获取上游候选并选择
            </button>
            <button
              type="button"
              className="settings-pill-btn"
              style={{ fontSize: '12px' }}
              onClick={() => onOpenTestModal(provider)}
            >
              🧪 批量测试
            </button>
            <button
              type="button"
              className="settings-pill-btn"
              style={{ fontSize: '12px', color: '#047857' }}
              onClick={() => void runProviderTest()}
            >
              探测网关
            </button>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            {selectedModelIds.size > 0 ? (
              <button
                type="button"
                className="settings-pill-btn"
                disabled={busy}
                style={{ color: '#ef4444', borderColor: '#fecaca', background: '#fef2f2', fontSize: '12px' }}
                onClick={() => void handleBulkDeleteModels()}
              >
                删除已选 ({selectedModelIds.size})
              </button>
            ) : null}
            <button
              type="button"
              className="settings-pill-btn"
              disabled={busy || provider.models.length === 0}
              style={{ color: '#dc2626', fontSize: '12px' }}
              onClick={() => void handleClearAllModels()}
            >
              清空
            </button>
          </div>
        </div>

        {testState[provider.id] ? (
          <div style={{ padding: '8px 24px', background: '#eff6ff', color: '#1d4ed8', fontSize: '12px' }}>
            ℹ️ {testState[provider.id]}
          </div>
        ) : null}

        {/* 模型列表滚动区 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
          {provider.models.length === 0 ? (
            <div
              style={{
                padding: '40px 20px',
                textAlign: 'center',
                color: '#64748b',
                background: '#f8fafc',
                border: '1px dashed #cbd5e1',
                borderRadius: '10px',
              }}
            >
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                当前通道未挂载任何模型
              </div>
              <p style={{ margin: '0 0 14px', fontSize: '12.5px' }}>
                点击上方「获取上游候选并选择」从网关拉取，或使用下方表单快速手动填入。
              </p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '10px' }}>
              {provider.models.map((model: ModelDescriptor) => {
                const group = classifyModelGroup(model.id);
                const isChecked = selectedModelIds.has(model.id);
                return (
                  <div
                    key={model.id}
                    className="provider-model-card"
                    style={{
                      padding: '10px 12px',
                      background: isChecked ? '#f8fafc' : '#ffffff',
                      borderRadius: '8px',
                      border: `1px solid ${isChecked ? '#93c5fd' : '#e2e8f0'}`,
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
                            checked={isChecked}
                            onChange={(e) => {
                              setSelectedModelIds((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(model.id);
                                else next.delete(model.id);
                                return next;
                              });
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
                          marginTop: '4px',
                          overflowWrap: 'break-word',
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
                        {model.source === 'manual' ? '手动填入' : '上游同步'}
                      </span>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          type="button"
                          className="settings-pill-btn"
                          style={{ fontSize: '11px', padding: '2px 8px' }}
                          onClick={() =>
                            void testModelConnection(provider.id, model.id)
                              .then((res: ConnectionTestResponse) => {
                                alert(res.ok ? `${model.id} 测速成功 (${res.latencyMs || 0}ms)` : `测速失败: ${res.error || '未通过'}`);
                              })
                              .catch((err: unknown) => alert(err instanceof Error ? err.message : '测速异常'))
                          }
                        >
                          测速
                        </button>
                        <button
                          type="button"
                          className="settings-pill-btn"
                          style={{ fontSize: '11px', padding: '2px 8px', color: '#ef4444' }}
                          onClick={() => void handleDeleteModel(model.id)}
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
          <div style={{ marginTop: '20px', borderTop: '1px solid #e2e8f0', paddingTop: '14px' }}>
            <span style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155' }}>快速单项填入模型</span>
            <ModelQuickAdd provider={provider} onAdded={onUpdated} />
          </div>
        </div>
      </div>
    </div>
  );
}
