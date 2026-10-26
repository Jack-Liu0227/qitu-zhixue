'use client';

import { useState } from 'react';
import type { ProviderPreset } from '@qitu/contracts';
import { presetAuthLabel } from './types';

export interface ProviderPresetsTabProps {
  presets: ProviderPreset[];
  onCreateFromPreset: (preset: ProviderPreset) => void;
}

export function ProviderPresetsTab({ presets, onCreateFromPreset }: ProviderPresetsTabProps) {
  const [selectedPresetId, setSelectedPresetId] = useState<string>(presets[0]?.id ?? '');
  const activePreset = presets.find((p) => p.id === selectedPresetId) ?? presets[0] ?? null;

  return (
    <div style={{ padding: '20px 0' }}>
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
          padding: '24px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            flexWrap: 'wrap',
            gap: '16px',
            marginBottom: '20px',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '20px' }}>🌐</span>
              <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a', margin: 0 }}>
                支持的供应商目录（服务端预置模板）
              </h2>
              <span
                style={{
                  fontSize: '11px',
                  background: '#eff6ff',
                  color: '#2563eb',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontWeight: 600,
                }}
              >
                {presets.length} 个模板已就绪
              </span>
            </div>
            <p style={{ fontSize: '13px', color: '#64748b', margin: '6px 0 0' }}>
              目录由启途 AI 运行时统一下发。选择供应商模板，可一键预填协议、端点与推荐挂载模型。
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>选择供应商:</label>
            <select
              value={activePreset?.id ?? ''}
              onChange={(e) => setSelectedPresetId(e.target.value)}
              style={{
                padding: '8px 14px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                background: '#f8fafc',
                fontSize: '13px',
                fontWeight: 600,
                color: '#0f172a',
                cursor: 'pointer',
                outline: 'none',
                minWidth: '260px',
              }}
            >
              {presets.length === 0 ? <option value="">（未获取到预置模板）</option> : null}
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {activePreset && (
          <div
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '10px',
              padding: '20px 24px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '16px',
            }}
          >
            <div style={{ flex: 1, minWidth: '320px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                <strong style={{ fontSize: '16px', color: '#0f172a' }}>{activePreset.name}</strong>
                <span
                  style={{
                    fontSize: '11px',
                    background: '#e2e8f0',
                    color: '#334155',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontWeight: 600,
                  }}
                >
                  {activePreset.api}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12.5px', color: '#475569' }}>
                <div>
                  <span style={{ color: '#94a3b8' }}>网关默认地址: </span>
                  <code style={{ background: '#ffffff', padding: '2px 8px', borderRadius: '4px', border: '1px solid #e2e8f0' }}>
                    {activePreset.baseUrl}
                  </code>
                </div>
                <div>
                  <span style={{ color: '#94a3b8' }}>认证方式: </span>
                  <span>{presetAuthLabel(activePreset)}</span>
                </div>
                {activePreset.suggestedModels.length > 0 ? (
                  <div>
                    <span style={{ color: '#94a3b8' }}>推荐挂载模型: </span>
                    <span style={{ fontWeight: 600, color: '#2563eb' }}>
                      {activePreset.suggestedModels.map((m) => m.id).join(', ')}
                    </span>
                  </div>
                ) : null}
              </div>
            </div>

            <div>
              <button
                type="button"
                className="settings-action-btn is-primary"
                onClick={() => onCreateFromPreset(activePreset)}
                style={{ padding: '10px 20px', fontSize: '13.5px', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <span>⚡</span> 基于此模板新建通道
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
