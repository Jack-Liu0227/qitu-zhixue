'use client';

import { useState } from 'react';
import { SectionCard } from '@qitu/ui';
import type { TheoryMaterial } from '../types';
import { MarkdownMathView } from '../../tutor/components/MarkdownMathView';
import { OpticsDiffractionScatteringCard } from '../../tutor/components/OpticsDiffractionScatteringCard';

export interface TheoryModuleProps {
  material: TheoryMaterial;
}

/** 理论与微观仿真动态交互课件 */
export function TheoryModule({ material }: TheoryModuleProps) {
  const [activeTab, setActiveTab] = useState<'simulation' | 'theory'>('simulation');

  return (
    <SectionCard title={material.title}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* 顶部课件模式切换标签 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            borderBottom: '1px solid #e2e8f0',
            paddingBottom: '12px',
          }}
        >
          <button
            type="button"
            onClick={() => setActiveTab('simulation')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 14px',
              fontSize: '13px',
              fontWeight: 600,
              borderRadius: '8px',
              border: 'none',
              cursor: 'pointer',
              background: activeTab === 'simulation' ? '#2563eb' : '#f1f5f9',
              color: activeTab === 'simulation' ? '#ffffff' : '#475569',
              transition: 'all 0.2s ease',
            }}
          >
            <span>🔬</span>
            <span>动态微观物理课件</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('theory')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 14px',
              fontSize: '13px',
              fontWeight: 600,
              borderRadius: '8px',
              border: 'none',
              cursor: 'pointer',
              background: activeTab === 'theory' ? '#2563eb' : '#f1f5f9',
              color: activeTab === 'theory' ? '#ffffff' : '#475569',
              transition: 'all 0.2s ease',
            }}
          >
            <span>📖</span>
            <span>理论体系与公式解析</span>
          </button>
        </div>

        {activeTab === 'simulation' ? (
          <div>
            <div
              style={{
                padding: '10px 14px',
                background: '#eff6ff',
                border: '1px solid #bfdbfe',
                borderRadius: '10px',
                marginBottom: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '13px',
                color: '#1d4ed8',
              }}
            >
              <span>💡</span>
              <span>
                <strong>微观物理动态仿真课件</strong>：支持单缝夫琅禾费衍射与气溶胶微粒散射实时动态模拟。拖拽下方滑块即可实时观察光强分布与条纹变化。
              </span>
            </div>
            <OpticsDiffractionScatteringCard initialMode="diffraction" />
          </div>
        ) : (
          <div className="qitu-theory-module">
            {material.sections.map((section) => (
              <section
                key={section.heading}
                style={{
                  background: '#f8fafc',
                  padding: '14px 18px',
                  borderRadius: '10px',
                  border: '1px solid #e2e8f0',
                  marginBottom: '10px',
                }}
              >
                <h4 style={{ margin: '0 0 8px', color: '#1e293b', fontSize: '15px' }}>{section.heading}</h4>
                <MarkdownMathView content={section.body} />
              </section>
            ))}
          </div>
        )}
      </div>
    </SectionCard>
  );
}
