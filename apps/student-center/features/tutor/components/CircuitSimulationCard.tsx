'use client';

import React, { useState } from 'react';
import katex from 'katex';

export interface CircuitSimulationCardProps {
  onExperimentComplete?: (summary: string) => void;
  disabled?: boolean;
}

export function CircuitSimulationCard({
  onExperimentComplete,
  disabled = false,
}: CircuitSimulationCardProps) {
  // 电路类型：串联 (series) 或 并联 (parallel)
  const [circuitType, setCircuitType] = useState<'series' | 'parallel'>('series');
  // 电源电压 U (V)
  const [voltage, setVoltage] = useState<number>(6.0);
  // 电阻 R1 (Ω)
  const [r1, setR1] = useState<number>(10.0);
  // 电阻 R2 (Ω)
  const [r2, setR2] = useState<number>(20.0);
  const [showExplanation, setShowExplanation] = useState(true);

  // 物理量计算
  // 1. 等效总电阻 R_total
  const rTotal = circuitType === 'series' ? r1 + r2 : (r1 * r2) / (r1 + r2);
  // 2. 总电流 I_total (A)
  const iTotal = voltage / rTotal;
  // 3. 各电阻分流与分压
  let u1: number, u2: number, i1: number, i2: number;
  if (circuitType === 'series') {
    i1 = iTotal;
    i2 = iTotal;
    u1 = iTotal * r1;
    u2 = iTotal * r2;
  } else {
    u1 = voltage;
    u2 = voltage;
    i1 = voltage / r1;
    i2 = voltage / r2;
  }
  // 4. 总功率 P = U * I (W)
  const totalPower = voltage * iTotal;

  // KaTeX 公式渲染
  const formulaHtml = katex.renderToString(
    circuitType === 'series'
      ? '{\\color{#ea580c}I} = \\frac{{\\color{#2563eb}U}}{{\\color{#9333ea}R_1} + {\\color{#9333ea}R_2}},\\quad {\\color{#2563eb}U_1} = {\\color{#ea580c}I}{\\color{#9333ea}R_1},\\; {\\color{#2563eb}U_2} = {\\color{#ea580c}I}{\\color{#9333ea}R_2}'
      : '{\\color{#9333ea}R_{\\text{总}}} = \\frac{{\\color{#9333ea}R_1 R_2}}{{\\color{#9333ea}R_1 + R_2}},\\quad {\\color{#ea580c}I_{\\text{总}}} = {\\color{#ea580c}I_1} + {\\color{#ea580c}I_2} = \\frac{{\\color{#2563eb}U}}{{\\color{#9333ea}R_1}} + \\frac{{\\color{#2563eb}U}}{{\\color{#9333ea}R_2}}',
    { displayMode: true, throwOnError: false, trust: true }
  );

  const handleSubmitConclusion = () => {
    if (disabled || !onExperimentComplete) return;
    const summary =
      circuitType === 'series'
        ? `【串联电路探究完成】在电源电压 U=${voltage.toFixed(1)}V 下，串联电阻 R1=${r1.toFixed(0)}Ω 与 R2=${r2.toFixed(0)}Ω，总电阻 R_total=${rTotal.toFixed(1)}Ω。回路电流 I=${iTotal.toFixed(2)}A，分压 U1=${u1.toFixed(2)}V、U2=${u2.toFixed(2)}V（分压比等于电阻比）。灯泡与回路总功率 P=${totalPower.toFixed(2)}W。已完成串联分压与欧姆定律验证。`
        : `【并联电路探究完成】在电源电压 U=${voltage.toFixed(1)}V 下，并联电阻 R1=${r1.toFixed(0)}Ω 与 R2=${r2.toFixed(0)}Ω，等效总阻 R_total=${rTotal.toFixed(2)}Ω。支路电流 I1=${i1.toFixed(2)}A、I2=${i2.toFixed(2)}A，干路总电流 I_total=${iTotal.toFixed(2)}A（分流比反比于电阻比）。回路总功率 P=${totalPower.toFixed(2)}W。已完成并联分流与欧姆定律验证。`;
    onExperimentComplete(summary);
  };

  // 动画速度（电流越大，流动越快）
  const flowSpeed = Math.max(0.4, Math.min(3, 1.2 / Math.max(iTotal, 0.1)));
  // 灯泡亮度辉光 (0~1)
  const bulbGlow = Math.min(1, totalPower / 8);

  return (
    <div
      className="qitu-circuit-card"
      style={{
        margin: '16px 0',
        padding: '20px',
        background: '#ffffff',
        border: '1.5px solid #fed7aa',
        borderRadius: '16px',
        boxShadow: '0 8px 24px rgba(234,88,12,0.08)',
      }}
    >
      {/* 标题栏 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '20px' }}>🔌</span>
          <div>
            <h4 style={{ margin: 0, fontSize: '15px', color: '#102a5c', fontWeight: 700 }}>
              动态电路与欧姆定律探究工作台 (PBL 实践模块)
            </h4>
            <span style={{ fontSize: '12px', color: '#64748b' }}>
              通过实时调节电源电压 U 与电阻 R₁、R₂，直观探究串并联分压与分流规律
            </span>
          </div>
        </div>
        <span
          style={{
            fontSize: '11px',
            background: '#ffedd5',
            color: '#c2410c',
            padding: '3px 9px',
            borderRadius: '999px',
            fontWeight: 700,
          }}
        >
          仿真探究
        </span>
      </div>

      {/* 电路模式切换 */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px' }}>
        <button
          type="button"
          onClick={() => setCircuitType('series')}
          style={{
            flex: 1,
            padding: '9px 12px',
            borderRadius: '10px',
            border: circuitType === 'series' ? '2px solid #ea580c' : '1px solid #e2e8f0',
            background: circuitType === 'series' ? '#fff7ed' : '#f8fafc',
            color: circuitType === 'series' ? '#c2410c' : '#475569',
            fontWeight: circuitType === 'series' ? 700 : 500,
            fontSize: '13px',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
        >
          ⛓️ 串联电路 (Series Circuit: R = R₁ + R₂)
        </button>
        <button
          type="button"
          onClick={() => setCircuitType('parallel')}
          style={{
            flex: 1,
            padding: '9px 12px',
            borderRadius: '10px',
            border: circuitType === 'parallel' ? '2px solid #ea580c' : '1px solid #e2e8f0',
            background: circuitType === 'parallel' ? '#fff7ed' : '#f8fafc',
            color: circuitType === 'parallel' ? '#c2410c' : '#475569',
            fontWeight: circuitType === 'parallel' ? 700 : 500,
            fontSize: '13px',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
        >
          🔀 并联电路 (Parallel Circuit: 1/R = 1/R₁ + 1/R₂)
        </button>
      </div>

      {/* KaTeX 公式展示 */}
      <div
        style={{
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: '10px',
          padding: '10px 14px',
          marginBottom: '16px',
        }}
      >
        <div style={{ fontSize: '11.5px', color: '#64748b', fontWeight: 600, marginBottom: '4px' }}>
          📐 理论模型（变量色彩标注：电压 U 蓝色 · 电流 I 橙色 · 电阻 R 紫色）：
        </div>
        <div
          dangerouslySetInnerHTML={{ __html: formulaHtml }}
          style={{ overflowX: 'auto', textAlign: 'center', padding: '4px 0' }}
        />
      </div>

      {/* 参数滑块控制区 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '14px',
          marginBottom: '18px',
          background: '#fcfcfd',
          padding: '14px',
          borderRadius: '12px',
          border: '1px solid #f1f5f9',
        }}
      >
        {/* 电压 U */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', marginBottom: '6px' }}>
            <span style={{ color: '#2563eb', fontWeight: 600 }}>电源电压 U (V)</span>
            <strong style={{ color: '#0f172a' }}>{voltage.toFixed(1)} V</strong>
          </div>
          <input
            type="range"
            min={1.5}
            max={12.0}
            step={0.5}
            value={voltage}
            onChange={(e) => setVoltage(parseFloat(e.target.value))}
            style={{ width: '100%', accentColor: '#2563eb', cursor: 'pointer' }}
          />
        </div>

        {/* 电阻 R1 */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', marginBottom: '6px' }}>
            <span style={{ color: '#9333ea', fontWeight: 600 }}>定值电阻 R₁ (Ω)</span>
            <strong style={{ color: '#0f172a' }}>{r1.toFixed(0)} Ω</strong>
          </div>
          <input
            type="range"
            min={5}
            max={50}
            step={1}
            value={r1}
            onChange={(e) => setR1(parseFloat(e.target.value))}
            style={{ width: '100%', accentColor: '#9333ea', cursor: 'pointer' }}
          />
        </div>

        {/* 电阻 R2 */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', marginBottom: '6px' }}>
            <span style={{ color: '#9333ea', fontWeight: 600 }}>定值电阻 R₂ (Ω)</span>
            <strong style={{ color: '#0f172a' }}>{r2.toFixed(0)} Ω</strong>
          </div>
          <input
            type="range"
            min={5}
            max={50}
            step={1}
            value={r2}
            onChange={(e) => setR2(parseFloat(e.target.value))}
            style={{ width: '100%', accentColor: '#9333ea', cursor: 'pointer' }}
          />
        </div>
      </div>

      {/* SVG 电路动态图与仪表盘 */}
      <div
        style={{
          background: '#0f172a',
          borderRadius: '12px',
          padding: '16px',
          marginBottom: '16px',
          color: '#ffffff',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 600 }}>
            🖥️ 虚拟电路实时仿真示意图 (电流粒子动效 & 负载灯泡辉光)
          </span>
          <span style={{ fontSize: '11px', color: '#38bdf8' }}>
            总功率: {totalPower.toFixed(2)} W
          </span>
        </div>

        {/* SVG Circuit Canvas */}
        <svg viewBox="0 0 480 180" style={{ width: '100%', height: 'auto', display: 'block' }}>
          {/* Wire tracks */}
          <rect
            x="40"
            y="30"
            width="400"
            height="120"
            rx="12"
            fill="none"
            stroke="#334155"
            strokeWidth="4"
          />

          {/* Animated Current Path */}
          <rect
            x="40"
            y="30"
            width="400"
            height="120"
            rx="12"
            fill="none"
            stroke="#fb923c"
            strokeWidth="3"
            strokeDasharray="8 8"
            style={{
              animation: `qitu-current-flow ${flowSpeed}s linear infinite`,
            }}
          />

          {/* Power Supply (Left side) */}
          <g transform="translate(40, 90)">
            <rect x="-16" y="-20" width="32" height="40" rx="4" fill="#1e293b" stroke="#3b82f6" strokeWidth="2" />
            <text x="0" y="-5" fill="#38bdf8" fontSize="10" textAnchor="middle" fontWeight="bold">+{voltage.toFixed(1)}V</text>
            <text x="0" y="12" fill="#64748b" fontSize="8" textAnchor="middle">GND -</text>
          </g>

          {/* Circuit Components depending on mode */}
          {circuitType === 'series' ? (
            <>
              {/* R1 on top wire */}
              <g transform="translate(180, 30)">
                <rect x="-30" y="-14" width="60" height="28" rx="4" fill="#3b0764" stroke="#a855f7" strokeWidth="2" />
                <text x="0" y="4" fill="#e9d5ff" fontSize="10" textAnchor="middle" fontWeight="bold">R₁ {r1}Ω</text>
                <text x="0" y="24" fill="#38bdf8" fontSize="9" textAnchor="middle">{u1.toFixed(1)}V</text>
              </g>

              {/* R2 on top wire */}
              <g transform="translate(300, 30)">
                <rect x="-30" y="-14" width="60" height="28" rx="4" fill="#3b0764" stroke="#a855f7" strokeWidth="2" />
                <text x="0" y="4" fill="#e9d5ff" fontSize="10" textAnchor="middle" fontWeight="bold">R₂ {r2}Ω</text>
                <text x="0" y="24" fill="#38bdf8" fontSize="9" textAnchor="middle">{u2.toFixed(1)}V</text>
              </g>
            </>
          ) : (
            <>
              {/* Parallel branch line */}
              <line x1="200" y1="30" x2="200" y2="150" stroke="#334155" strokeWidth="3" />
              <line x1="320" y1="30" x2="320" y2="150" stroke="#334155" strokeWidth="3" />

              {/* Branch 1: R1 */}
              <g transform="translate(260, 50)">
                <rect x="-28" y="-12" width="56" height="24" rx="4" fill="#3b0764" stroke="#a855f7" strokeWidth="2" />
                <text x="0" y="4" fill="#e9d5ff" fontSize="9" textAnchor="middle" fontWeight="bold">R₁ {r1}Ω ({i1.toFixed(2)}A)</text>
              </g>

              {/* Branch 2: R2 */}
              <g transform="translate(260, 110)">
                <rect x="-28" y="-12" width="56" height="24" rx="4" fill="#3b0764" stroke="#a855f7" strokeWidth="2" />
                <text x="0" y="4" fill="#e9d5ff" fontSize="9" textAnchor="middle" fontWeight="bold">R₂ {r2}Ω ({i2.toFixed(2)}A)</text>
              </g>
            </>
          )}

          {/* Light Bulb (Right side) */}
          <g transform="translate(440, 90)">
            <circle
              cx="0"
              cy="0"
              r={16 + bulbGlow * 12}
              fill="rgba(251, 191, 36, 0.25)"
              style={{ transition: 'r 0.3s ease' }}
            />
            <circle cx="0" cy="0" r="14" fill="#1e293b" stroke="#f59e0b" strokeWidth="2" />
            <text x="0" y="4" fill={bulbGlow > 0.3 ? '#fef08a' : '#94a3b8'} fontSize="14" textAnchor="middle">💡</text>
          </g>

          {/* Ammeter box (Bottom wire) */}
          <g transform="translate(240, 150)">
            <rect x="-26" y="-12" width="52" height="24" rx="4" fill="#1e293b" stroke="#fb923c" strokeWidth="2" />
            <text x="0" y="4" fill="#fb923c" fontSize="10" textAnchor="middle" fontWeight="bold">I={iTotal.toFixed(2)}A</text>
          </g>
        </svg>

        <style>{`
          @keyframes qitu-current-flow {
            from { stroke-dashoffset: 32; }
            to { stroke-dashoffset: 0; }
          }
        `}</style>
      </div>

      {/* 实时数据仪表看板 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gap: '10px',
          marginBottom: '16px',
        }}
      >
        <div style={{ background: '#f8fafc', padding: '10px', borderRadius: '10px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
          <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>等效总阻 R_total</span>
          <strong style={{ fontSize: '15px', color: '#9333ea' }}>{rTotal.toFixed(1)} Ω</strong>
        </div>
        <div style={{ background: '#fff7ed', padding: '10px', borderRadius: '10px', border: '1px solid #fed7aa', textAlign: 'center' }}>
          <span style={{ fontSize: '11px', color: '#9a3412', display: 'block' }}>回路总电流 I</span>
          <strong style={{ fontSize: '15px', color: '#ea580c' }}>{iTotal.toFixed(2)} A</strong>
        </div>
        <div style={{ background: '#eff6ff', padding: '10px', borderRadius: '10px', border: '1px solid #bfdbfe', textAlign: 'center' }}>
          <span style={{ fontSize: '11px', color: '#1e40af', display: 'block' }}>分压 U₁ / U₂</span>
          <strong style={{ fontSize: '15px', color: '#2563eb' }}>{u1.toFixed(1)}V / {u2.toFixed(1)}V</strong>
        </div>
        <div style={{ background: '#fefce8', padding: '10px', borderRadius: '10px', border: '1px solid #fef08a', textAlign: 'center' }}>
          <span style={{ fontSize: '11px', color: '#854d0e', display: 'block' }}>总功率 P</span>
          <strong style={{ fontSize: '15px', color: '#ca8a04' }}>{totalPower.toFixed(2)} W</strong>
        </div>
      </div>

      {/* 启发式探究结论 */}
      {showExplanation ? (
        <div
          style={{
            background: '#faf5ff',
            border: '1px solid #e9d5ff',
            borderRadius: '10px',
            padding: '12px 14px',
            fontSize: '12.5px',
            lineHeight: 1.6,
            color: '#581c87',
            marginBottom: '16px',
          }}
        >
          <strong style={{ display: 'block', marginBottom: '4px', color: '#6b21a8' }}>
            💡 导师启发式思考（观察实验规律）：
          </strong>
          {circuitType === 'series' ? (
            <span>
              <strong>串联分压规律：</strong>电路中各处电流相等（I = {iTotal.toFixed(2)}A），电压按电阻阻值比例分配（
              U₁ : U₂ = {u1.toFixed(1)}V : {u2.toFixed(1)}V = {r1} : {r2}）。阻值越大的电阻分得的电压越高！
            </span>
          ) : (
            <span>
              <strong>并联分流规律：</strong>各支路两端电压相等（均为电源电压 {voltage.toFixed(1)}V），干路总阻小于任一分阻（
              R_total = {rTotal.toFixed(2)}Ω &lt; {Math.min(r1, r2)}Ω）。阻值越小的支路分得的电流越大！
            </span>
          )}
        </div>
      ) : null}

      {/* 提交成果给导师 */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={handleSubmitConclusion}
          disabled={disabled}
          style={{
            padding: '9px 20px',
            background: '#ea580c',
            color: '#ffffff',
            border: 'none',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 700,
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.6 : 1,
            boxShadow: '0 2px 6px rgba(234,88,12,0.3)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            transition: 'all 0.15s ease',
          }}
        >
          <span>提交动态电路探究结论 ↵</span>
        </button>
      </div>
    </div>
  );
}
