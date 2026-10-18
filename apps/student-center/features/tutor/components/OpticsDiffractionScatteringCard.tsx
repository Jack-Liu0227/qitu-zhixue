'use client';

import React, { useState, useMemo } from 'react';

export interface OpticsDiffractionScatteringCardProps {
  onExperimentComplete?: (summary: string) => void;
  disabled?: boolean;
  initialMode?: 'diffraction' | 'scattering';
}

function wavelengthToRgb(wavelength: number): string {
  // Approximate RGB from wavelength (nm) between 380 and 780
  let r = 0;
  let g = 0;
  let b = 0;

  if (wavelength >= 380 && wavelength < 440) {
    r = -(wavelength - 440) / (440 - 380);
    g = 0.0;
    b = 1.0;
  } else if (wavelength >= 440 && wavelength < 490) {
    r = 0.0;
    g = (wavelength - 440) / (490 - 440);
    b = 1.0;
  } else if (wavelength >= 490 && wavelength < 510) {
    r = 0.0;
    g = 1.0;
    b = -(wavelength - 510) / (510 - 490);
  } else if (wavelength >= 510 && wavelength < 580) {
    r = (wavelength - 510) / (580 - 510);
    g = 1.0;
    b = 0.0;
  } else if (wavelength >= 580 && wavelength < 645) {
    r = 1.0;
    g = -(wavelength - 645) / (645 - 580);
    b = 0.0;
  } else if (wavelength >= 645 && wavelength <= 780) {
    r = 1.0;
    g = 0.0;
    b = 0.0;
  }

  const red = Math.round(Math.max(0, Math.min(255, r * 255)));
  const green = Math.round(Math.max(0, Math.min(255, g * 255)));
  const blue = Math.round(Math.max(0, Math.min(255, b * 255)));
  return `rgb(${red}, ${green}, ${blue})`;
}

export function OpticsDiffractionScatteringCard({
  onExperimentComplete,
  disabled = false,
  initialMode = 'diffraction',
}: OpticsDiffractionScatteringCardProps) {
  const [mode, setMode] = useState<'diffraction' | 'scattering'>(initialMode);

  // 单缝衍射实验参数
  const [wavelength, setWavelength] = useState<number>(632.8); // nm (氦氖激光红光)
  const [slitWidth, setSlitWidth] = useState<number>(50); // um (狭缝宽度 a)
  const [screenDistance, setScreenDistance] = useState<number>(1.0); // m (狭缝到光屏距离 D)

  // 介质散射实验参数
  const [particleRadius, setParticleRadius] = useState<number>(25); // nm (微粒半径 r)
  const [scatteringWavelength, setScatteringWavelength] = useState<number>(450); // nm

  // 衍射物理计算
  const lambdaM = wavelength * 1e-9;
  const slitWidthM = slitWidth * 1e-6;
  const centralBandWidthMm = (2 * lambdaM * screenDistance) / slitWidthM * 1000;
  const firstMinAngleMrad = (lambdaM / slitWidthM) * 1000;

  // 衍射光强分布曲线采样 (50 个点)
  const intensityPoints = useMemo(() => {
    const points: { x: number; y: number; intensity: number }[] = [];
    const spanMm = Math.max(30, centralBandWidthMm * 2.5);
    const steps = 60;
    for (let i = 0; i <= steps; i++) {
      const xMm = -spanMm + (2 * spanMm * i) / steps;
      const xM = xMm * 1e-3;
      const theta = xM / screenDistance;
      const beta = (Math.PI * slitWidthM * Math.sin(theta)) / lambdaM;
      let intensity = 1.0;
      if (Math.abs(beta) > 1e-5) {
        intensity = Math.pow(Math.sin(beta) / beta, 2);
      }
      points.push({
        x: (i / steps) * 360 + 20,
        y: 85 - intensity * 65,
        intensity,
      });
    }
    return points;
  }, [wavelength, slitWidth, screenDistance, centralBandWidthMm, lambdaM, slitWidthM]);

  const intensitySvgPath = useMemo(() => {
    if (intensityPoints.length === 0) return '';
    return intensityPoints.reduce((acc, pt, idx) => {
      return idx === 0 ? `M ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}` : `${acc} L ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
    }, '');
  }, [intensityPoints]);

  // 散射物理计算
  const sizeParameter = (2 * Math.PI * (particleRadius * 1e-9)) / (scatteringWavelength * 1e-9);
  const isRayleigh = sizeParameter < 0.1;
  const rayleighRatio = Math.pow(700 / scatteringWavelength, 4);

  const beamColor = wavelengthToRgb(wavelength);
  const scatterColor = wavelengthToRgb(scatteringWavelength);

  const handleCommitSummary = () => {
    let summary = '';
    if (mode === 'diffraction') {
      summary = `【单缝衍射实验】波长 ${wavelength} nm，缝宽 ${slitWidth} μm，屏距 ${screenDistance} m。实测中央明条纹宽度 Δx = ${centralBandWidthMm.toFixed(2)} mm，第一级极小衍射角 θ₁ = ${firstMinAngleMrad.toFixed(2)} mrad。验证规律：缝宽越小、波长越长，衍射越明显。`;
    } else {
      summary = `【介质散射实验】波长 ${scatteringWavelength} nm，微粒半径 ${particleRadius} nm，尺寸参数 x = ${sizeParameter.toFixed(3)}。判定属于${isRayleigh ? '瑞利散射 (I ∝ 1/λ⁴，蓝紫光强烈散射)' : '米氏散射 (各波长均匀散射，呈乳白色)'}，相对 700nm 红光散射比为 ${rayleighRatio.toFixed(2)} 倍。`;
    }
    onExperimentComplete?.(summary);
  };

  return (
    <div
      style={{
        margin: '16px 0',
        padding: '18px',
        background: '#ffffff',
        border: '1.5px solid #93c5fd',
        borderRadius: '16px',
        boxShadow: '0 6px 20px rgba(37,99,235,0.08)',
      }}
    >
      {/* 标题栏与模式切换 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '20px' }}>🌈</span>
          <div>
            <h4 style={{ margin: 0, fontSize: '15px', color: '#102a5c', fontWeight: 700 }}>
              光的散射与衍射动态探究台 (PBL 核心模块)
            </h4>
            <span style={{ fontSize: '12px', color: '#64748b' }}>
              结合 OpenMAIC 多模态仿真与 DeepTutor 变量引导，探索光的波动性与微粒特征
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setMode('diffraction')}
            style={{
              padding: '4px 10px',
              fontSize: '12px',
              fontWeight: 600,
              borderRadius: '6px',
              border: 'none',
              cursor: disabled ? 'not-allowed' : 'pointer',
              background: mode === 'diffraction' ? '#2563eb' : '#e2e8f0',
              color: mode === 'diffraction' ? '#ffffff' : '#334155',
            }}
          >
            单缝衍射仿真
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setMode('scattering')}
            style={{
              padding: '4px 10px',
              fontSize: '12px',
              fontWeight: 600,
              borderRadius: '6px',
              border: 'none',
              cursor: disabled ? 'not-allowed' : 'pointer',
              background: mode === 'scattering' ? '#2563eb' : '#e2e8f0',
              color: mode === 'scattering' ? '#ffffff' : '#334155',
            }}
          >
            介质散射仿真
          </button>
        </div>
      </div>

      {mode === 'diffraction' ? (
        <div>
          {/* 单缝衍射参数控制区 */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '12px',
              background: '#f8fafc',
              padding: '12px',
              borderRadius: '10px',
              border: '1px solid #e2e8f0',
              marginBottom: '14px',
            }}
          >
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                <span style={{ color: '#475569', fontWeight: 600 }}>波长 λ: {wavelength} nm</span>
                <span style={{ color: beamColor, fontWeight: 700 }}>● 光源色</span>
              </div>
              <input
                type="range"
                min="400"
                max="750"
                step="5"
                value={wavelength}
                disabled={disabled}
                onChange={(e) => setWavelength(Number(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                <span style={{ color: '#475569', fontWeight: 600 }}>狭缝宽度 a: {slitWidth} μm</span>
                <span style={{ color: '#0284c7' }}>{slitWidth <= 50 ? '明显衍射' : '弱衍射'}</span>
              </div>
              <input
                type="range"
                min="10"
                max="200"
                step="5"
                value={slitWidth}
                disabled={disabled}
                onChange={(e) => setSlitWidth(Number(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                <span style={{ color: '#475569', fontWeight: 600 }}>屏距 D: {screenDistance.toFixed(1)} m</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="2.0"
                step="0.1"
                value={screenDistance}
                disabled={disabled}
                onChange={(e) => setScreenDistance(Number(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>
          </div>

          {/* 光强曲线与仿真衍射光斑 */}
          <div
            style={{
              background: '#090d16',
              borderRadius: '12px',
              padding: '14px',
              marginBottom: '12px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', fontSize: '11.5px', marginBottom: '8px' }}>
              <span>光屏上光强分布理论曲线 I(θ) = I₀(sinβ/β)²</span>
              <span style={{ color: '#38bdf8' }}>中央条纹宽度 Δx = {centralBandWidthMm.toFixed(2)} mm</span>
            </div>

            <svg width="100%" height="95" viewBox="0 0 400 95" style={{ display: 'block' }}>
              {/* 基准轴 */}
              <line x1="20" y1="85" x2="380" y2="85" stroke="#334155" strokeWidth="1" />
              <line x1="200" y1="10" x2="200" y2="85" stroke="#334155" strokeWidth="1" strokeDasharray="3 3" />

              {/* 光强曲线 */}
              <path d={intensitySvgPath} fill="none" stroke={beamColor} strokeWidth="2.5" />

              {/* 视觉光斑渲染 */}
              <defs>
                <linearGradient id="slitFringeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor={beamColor} stopOpacity="0" />
                  <stop offset="35%" stopColor={beamColor} stopOpacity="0.25" />
                  <stop offset="45%" stopColor={beamColor} stopOpacity="0.9" />
                  <stop offset="50%" stopColor={beamColor} stopOpacity="1" />
                  <stop offset="55%" stopColor={beamColor} stopOpacity="0.9" />
                  <stop offset="65%" stopColor={beamColor} stopOpacity="0.25" />
                  <stop offset="100%" stopColor={beamColor} stopOpacity="0" />
                </linearGradient>
              </defs>
            </svg>

            {/* 模拟光学暗室中的衍射条纹条带 */}
            <div
              style={{
                marginTop: '10px',
                height: '24px',
                borderRadius: '4px',
                background: `radial-gradient(ellipse at center, ${beamColor} 0%, rgba(0,0,0,0.85) 75%)`,
                boxShadow: `0 0 15px ${beamColor}40`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <span style={{ fontSize: '10.5px', color: '#ffffff', opacity: 0.85, textShadow: '0 0 4px #000' }}>
                中央极大区（宽度随着狭缝宽度减小而展宽）
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div>
          {/* 介质散射参数控制区 */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '12px',
              background: '#f8fafc',
              padding: '12px',
              borderRadius: '10px',
              border: '1px solid #e2e8f0',
              marginBottom: '14px',
            }}
          >
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                <span style={{ color: '#475569', fontWeight: 600 }}>入射波长 λ: {scatteringWavelength} nm</span>
                <span style={{ color: scatterColor, fontWeight: 700 }}>● 光束色</span>
              </div>
              <input
                type="range"
                min="400"
                max="750"
                step="5"
                value={scatteringWavelength}
                disabled={disabled}
                onChange={(e) => setScatteringWavelength(Number(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                <span style={{ color: '#475569', fontWeight: 600 }}>微粒半径 r: {particleRadius} nm</span>
                <span style={{ color: isRayleigh ? '#2563eb' : '#d97706', fontWeight: 600 }}>
                  {isRayleigh ? '微粒 << λ (瑞利散射)' : '微粒 ≥ λ (米氏散射)'}
                </span>
              </div>
              <input
                type="range"
                min="5"
                max="300"
                step="5"
                value={particleRadius}
                disabled={disabled}
                onChange={(e) => setParticleRadius(Number(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>
          </div>

          {/* 散射模拟暗室 */}
          <div
            style={{
              background: '#090d16',
              borderRadius: '12px',
              padding: '14px',
              marginBottom: '12px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', fontSize: '11.5px', marginBottom: '8px' }}>
              <span>密闭水雾槽与激光光路观察 (丁达尔效应与波长反比)</span>
              <span style={{ color: isRayleigh ? '#60a5fa' : '#f59e0b' }}>
                相对 700nm 散射比: {rayleighRatio.toFixed(1)}x
              </span>
            </div>

            <div
              style={{
                position: 'relative',
                height: '75px',
                borderRadius: '8px',
                background: 'linear-gradient(90deg, #1e293b 0%, #0f172a 100%)',
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                padding: '0 20px',
              }}
            >
              {/* 光束轨迹 */}
              <div
                style={{
                  width: '100%',
                  height: '6px',
                  background: isRayleigh ? scatterColor : '#f1f5f9',
                  opacity: Math.min(1.0, 0.25 + (particleRadius / 100) * 0.7),
                  boxShadow: `0 0 16px ${isRayleigh ? scatterColor : '#ffffff'}`,
                  borderRadius: '3px',
                }}
              />
              <span
                style={{
                  position: 'absolute',
                  right: '20px',
                  bottom: '10px',
                  fontSize: '11px',
                  color: '#94a3b8',
                }}
              >
                {isRayleigh ? '晴空散射原理：蓝紫光被强烈散射 (I ∝ 1/λ⁴)' : '白云/大雾原理：大颗粒对各色光无差别散射'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 提交探究结论按钮 */}
      <button
        type="button"
        disabled={disabled}
        onClick={handleCommitSummary}
        style={{
          width: '100%',
          padding: '10px 16px',
          background: disabled ? '#94a3b8' : 'linear-gradient(135deg, #1d4ed8 0%, #2563eb 100%)',
          color: '#ffffff',
          fontWeight: 600,
          fontSize: '13.5px',
          border: 'none',
          borderRadius: '10px',
          cursor: disabled ? 'not-allowed' : 'pointer',
          boxShadow: '0 4px 12px rgba(37,99,235,0.2)',
          transition: 'all 0.2s ease',
        }}
      >
        ✔ 提交光学实验探究数据至作品证据链
      </button>
    </div>
  );
}
