'use client';

import React, { useState, useMemo } from 'react';
import { diffractionPreview, scatteringPreview } from '../lib/opticsPreviewModel';

export interface OpticsDiffractionScatteringCardProps {
  disabled?: boolean;
  initialMode?: 'diffraction' | 'scattering';
  predictionGate?: {
    required: boolean;
    submitted: boolean;
    hypothesis?: string;
  };
  /** Returns true only after the server accepts and persists the action. */
  onAction?: (action: 'submit_prediction' | 'run' | 'record_observation', payload?: unknown) => void | Promise<boolean>;
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
  disabled = false,
  initialMode = 'diffraction',
  predictionGate,
  onAction,
}: OpticsDiffractionScatteringCardProps) {
  const [mode, setMode] = useState<'diffraction' | 'scattering'>(initialMode);
  const [selectedPrediction, setSelectedPrediction] = useState<string>('');
  const [isSubmittedLocal, setIsSubmittedLocal] = useState<boolean>(predictionGate?.submitted ?? false);

  const isPredictionLocked = (predictionGate?.required ?? false) && !isSubmittedLocal;

  const handleSubmitPrediction = async () => {
    if (!selectedPrediction) return;
    const accepted = await onAction?.('submit_prediction', {
      mode,
      hypothesis: selectedPrediction,
      parameters: mode === 'diffraction' ? { slitWidth, wavelength } : { particleRadius, scatteringWavelength },
    });
    // The server owns the prediction gate. Never unlock optimistically.
    if (accepted === true) setIsSubmittedLocal(true);
  };

  const handleRunSimulation = () => {
    if (isPredictionLocked || disabled) return;
    onAction?.('run', {
      mode,
      parameters: mode === 'diffraction' ? { slitWidth, wavelength, screenDistance } : { particleRadius, scatteringWavelength },
    });
  };

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
  const { centralBandWidthMm, firstMinAngleMrad } = diffractionPreview(wavelength, slitWidth, screenDistance);

  // 衍射光强分布曲线采样 (50 个点)
  const intensityPoints = useMemo(() => {
    const points: { x: number; y: number; intensity: number }[] = [];
    const spanMm = Math.max(30, centralBandWidthMm * 2.5);
    const steps = 60;
    for (let i = 0; i <= steps; i++) {
      const xMm = -spanMm + (2 * spanMm * i) / steps;
      const xM = xMm * 1e-3;
      const theta = Math.atan(xM / screenDistance);
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
  const { sizeParameter, isRayleigh, rayleighRatio } = scatteringPreview(scatteringWavelength, particleRadius);

  const beamColor = wavelengthToRgb(wavelength);
  const scatterColor = wavelengthToRgb(scatteringWavelength);

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
              光的散射与衍射模型预览
            </h4>
            <span style={{ fontSize: '12px', color: '#64748b' }}>
              仅为计算示意，不是真实测量；正式实验运行与观测保存尚未接入
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

      {/* POE 前置预测锁卡片 */}
      {predictionGate?.required && (
        <div
          style={{
            padding: '12px 14px',
            borderRadius: '8px',
            backgroundColor: isSubmittedLocal ? '#f0fdf4' : '#fffbeb',
            border: isSubmittedLocal ? '1px solid #bbf7d0' : '1px solid #fde68a',
            marginBottom: '14px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <span style={{ fontSize: '13px', fontWeight: 700, color: isSubmittedLocal ? '#166534' : '#92400e' }}>
              {isSubmittedLocal ? '✓ POE 前置预测已锁定' : '🔒 POE 前置预测锁：请先提出物理假设'}
            </span>
            <span style={{ fontSize: '11px', color: '#64748b' }}>
              {isSubmittedLocal ? '观察与预测比对中' : '运行仿真前必须提交'}
            </span>
          </div>

          {!isSubmittedLocal ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <p style={{ margin: 0, fontSize: '12.5px', color: '#475569' }}>
                {mode === 'diffraction'
                  ? '若保持激光波长不变，将狭缝宽度 a 缩小为原来的一半，中央明纹宽度将：'
                  : '在瑞利散射有效区域内，波长由 650nm (红光) 切换为 450nm (蓝光)，微粒散射光强将：'}
              </p>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                {(mode === 'diffraction'
                  ? ['A. 宽度增大一倍 (反比)', 'B. 宽度缩小一半 (正比)', 'C. 宽度保持不变']
                  : ['A. 显著增强 (与 λ⁴ 成反比)', 'B. 显著减弱', 'C. 强度保持不变']
                ).map((opt) => (
                  <label key={opt} style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="prediction-option"
                      value={opt}
                      checked={selectedPrediction === opt}
                      onChange={(e) => setSelectedPrediction(e.target.value)}
                    />
                    {opt}
                  </label>
                ))}
              </div>
              <button
                type="button"
                disabled={!selectedPrediction || disabled}
                onClick={handleSubmitPrediction}
                style={{
                  alignSelf: 'flex-start',
                  marginTop: '4px',
                  padding: '4px 12px',
                  fontSize: '12px',
                  borderRadius: '6px',
                  backgroundColor: selectedPrediction ? '#2563eb' : '#94a3b8',
                  color: '#ffffff',
                  border: 'none',
                  cursor: selectedPrediction ? 'pointer' : 'not-allowed',
                }}
              >
                确认预测并解锁仿真
              </button>
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: '12px', color: '#15803d' }}>
              已提交预测：“{predictionGate.hypothesis ?? selectedPrediction}”。请调节参数运行仿真，核验实测读数。
            </p>
          )}
        </div>
      )}

      {/* 参数控制区与仿真操作区（受预测锁控制） */}
      <div style={{ opacity: isPredictionLocked ? 0.45 : 1, pointerEvents: isPredictionLocked ? 'none' : 'auto' }}>
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
              <span style={{ color: '#38bdf8' }}>模型计算中央条纹宽度 Δx = {centralBandWidthMm.toFixed(2)} mm</span>
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
                  {isRayleigh ? '瑞利近似适用' : '超出本预览的瑞利近似域'}
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
              <span>封闭细雾室单色光散射示意（非真实实验操作）</span>
              <span style={{ color: isRayleigh ? '#60a5fa' : '#f59e0b' }}>
                {rayleighRatio === null ? `尺寸参数 x = ${sizeParameter.toFixed(3)}；不计算强度比` : `模型相对 700nm 散射比: ${rayleighRatio.toFixed(1)}x`}
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
                  background: scatterColor,
                  opacity: Math.min(1.0, 0.25 + (particleRadius / 100) * 0.7),
                  boxShadow: `0 0 16px ${scatterColor}`,
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
                {isRayleigh ? '瑞利近似下比较不同入射波长；单色散射光仍保持入射颜色' : '域外不推断米氏散射强度或颜色；单色散射不会自动变白'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 仿真运行与观测提交操作条 */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px', marginBottom: '8px' }}>
        <button
          type="button"
          disabled={isPredictionLocked || disabled}
          onClick={handleRunSimulation}
          style={{
            padding: '6px 16px',
            fontSize: '12px',
            fontWeight: 600,
            borderRadius: '6px',
            backgroundColor: isPredictionLocked ? '#cbd5e1' : '#059669',
            color: '#ffffff',
            border: 'none',
            cursor: isPredictionLocked ? 'not-allowed' : 'pointer',
          }}
        >
          {isPredictionLocked ? '请先提交预测以解锁运行' : '运行仿真并记录观测'}
        </button>
      </div>
      </div>

      <p role="note">此预览不保存观测，不提交作品证据，也不改变掌握度。真实实验须由教师审核安全方案。</p>
    </div>
  );
}
