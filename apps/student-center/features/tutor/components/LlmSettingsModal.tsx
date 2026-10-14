'use client';

import { useEffect, useState } from 'react';
import { getClientLlmConfig, saveClientLlmConfig, type LlmConfig } from '../services/pblLlmService';

interface LlmSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const PRESETS: Array<{
  name: string;
  provider: LlmConfig['provider'];
  baseUrl: string;
  model: string;
  hint: string;
}> = [
  {
    name: 'DeepSeek 官方 API (推荐)',
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    hint: '支持超强推理与深度思考链路输出',
  },
  {
    name: '阿里通义千问 (百炼)',
    provider: 'qwen',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    hint: '国内低延迟直连，教育多轮对话稳定',
  },
  {
    name: 'OpenAI (GPT-4o)',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    hint: '全能旗舰模型',
  },
  {
    name: '本地 Ollama (完全离线)',
    provider: 'ollama',
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen2.5:7b',
    hint: '无需联网，保护隐私',
  },
];

export function LlmSettingsModal({ isOpen, onClose }: LlmSettingsModalProps) {
  const [config, setConfig] = useState<LlmConfig>(getClientLlmConfig);
  const [systemModels, setSystemModels] = useState<Array<{ id: string; name: string; baseUrl?: string; providerId?: string }>>([]);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const cached = localStorage.getItem('qitu.cached_configured_models');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setSystemModels(parsed);
          }
        }
      } catch {}
    }
  }, []);

  if (!isOpen) return null;

  const handleApplyPreset = (p: typeof PRESETS[0]) => {
    setConfig((prev) => ({
      ...prev,
      provider: p.provider,
      baseUrl: p.baseUrl,
      model: p.model,
    }));
    setTestResult(null);
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      if (!config.apiKey && config.provider !== 'ollama') {
        throw new Error('请先填入有效的 API Key');
      }
      const res = await fetch(`${config.baseUrl.replace(/\/$/u, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey.trim()}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: 'user', content: '测试连接：请只回复“OK”' }],
          max_tokens: 10,
        }),
      });

      if (!res.ok) {
        throw new Error(`上游网关返回 HTTP ${res.status}`);
      }
      const data = await res.json();
      const reply = data?.choices?.[0]?.message?.content ?? 'OK';
      setTestResult(`✅ 成功连通！模型响应: "${reply.trim()}"`);
    } catch (err) {
      setTestResult(`❌ 连接失败: ${err instanceof Error ? err.message : '网络异常'}`);
    } finally {
      setTesting(false);
    }
  };

  const handleSave = () => {
    saveClientLlmConfig(config);
    setSavedNotice(true);
    setTimeout(() => {
      setSavedNotice(false);
      onClose();
    }, 500);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.45)',
        backdropFilter: 'blur(4px)',
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '560px',
          maxWidth: '92vw',
          background: '#ffffff',
          borderRadius: '16px',
          boxShadow: '0 20px 48px rgba(0,0,0,0.18)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div
          style={{
            padding: '18px 24px',
            borderBottom: '1px solid #f1f5f9',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'linear-gradient(135deg, #f8fafc 0%, #eff6ff 100%)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '24px' }}>🤖</span>
            <div>
              <h3 style={{ margin: 0, fontSize: '16px', color: '#0f172a' }}>AI 语言模型接入与运行时设置</h3>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#64748b' }}>
                配置用于驱动 PBL 情景教学、导师思维链与多角色协作的 LLM
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: '18px', color: '#64748b', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>

        {/* 主体 */}
        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '16px', maxHeight: '72vh', overflowY: 'auto' }}>
          {/* 快捷预设 */}
          <div>
            <label style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '8px' }}>
              快速套用主流大模型通道：
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
              {PRESETS.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => handleApplyPreset(p)}
                  style={{
                    padding: '8px 10px',
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0',
                    background: config.baseUrl === p.baseUrl ? '#eff6ff' : '#ffffff',
                    borderColor: config.baseUrl === p.baseUrl ? '#2563eb' : '#e2e8f0',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{ fontSize: '12px', fontWeight: 600, color: config.baseUrl === p.baseUrl ? '#1d4ed8' : '#1e293b' }}>
                    {p.name}
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>{p.hint}</div>
                </button>
              ))}
            </div>
          </div>

          {/* 表单字段 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '4px' }}>
                网关 API 地址 (Base URL)
              </label>
              <input
                type="text"
                value={config.baseUrl}
                onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
                placeholder="https://api.deepseek.com/v1"
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: '8px',
                  border: '1.5px solid #cbd5e1',
                  fontSize: '13px',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '4px' }}>
                API Key (密钥将安全保存在本地浏览器)
              </label>
              <input
                type="password"
                value={config.apiKey}
                onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
                placeholder="sk-..."
                autoComplete="off"
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: '8px',
                  border: '1.5px solid #cbd5e1',
                  fontSize: '13px',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#475569' }}>
                    模型选择 (Model ID)
                  </label>
                  {systemModels.length > 0 ? (
                    <span style={{ fontSize: '11px', color: '#16a34a' }}>● 已匹配已配置模型 ({systemModels.length})</span>
                  ) : null}
                </div>
                {systemModels.length > 0 ? (
                  <select
                    value={config.model}
                    onChange={(e) => {
                      const selected = systemModels.find((m) => m.id === e.target.value);
                      if (selected) {
                        setConfig({
                          ...config,
                          model: selected.id,
                          baseUrl: selected.baseUrl || config.baseUrl,
                        });
                      } else {
                        setConfig({ ...config, model: e.target.value });
                      }
                    }}
                    style={{
                      width: '100%',
                      padding: '9px 12px',
                      borderRadius: '8px',
                      border: '1.5px solid #cbd5e1',
                      fontSize: '13px',
                      background: '#ffffff',
                      boxSizing: 'border-box',
                    }}
                  >
                    {systemModels.map((m) => (
                      <option key={`${m.providerId}-${m.id}`} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={config.model}
                    onChange={(e) => setConfig({ ...config, model: e.target.value })}
                    placeholder="deepseek-chat"
                    style={{
                      width: '100%',
                      padding: '9px 12px',
                      borderRadius: '8px',
                      border: '1.5px solid #cbd5e1',
                      fontSize: '13px',
                      boxSizing: 'border-box',
                    }}
                  />
                )}
              </div>

              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '4px' }}>
                  发散度 (Temp)
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="1.5"
                  value={config.temperature}
                  onChange={(e) => setConfig({ ...config, temperature: parseFloat(e.target.value) || 0.7 })}
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: '8px',
                    border: '1.5px solid #cbd5e1',
                    fontSize: '13px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>
          </div>

          {/* 探测信息 */}
          {testResult && (
            <div
              style={{
                padding: '8px 12px',
                borderRadius: '8px',
                fontSize: '12.5px',
                background: testResult.startsWith('✅') ? '#ecfdf5' : '#fef2f2',
                color: testResult.startsWith('✅') ? '#065f46' : '#991b1b',
                border: `1px solid ${testResult.startsWith('✅') ? '#a7f3d0' : '#fecaca'}`,
              }}
            >
              {testResult}
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div
          style={{
            padding: '14px 24px',
            borderTop: '1px solid #f1f5f9',
            background: '#f8fafc',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={testing}
            style={{
              padding: '7px 14px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              fontSize: '12.5px',
              fontWeight: 600,
              color: '#334155',
              cursor: testing ? 'wait' : 'pointer',
            }}
          >
            {testing ? '正在测试…' : '🔌 测试连通性'}
          </button>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {savedNotice && <span style={{ fontSize: '12px', color: '#16a34a', fontWeight: 600 }}>已保存！</span>}
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '7px 14px',
                borderRadius: '8px',
                border: '1px solid #e2e8f0',
                background: '#ffffff',
                fontSize: '12.5px',
                cursor: 'pointer',
              }}
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSave}
              style={{
                padding: '7px 18px',
                borderRadius: '8px',
                border: 'none',
                background: '#2563eb',
                color: '#ffffff',
                fontSize: '12.5px',
                fontWeight: 600,
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(37, 99, 235, 0.25)',
              }}
            >
              保存配置并应用
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
