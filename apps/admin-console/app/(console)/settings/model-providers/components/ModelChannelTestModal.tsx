'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ModelApi } from '@qitu/contracts';
import { testModelConnection } from '../../../../../lib/api/modelRegistry';

export interface ModelChannelTestModalProps {
  isOpen: boolean;
  onClose: () => void;
  channelName: string;
  baseUrl: string;
  apiKey?: string;
  api: ModelApi;
  providerId?: string;
  models: string[];
}

export function ModelChannelTestModal({
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
        const elapsed = Math.round(performance.now() - startTime);
        setTestResults((prev) => ({
          ...prev,
          [modelName]: {
            status: 'error',
            latencyMs: elapsed,
            error: '请先保存通道，再通过服务端执行模型测试',
          },
        }));
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
