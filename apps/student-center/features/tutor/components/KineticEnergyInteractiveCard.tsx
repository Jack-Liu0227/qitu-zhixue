'use client';

import React, { useState } from 'react';
import katex from 'katex';

export interface KineticEnergyInteractiveCardProps {
  onExperimentComplete?: (summary: string) => void;
  disabled?: boolean;
}

export function KineticEnergyInteractiveCard({
  onExperimentComplete,
  disabled = false,
}: KineticEnergyInteractiveCardProps) {
  // 实验参数状态
  const [mass, setMass] = useState<number>(2.0); // 质量 m (kg)
  const [initialV, setInitialV] = useState<number>(0.0); // 初速度 v1 (m/s)
  const [force, setForce] = useState<number>(10.0); // 恒力 F (N)
  const [distance, setDistance] = useState<number>(5.0); // 位移 s (m)
  const [showExplanation, setShowExplanation] = useState(true);

  // 计算物理量
  // 1. 恒力做功 W = F * s
  const work = force * distance;
  // 2. 加速度 a = F / m
  const acceleration = force / mass;
  // 3. 末速度 v2 = sqrt(v1^2 + 2*a*s)
  const finalV = Math.sqrt(initialV * initialV + 2 * acceleration * distance);
  // 4. 初末动能 Ek1, Ek2
  const initialEk = 0.5 * mass * initialV * initialV;
  const finalEk = 0.5 * mass * finalV * finalV;
  const deltaEk = finalEk - initialEk;

  // 渲染公式
  const formulaHtml = katex.renderToString(
    '{\\color{#2563eb}W_{\\text{合}}} = \\Delta {\\color{#9333ea}E_k} = \\frac{1}{2}{\\color{#16a34a}m}{\\color{#ea580c}v_2^2} - \\frac{1}{2}{\\color{#16a34a}m}{\\color{#ea580c}v_1^2}',
    { displayMode: true, throwOnError: false, trust: true }
  );

  return (
    <div
      className="qitu-kinetic-card"
      style={{
        margin: '16px 0',
        padding: '20px',
        background: '#ffffff',
        border: '1.5px solid #bfdbfe',
        borderRadius: '16px',
        boxShadow: '0 8px 24px rgba(37,99,235,0.08)',
      }}
    >
      {/* 标题栏 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '20px' }}>⚡</span>
          <div>
            <h4 style={{ margin: 0, fontSize: '15px', color: '#102a5c', fontWeight: 700 }}>
              动能定理动态交互探究工作台 (PBL 核心模块)
            </h4>
            <span style={{ fontSize: '12px', color: '#64748b' }}>
              通过控制变量法，直观探究质量 m 与速度 v 变化对能量的动态影响
            </span>
          </div>
        </div>
        <span
          style={{
            fontSize: '11px',
            fontWeight: 600,
            padding: '3px 8px',
            borderRadius: '999px',
            background: '#eff6ff',
            color: '#1d4ed8',
            border: '1px solid #dbeafe',
          }}
        >
          理论验证与动态演示
        </span>
      </div>

      {/* 核心公式展示与变量着色 */}
      <div
        style={{
          background: 'linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)',
          borderRadius: '12px',
          padding: '12px',
          marginBottom: '16px',
          border: '1px solid #e2e8f0',
        }}
      >
        <div dangerouslySetInnerHTML={{ __html: formulaHtml }} style={{ fontSize: '18px', textAlign: 'center' }} />
        <div
          style={{
            marginTop: '8px',
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: '10px',
            fontSize: '11.5px',
          }}
        >
          <span style={{ color: '#2563eb', fontWeight: 600 }}>● W (合力做功)</span>
          <span style={{ color: '#9333ea', fontWeight: 600 }}>● ΔEk (动能增量)</span>
          <span style={{ color: '#16a34a', fontWeight: 600 }}>● m (小车质量)</span>
          <span style={{ color: '#ea580c', fontWeight: 600 }}>● v (瞬时速度)</span>
        </div>
      </div>

      {/* 参数微调控制面板 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '14px',
          marginBottom: '18px',
        }}
      >
        {/* 质量 m 控制 */}
        <div style={{ padding: '12px', background: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
            <span style={{ fontSize: '12.5px', fontWeight: 600, color: '#16a34a' }}>
              物体质量 m: <strong>{mass.toFixed(1)} kg</strong>
            </span>
            <div style={{ display: 'flex', gap: '4px' }}>
              <button
                type="button"
                onClick={() => setMass(1.0)}
                style={{
                  padding: '2px 6px',
                  fontSize: '10.5px',
                  borderRadius: '4px',
                  border: mass === 1.0 ? '1px solid #16a34a' : '1px solid #cbd5e1',
                  background: mass === 1.0 ? '#dcfce7' : '#fff',
                  cursor: 'pointer',
                }}
              >
                1kg
              </button>
              <button
                type="button"
                onClick={() => setMass(2.0)}
                style={{
                  padding: '2px 6px',
                  fontSize: '10.5px',
                  borderRadius: '4px',
                  border: mass === 2.0 ? '1px solid #16a34a' : '1px solid #cbd5e1',
                  background: mass === 2.0 ? '#dcfce7' : '#fff',
                  cursor: 'pointer',
                }}
              >
                2kg (2m)
              </button>
              <button
                type="button"
                onClick={() => setMass(4.0)}
                style={{
                  padding: '2px 6px',
                  fontSize: '10.5px',
                  borderRadius: '4px',
                  border: mass === 4.0 ? '1px solid #16a34a' : '1px solid #cbd5e1',
                  background: mass === 4.0 ? '#dcfce7' : '#fff',
                  cursor: 'pointer',
                }}
              >
                4kg (4m)
              </button>
            </div>
          </div>
          <input
            type="range"
            min="0.5"
            max="6.0"
            step="0.5"
            value={mass}
            onChange={(e) => setMass(parseFloat(e.target.value))}
            style={{ width: '100%', accentColor: '#16a34a', cursor: 'pointer' }}
          />
          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
            质量翻倍影响：动能呈<strong>线性成倍变化</strong>
          </div>
        </div>

        {/* 推动恒力 F 控制 */}
        <div style={{ padding: '12px', background: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
            <span style={{ fontSize: '12.5px', fontWeight: 600, color: '#2563eb' }}>
              恒定推力 F: <strong>{force.toFixed(1)} N</strong>
            </span>
            <span style={{ fontSize: '11px', color: '#64748b' }}>W = F × s</span>
          </div>
          <input
            type="range"
            min="2.0"
            max="30.0"
            step="2.0"
            value={force}
            onChange={(e) => setForce(parseFloat(e.target.value))}
            style={{ width: '100%', accentColor: '#2563eb', cursor: 'pointer' }}
          />
          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
            做功量计算：W = {force.toFixed(1)}N × {distance.toFixed(1)}m ={' '}
            <strong style={{ color: '#2563eb' }}>{work.toFixed(1)} J</strong>
          </div>
        </div>

        {/* 作用位移 s 控制 */}
        <div style={{ padding: '12px', background: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
            <span style={{ fontSize: '12.5px', fontWeight: 600, color: '#0284c7' }}>
              作用位移 s: <strong>{distance.toFixed(1)} m</strong>
            </span>
            <div style={{ display: 'flex', gap: '4px' }}>
              <button
                type="button"
                onClick={() => setDistance(2.5)}
                style={{
                  padding: '2px 6px',
                  fontSize: '10.5px',
                  borderRadius: '4px',
                  border: distance === 2.5 ? '1px solid #0284c7' : '1px solid #cbd5e1',
                  background: distance === 2.5 ? '#e0f2fe' : '#fff',
                  cursor: 'pointer',
                }}
              >
                2.5m
              </button>
              <button
                type="button"
                onClick={() => setDistance(5.0)}
                style={{
                  padding: '2px 6px',
                  fontSize: '10.5px',
                  borderRadius: '4px',
                  border: distance === 5.0 ? '1px solid #0284c7' : '1px solid #cbd5e1',
                  background: distance === 5.0 ? '#e0f2fe' : '#fff',
                  cursor: 'pointer',
                }}
              >
                5.0m
              </button>
              <button
                type="button"
                onClick={() => setDistance(10.0)}
                style={{
                  padding: '2px 6px',
                  fontSize: '10.5px',
                  borderRadius: '4px',
                  border: distance === 10.0 ? '1px solid #0284c7' : '1px solid #cbd5e1',
                  background: distance === 10.0 ? '#e0f2fe' : '#fff',
                  cursor: 'pointer',
                }}
              >
                10.0m
              </button>
            </div>
          </div>
          <input
            type="range"
            min="1.0"
            max="15.0"
            step="1.0"
            value={distance}
            onChange={(e) => setDistance(parseFloat(e.target.value))}
            style={{ width: '100%', accentColor: '#0284c7', cursor: 'pointer' }}
          />
          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
            末速度推导：v₂ = √(2as) = <strong style={{ color: '#ea580c' }}>{finalV.toFixed(2)} m/s</strong>
          </div>
        </div>
      </div>

      {/* 实时动态对比仪表盘：做功 W 与动能变化量 ΔEk 严格对齐检验 */}
      <div
        style={{
          background: '#eff6ff',
          border: '1.5px solid #bfdbfe',
          borderRadius: '12px',
          padding: '16px',
          marginBottom: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <strong style={{ fontSize: '13.5px', color: '#1e40af' }}>
            🎯 物理守恒对齐：合外力做功 W 与 动能变化量 ΔEk
          </strong>
          <span
            style={{
              fontSize: '11px',
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: '6px',
              background: '#dcfce7',
              color: '#15803d',
              border: '1px solid #bbf7d0',
            }}
          >
            ✓ 绝对守恒: W ≡ ΔEk
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '12px' }}>
          <div style={{ background: '#fff', padding: '12px', borderRadius: '8px', border: '1px solid #dbeafe' }}>
            <span style={{ fontSize: '11.5px', color: '#2563eb', fontWeight: 600 }}>外力做功 W = F · s</span>
            <div style={{ fontSize: '22px', fontWeight: 800, color: '#1d4ed8', marginTop: '4px' }}>
              {work.toFixed(1)} <span style={{ fontSize: '14px', fontWeight: 500 }}>焦耳 (J)</span>
            </div>
            <div style={{ height: '6px', background: '#dbeafe', borderRadius: '3px', marginTop: '8px', overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${Math.min(work / 3, 100)}%`,
                  background: '#2563eb',
                  transition: 'width 0.2s ease',
                }}
              />
            </div>
          </div>

          <div style={{ background: '#fff', padding: '12px', borderRadius: '8px', border: '1px solid #f3e8ff' }}>
            <span style={{ fontSize: '11.5px', color: '#9333ea', fontWeight: 600 }}>动能变化量 ΔEk = 1/2 m v₂²</span>
            <div style={{ fontSize: '22px', fontWeight: 800, color: '#7e22ce', marginTop: '4px' }}>
              {deltaEk.toFixed(1)} <span style={{ fontSize: '14px', fontWeight: 500 }}>焦耳 (J)</span>
            </div>
            <div style={{ height: '6px', background: '#f3e8ff', borderRadius: '3px', marginTop: '8px', overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${Math.min(deltaEk / 3, 100)}%`,
                  background: '#9333ea',
                  transition: 'width 0.2s ease',
                }}
              />
            </div>
          </div>
        </div>

        {/* 动态原理解析 */}
        <div style={{ fontSize: '12.5px', color: '#334155', lineHeight: 1.6, background: '#ffffff', padding: '10px 12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
          <strong>💡 深度物理规律观察：</strong>
          <ul style={{ margin: '4px 0 0', paddingLeft: '18px' }}>
            <li>
              <strong>质量 m 的影响</strong>：当质量从 1kg 增至 2kg 时，相同的做功 {work.toFixed(1)}J 使得加速度减半，末速度降至 {(Math.sqrt((2 * work) / 2)).toFixed(2)} m/s，但<strong>总动能变化量始终严格等于外力做功 {work.toFixed(1)} J</strong>！
            </li>
            <li>
              <strong>速度 v 的平方效应</strong>：动能与速度的<strong>二次方</strong>成正比（$E_k \propto v^2$）。速度翻倍时（$v \to 2v$），物体的动能会暴增至原来的 <strong>4 倍</strong>！这就是车辆高速行驶时刹车距离急剧增加的根本力学原因。
            </li>
          </ul>
        </div>
      </div>

      {/* 成果交付确认按钮 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '10px', borderTop: '1px solid #f1f5f9' }}>
        <span style={{ fontSize: '12px', color: '#64748b' }}>
          掌握度自检完毕，点击按钮向导师团队汇报探究结论与数值验证成果
        </span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            const summary = `我通过控制变量动态实验验证了动能定理：当恒力 F=${force}N、位移 s=${distance}m 时，合外力做功 W=${work}J，末速度达到 ${finalV.toFixed(2)}m/s，动能增量 ΔEk=${deltaEk.toFixed(1)}J，两者完全相等！同时我深入理解了速度平方项对动能的非线性倍增效应。`;
            onExperimentComplete?.(summary);
          }}
          style={{
            padding: '8px 18px',
            background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
            color: '#ffffff',
            border: 'none',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 600,
            cursor: disabled ? 'not-allowed' : 'pointer',
            boxShadow: '0 2px 6px rgba(37,99,235,0.25)',
          }}
        >
          提交动态探究结论 ↵
        </button>
      </div>
    </div>
  );
}
