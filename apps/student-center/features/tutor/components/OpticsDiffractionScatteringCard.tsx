'use client';

import { VisualAsset } from '@qitu/ui';

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { diffractionPreview, scatteringPreview } from '../lib/opticsPreviewModel';
import { createIdempotencyKey } from '../idempotency';
import type { TutorExperimentActionResponse } from '@qitu/contracts';

export interface OpticsDiffractionScatteringCardProps {
  savedObservation?: TutorExperimentActionResponse['observationReceipt'];
  disabled?: boolean;
  initialMode?: 'diffraction' | 'scattering';
  initialParameters?: Record<string, number>;
  allowedModels?: readonly ('diffraction' | 'scattering')[];
  predictionGate?: {
    required: boolean;
    submitted: boolean;
    hypothesis?: string;
  };
  /** Returns true only after the server accepts and persists the action. */
  onAction?: (
    action: 'submit_prediction' | 'run' | 'record_observation',
    payload: unknown,
    idempotencyKey: string,
  ) => void | Promise<boolean | TutorExperimentActionResponse>;
}

function wavelengthToRgb(wavelength: number): { r: number; g: number; b: number; css: string } {
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

  // Intensity factor falloff near vision limits
  let factor = 1.0;
  if (wavelength >= 380 && wavelength < 420) {
    factor = 0.3 + 0.7 * (wavelength - 380) / (420 - 380);
  } else if (wavelength > 700 && wavelength <= 780) {
    factor = 0.3 + 0.7 * (780 - wavelength) / (780 - 700);
  }

  const red = Math.round(Math.max(0, Math.min(255, r * factor * 255)));
  const green = Math.round(Math.max(0, Math.min(255, g * factor * 255)));
  const blue = Math.round(Math.max(0, Math.min(255, b * factor * 255)));

  return { r: red, g: green, b: blue, css: `rgb(${red}, ${green}, ${blue})` };
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
}

export function OpticsDiffractionScatteringCard({
  disabled = false,
  initialMode = 'diffraction',
  initialParameters,
  allowedModels = ['diffraction', 'scattering'],
  predictionGate,
  onAction,
  savedObservation,
}: OpticsDiffractionScatteringCardProps) {
  const parameter = (name: string, fallback: number, min: number, max: number) => {
    const value = initialParameters?.[name];
    return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fallback;
  };
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<'diffraction' | 'scattering'>(initialMode);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [selectedPrediction, setSelectedPrediction] = useState<string>('');
  const [isSubmittedLocal, setIsSubmittedLocal] = useState<boolean>(predictionGate?.submitted ?? false);
  const [isAnimating, setIsAnimating] = useState<boolean>(true);
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [runAccepted, setRunAccepted] = useState(false);
  const runActionIdRef = useRef<string | null>(null);
  const [observationAccepted, setObservationAccepted] = useState(false);
  const [observation, setObservation] = useState('');
  const [serverSimulationSummary, setServerSimulationSummary] = useState<string | null>(null);
  const actionKeysRef = useRef(new Map<string, string>());

  const dispatchAction = useCallback(async (
    action: 'submit_prediction' | 'run' | 'record_observation',
    payload: unknown,
  ) => {
    if (!onAction) return false;
    const fingerprint = `${action}:${JSON.stringify(payload)}`;
    const idempotencyKey = actionKeysRef.current.get(fingerprint) ?? createIdempotencyKey();
    actionKeysRef.current.set(fingerprint, idempotencyKey);
    const result = await onAction(action, payload, idempotencyKey);
    let accepted = typeof result === 'boolean' ? result : result?.accepted === true;
    if (action === 'run') {
      accepted = typeof result === 'object' && result.accepted && result.action === 'run' && !!result.actionId;
      if (accepted && typeof result === 'object') runActionIdRef.current = result.actionId;
    }
    if (action === 'record_observation') {
      const receipt = typeof result === 'object' ? result.observationReceipt : undefined;
      accepted = !!(receipt && receipt.observationId && receipt.evidenceRef
        && receipt.runActionId === runActionIdRef.current
        && receipt.provenance === 'simulated_observation'
        && receipt.planId && Number.isSafeInteger(receipt.planRevision) && receipt.savedAt);
    }
    if (accepted) actionKeysRef.current.delete(fingerprint);
    if (typeof result === 'object' && result?.simulationResult?.summary) {
      setServerSimulationSummary(result.simulationResult.summary);
    }
    return accepted;
  }, [onAction]);

  // 单缝衍射实验物理参数
  const [wavelength, setWavelength] = useState<number>(() => initialMode === 'diffraction' ? parameter('wavelength', 632.8, 400, 750) : 632.8); // nm (氦氖红光)
  const [slitWidth, setSlitWidth] = useState<number>(() => parameter('slitWidth', 50, 10, 200)); // um (狭缝宽度 a)
  const [screenDistance, setScreenDistance] = useState<number>(() => parameter('screenDistance', 1, 0.5, 2)); // m (狭缝到光屏 D)

  // 介质散射实验物理参数
  const [particleRadius, setParticleRadius] = useState<number>(() => parameter('particleRadius', 5, 5, 300)); // nm (微粒半径 r)
  const [scatteringWavelength, setScatteringWavelength] = useState<number>(() => initialMode === 'scattering' ? parameter('wavelength', 450, 400, 750) : 450); // nm (蓝光)

  useEffect(() => {
    runActionIdRef.current = null;
    setRunAccepted(false);
    setObservationAccepted(false);
    setObservation('');
    setServerSimulationSummary(null);
  }, [mode, wavelength, slitWidth, screenDistance, particleRadius, scatteringWavelength]);

  // 交互式探测标尺位置 (mm) 与探测值
  const [probeXMm, setProbeXMm] = useState<number | null>(null);

  const isPredictionLocked = (predictionGate?.required ?? false) && !isSubmittedLocal;

  const handleSubmitPrediction = async () => {
    if (!selectedPrediction) return;
    setActionPending(true);
    setActionError(null);
    try {
      const accepted = await dispatchAction('submit_prediction', {
        mode,
        hypothesis: selectedPrediction,
        parameters: mode === 'diffraction' ? { slitWidth, wavelength } : { particleRadius, wavelength: scatteringWavelength },
      });
      if (accepted) setIsSubmittedLocal(true);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '预测提交失败，请重试');
    } finally {
      setActionPending(false);
    }
  };

  const currentParameters = () => mode === 'diffraction'
    ? { slitWidth, wavelength, screenDistance }
    : { particleRadius, wavelength: scatteringWavelength };

  const handleRunSimulation = async () => {
    if (isPredictionLocked || disabled || actionPending) return;
    setActionPending(true);
    setActionError(null);
    setObservationAccepted(false);
    try {
      const accepted = await dispatchAction('run', { mode, parameters: currentParameters() });
      if (accepted) setRunAccepted(true);
      else setActionError('服务器未确认仿真操作，尚未记录');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '仿真操作失败，请重试');
    } finally {
      setActionPending(false);
    }
  };

  const handleRecordObservation = async () => {
    if (!runAccepted || disabled || actionPending) return;
    setActionPending(true);
    setActionError(null);
    try {
      const accepted = await dispatchAction('record_observation', {
        mode, parameters: currentParameters(), runActionId: runActionIdRef.current, observation,
      });
      if (accepted) setObservationAccepted(true);
      else setActionError('服务器未确认观察记录，尚未保存');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '观察记录失败，请重试');
    } finally {
      setActionPending(false);
    }
  };

  // 衍射物理计算
  const lambdaM = wavelength * 1e-9;
  const slitWidthM = slitWidth * 1e-6;
  const { centralBandWidthMm, firstMinAngleMrad } = diffractionPreview(wavelength, slitWidth, screenDistance);

  // 散射物理计算
  const { sizeParameter, isRayleigh, rayleighRatio } = scatteringPreview(scatteringWavelength, particleRadius);

  const beamColor = useMemo(() => wavelengthToRgb(wavelength), [wavelength]);
  const scatterColor = useMemo(() => wavelengthToRgb(scatteringWavelength), [scatteringWavelength]);

  // 衍射光强分布理论曲线采样 (100 点，覆盖中央明纹及两侧次极大)
  const spanMm = Math.max(25, centralBandWidthMm * 2.2);
  const intensityCurvePoints = useMemo(() => {
    const points: { xMm: number; px: number; py: number; intensity: number }[] = [];
    const steps = 120;
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
        xMm,
        px: (i / steps) * 440 + 20,
        py: 88 - intensity * 72,
        intensity,
      });
    }
    return points;
  }, [wavelength, slitWidth, screenDistance, spanMm, lambdaM, slitWidthM]);

  const intensitySvgPath = useMemo(() => {
    if (intensityCurvePoints.length === 0) return '';
    return intensityCurvePoints.reduce((acc, pt, idx) => {
      return idx === 0 ? `M ${pt.px.toFixed(1)} ${pt.py.toFixed(1)}` : `${acc} L ${pt.px.toFixed(1)} ${pt.py.toFixed(1)}`;
    }, '');
  }, [intensityCurvePoints]);

  // 探测光标处的实时物理量
  const probeData = useMemo(() => {
    if (probeXMm === null) return null;
    const xM = probeXMm * 1e-3;
    const theta = Math.atan(xM / screenDistance);
    const beta = (Math.PI * slitWidthM * Math.sin(theta)) / lambdaM;
    let intensity = 1.0;
    if (Math.abs(beta) > 1e-5) {
      intensity = Math.pow(Math.sin(beta) / beta, 2);
    }
    const thetaMrad = theta * 1000;
    const halfWidth = centralBandWidthMm / 2;

    let regionLabel = '高阶衍射区';
    if (Math.abs(probeXMm) <= halfWidth) {
      regionLabel = `中央主极大区 (宽 ${centralBandWidthMm.toFixed(2)} mm)`;
    } else if (Math.abs(Math.abs(probeXMm) - halfWidth) < 0.8) {
      regionLabel = '第一级暗纹 (极小点)';
    } else if (Math.abs(Math.abs(probeXMm) - 1.43 * halfWidth) < 1.0) {
      regionLabel = '第一级次极大明纹 (I ≈ 4.7%)';
    }

    return {
      xMm: probeXMm,
      intensityPercent: (intensity * 100).toFixed(1),
      thetaMrad: thetaMrad.toFixed(2),
      regionLabel,
    };
  }, [probeXMm, screenDistance, slitWidthM, lambdaM, centralBandWidthMm]);

  // Canvas 实时干涉衍射条纹物理渲染
  const fringeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const benchCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const animPhaseRef = useRef<number>(0);

  // 绘制光屏上的连续干涉条纹 (光强分布物理着色)
  const drawFringeCanvas = useCallback(() => {
    const canvas = fringeCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    // 背景底色：暗室无光状态
    ctx.fillStyle = '#05070c';
    ctx.fillRect(0, 0, width, height);

    const halfWidth = width / 2;
    const { r, g, b } = beamColor;

    // 针对每个水平像素列逐列计算衍射振幅与光强
    const imgData = ctx.createImageData(width, height);
    const data = imgData.data;

    for (let px = 0; px < width; px++) {
      const xMm = ((px - halfWidth) / halfWidth) * spanMm;
      const xM = xMm * 1e-3;
      const theta = Math.atan(xM / screenDistance);
      const beta = (Math.PI * slitWidthM * Math.sin(theta)) / lambdaM;
      let intensity = 1.0;
      if (Math.abs(beta) > 1e-5) {
        intensity = Math.pow(Math.sin(beta) / beta, 2);
      }

      // 非线性感知增强伽马校正，使次极大条纹清晰可见
      const visibleBrightness = Math.pow(intensity, 0.65);
      const colR = Math.min(255, Math.round(r * visibleBrightness));
      const colG = Math.min(255, Math.round(g * visibleBrightness));
      const colB = Math.min(255, Math.round(b * visibleBrightness));
      const alpha = Math.min(255, Math.round(255 * (0.05 + 0.95 * visibleBrightness)));

      for (let py = 0; py < height; py++) {
        const idx = (py * width + px) * 4;
        data[idx] = colR;
        data[idx + 1] = colG;
        data[idx + 2] = colB;
        data[idx + 3] = alpha;
      }
    }

    ctx.putImageData(imgData, 0, 0);

    // 标尺网格与中央极大标记
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(halfWidth, 0);
    ctx.lineTo(halfWidth, height);
    ctx.stroke();

    // 中央极大宽度括号标记
    const halfBandPx = (centralBandWidthMm / 2 / spanMm) * halfWidth;
    const min1Px = halfWidth - halfBandPx;
    const min2Px = halfWidth + halfBandPx;

    if (min1Px >= 0 && min2Px <= width) {
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 2]);
      ctx.beginPath();
      ctx.moveTo(min1Px, 0);
      ctx.lineTo(min1Px, height);
      ctx.moveTo(min2Px, 0);
      ctx.lineTo(min2Px, height);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 探针线
    if (probeXMm !== null) {
      const probePx = halfWidth + (probeXMm / spanMm) * halfWidth;
      if (probePx >= 0 && probePx <= width) {
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(probePx, 0);
        ctx.lineTo(probePx, height);
        ctx.stroke();
      }
    }
  }, [beamColor, spanMm, screenDistance, slitWidthM, lambdaM, centralBandWidthMm, probeXMm]);

  // 光路台动画模拟 (激光束 -> 单缝光阑开合 -> 惠更斯子波衍射波面 -> 光屏)
  const drawBenchCanvas = useCallback(() => {
    const canvas = benchCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    // 深色光学实验暗台背景
    ctx.fillStyle = '#0a0f1d';
    ctx.fillRect(0, 0, width, height);

    const laserX = 50;
    const slitX = 140;
    const screenX = width - 40;
    const centerY = height / 2;
    const phase = animPhaseRef.current;

    // 1. 激光发射器外壳
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1.5;
    ctx.fillRect(10, centerY - 18, 40, 36);
    ctx.strokeRect(10, centerY - 18, 40, 36);

    // 发射器状态灯与铭牌
    ctx.fillStyle = beamColor.css;
    ctx.beginPath();
    ctx.arc(42, centerY, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px monospace';
    ctx.fillText('LASER', 14, centerY - 6);

    // 2. 发射器至狭缝的准直单色光束
    const beamGrad = ctx.createLinearGradient(laserX, centerY, slitX, centerY);
    beamGrad.addColorStop(0, beamColor.css);
    beamGrad.addColorStop(1, beamColor.css);
    ctx.strokeStyle = beamGrad;
    ctx.lineWidth = 4;
    ctx.shadowColor = beamColor.css;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(laserX, centerY);
    ctx.lineTo(slitX, centerY);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // 3. 可调狭缝挡板 (双金属刀口，开合宽度与 a 成比例)
    const gapPx = Math.max(4, Math.min(28, (slitWidth / 200) * 28));
    ctx.fillStyle = '#334155';
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 1;
    // 上刀口
    ctx.fillRect(slitX - 4, 0, 8, centerY - gapPx / 2);
    ctx.strokeRect(slitX - 4, 0, 8, centerY - gapPx / 2);
    // 下刀口
    ctx.fillRect(slitX - 4, centerY + gapPx / 2, 8, height - (centerY + gapPx / 2));
    ctx.strokeRect(slitX - 4, centerY + gapPx / 2, 8, height - (centerY + gapPx / 2));

    // 狭缝宽度标注
    ctx.fillStyle = '#38bdf8';
    ctx.font = '10px sans-serif';
    ctx.fillText(`a=${slitWidth}μm`, slitX - 18, centerY - gapPx / 2 - 8);

    // 4. 狭缝到光屏的惠更斯-菲涅耳波动光场波阵面动画
    const maxR = screenX - slitX;
    const waveCount = 5;
    for (let w = 0; w < waveCount; w++) {
      const r = ((phase * 25 + w * 28) % maxR) + 6;
      const alpha = Math.max(0, 1 - r / maxR);
      ctx.strokeStyle = beamColor.css;
      ctx.globalAlpha = alpha * 0.45;
      ctx.lineWidth = 2;
      ctx.beginPath();
      // 根据衍射角展开
      const maxAngle = Math.PI / 3.2;
      ctx.arc(slitX, centerY, r, -maxAngle, maxAngle);
      ctx.stroke();
    }
    ctx.globalAlpha = 1.0;

    // 5. 观察屏 (带有光强分布条带小投影)
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 2;
    ctx.fillRect(screenX, 10, 8, height - 20);
    ctx.strokeRect(screenX, 10, 8, height - 20);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px sans-serif';
    ctx.fillText(`D=${screenDistance.toFixed(1)}m`, screenX - 24, height - 8);
  }, [beamColor, slitWidth, screenDistance]);

  // 散射暗室 Canvas (动态气溶胶微粒悬浮与布朗运动仿真)
  const scatterCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const particlesRef = useRef<Particle[]>([]);

  // 初始化细雾室微粒
  useEffect(() => {
    const list: Particle[] = [];
    for (let i = 0; i < 70; i++) {
      list.push({
        x: Math.random() * 480,
        y: Math.random() * 120,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.35,
        size: 1.5 + Math.random() * 2.0,
      });
    }
    particlesRef.current = list;
  }, []);

  // 绘制介质散射暗室与粒子动态光晕
  const drawScatterCanvas = useCallback(() => {
    const canvas = scatterCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    // 密闭细雾暗室
    ctx.fillStyle = '#080d1a';
    ctx.fillRect(0, 0, width, height);

    const centerY = height / 2;
    const beamThickness = 14;

    // 1. 入射激光束在细雾中的丁达尔光路通量
    // 瑞利散射散射光强正比于 1 / λ^4
    const lambdaFactor = Math.pow(700 / scatteringWavelength, 4);
    const beamAlpha = isRayleigh
      ? Math.min(0.9, 0.15 + (particleRadius / 100) * 0.15 * lambdaFactor)
      : Math.min(0.85, 0.2 + (particleRadius / 200) * 0.4);

    const laserGrad = ctx.createLinearGradient(0, centerY - beamThickness / 2, 0, centerY + beamThickness / 2);
    laserGrad.addColorStop(0, 'rgba(0,0,0,0)');
    laserGrad.addColorStop(0.5, scatterColor.css);
    laserGrad.addColorStop(1, 'rgba(0,0,0,0)');

    ctx.fillStyle = laserGrad;
    ctx.globalAlpha = beamAlpha;
    ctx.fillRect(0, centerY - beamThickness / 2, width, beamThickness);
    ctx.globalAlpha = 1.0;

    // 2. 悬浮微粒布朗运动与受光散射粒子光斑
    const particles = particlesRef.current;
    for (const p of particles) {
      if (isAnimating) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = width;
        if (p.x > width) p.x = 0;
        if (p.y < 0) p.y = height;
        if (p.y > height) p.y = 0;
      }

      const distToBeam = Math.abs(p.y - centerY);
      const inBeam = distToBeam < beamThickness;

      if (inBeam) {
        // 微粒受到激光照射发生散射，发出带散射光晕的单色散射光
        const scatterGlowRadius = isRayleigh ? p.size * (1 + lambdaFactor * 0.6) : p.size * 2.5;
        const radial = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, Math.min(18, scatterGlowRadius * 2.5));
        radial.addColorStop(0, scatterColor.css);
        radial.addColorStop(0.4, scatterColor.css);
        radial.addColorStop(1, 'rgba(0,0,0,0)');

        ctx.fillStyle = radial;
        ctx.globalAlpha = isRayleigh ? Math.min(0.95, 0.4 + lambdaFactor * 0.15) : 0.65;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.min(18, scatterGlowRadius * 2.5), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1.0;

        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 0.6, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // 光束外的游离微观细雾暗粒子
        ctx.fillStyle = 'rgba(148, 163, 184, 0.25)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 容器外壁反光与刻度
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, width - 2, height - 2);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px sans-serif';
    ctx.fillText('封闭细雾室 (封闭气溶胶腔体)', 12, 16);
  }, [scatteringWavelength, particleRadius, isRayleigh, scatterColor, isAnimating]);

  // 60FPS 动画循环更新
  useEffect(() => {
    let active = true;

    const renderLoop = () => {
      if (!active) return;
      if (isAnimating) {
        animPhaseRef.current = (animPhaseRef.current + 0.03) % 100;
      }
      if (mode === 'diffraction') {
        drawFringeCanvas();
        drawBenchCanvas();
      } else {
        drawScatterCanvas();
      }
      animFrameRef.current = requestAnimationFrame(renderLoop);
    };

    renderLoop();

    return () => {
      active = false;
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [mode, isAnimating, drawFringeCanvas, drawBenchCanvas, drawScatterCanvas]);

  // 鼠标在光屏条纹上移动时更新探针位置
  const handleFringeMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = fringeCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const width = rect.width;
    const xMm = ((px - width / 2) / (width / 2)) * spanMm;
    setProbeXMm(Math.round(xMm * 10) / 10);
  };

  const handleFringeMouseLeave = () => {
    setProbeXMm(null);
  };

  const toggleFullscreen = useCallback(async () => {
    const card = cardRef.current;
    if (!card || typeof document === 'undefined') return;
    try {
      if (document.fullscreenElement === card) {
        await document.exitFullscreen?.();
      } else if (card.requestFullscreen) {
        await card.requestFullscreen();
      } else {
        // Older embedded browsers do not expose Fullscreen API; keep a
        // viewport-sized fallback so the experiment remains usable.
        setIsFullscreen((value) => !value);
      }
    } catch {
      setIsFullscreen((value) => !value);
    }
  }, []);

  useEffect(() => {
    const syncFullscreen = () => setIsFullscreen(document.fullscreenElement === cardRef.current);
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  return (
    <div
      ref={cardRef}
      className={isFullscreen ? 'qitu-optics-card qitu-optics-experiment-card is-fullscreen' : 'qitu-optics-card qitu-optics-experiment-card'}
      style={{
        margin: '16px 0',
        padding: '20px',
        background: '#ffffff',
        border: '1.5px solid #93c5fd',
        borderRadius: '16px',
        boxShadow: '0 8px 24px rgba(37,99,235,0.08)',
        ...(isFullscreen ? { overflow: 'auto', height: '100dvh', margin: 0, borderRadius: 0 } : {}),
      }}
    >
      {/* 顶部标题栏与模式切换 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <VisualAsset assetId="subject-physics-v1" size={28} />
          <div>
            <h4 style={{ margin: 0, fontSize: '16px', color: '#102a5c', fontWeight: 700 }}>
              光的散射与衍射模型预览
            </h4>
            <span style={{ fontSize: '12px', color: '#64748b' }}>
              {disabled ? '仅为计算示意，不是真实测量；当前仅可预览' : '受限模型仿真；模拟观察保存须取得服务端回执，不代表真实测量'}
            </span>
          </div>
        </div>

        {/* 模式选择按钮组 */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => void toggleFullscreen()}
            aria-pressed={isFullscreen}
            aria-label={isFullscreen ? '退出全屏实验' : '全屏查看实验'}
            style={{
              padding: '6px 10px',
              fontSize: '12px',
              borderRadius: '8px',
              border: '1px solid #bfdbfe',
              background: '#eff6ff',
              color: '#1d4ed8',
              cursor: 'pointer',
            }}
          >
            {isFullscreen ? '退出全屏' : '全屏查看'}
          </button>
          <button
            type="button"
            disabled={disabled || actionPending || !allowedModels.includes('diffraction')}
            onClick={() => { setMode('diffraction'); setIsSubmittedLocal(false); setSelectedPrediction(''); }}
            style={{
              padding: '6px 14px',
              fontSize: '12.5px',
              fontWeight: 600,
              borderRadius: '8px',
              border: 'none',
              cursor: disabled ? 'not-allowed' : 'pointer',
              background: mode === 'diffraction' ? '#2563eb' : '#e2e8f0',
              color: mode === 'diffraction' ? '#ffffff' : '#334155',
              transition: 'all 0.15s ease',
            }}
          >
            单缝衍射仿真
          </button>
          <button
            type="button"
            disabled={disabled || actionPending || !allowedModels.includes('scattering')}
            onClick={() => { setMode('scattering'); setIsSubmittedLocal(false); setSelectedPrediction(''); }}
            style={{
              padding: '6px 14px',
              fontSize: '12.5px',
              fontWeight: 600,
              borderRadius: '8px',
              border: 'none',
              cursor: disabled ? 'not-allowed' : 'pointer',
              background: mode === 'scattering' ? '#2563eb' : '#e2e8f0',
              color: mode === 'scattering' ? '#ffffff' : '#334155',
              transition: 'all 0.15s ease',
            }}
          >
            介质散射仿真
          </button>
          <button
            type="button"
            onClick={() => setIsAnimating(!isAnimating)}
            title={isAnimating ? '暂停微观动画' : '播放微观动画'}
            style={{
              padding: '6px 10px',
              fontSize: '12px',
              fontWeight: 600,
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              cursor: 'pointer',
              background: isAnimating ? '#f0fdf4' : '#fff7ed',
              color: isAnimating ? '#166534' : '#c2410c',
            }}
          >
            {isAnimating ? '⏸ 暂停动画' : '▶ 播放动画'}
          </button>
        </div>
      </div>

      {/* POE 前置预测锁卡片 */}
      {predictionGate?.required && (
        <div
          style={{
            padding: '14px 16px',
            borderRadius: '10px',
            backgroundColor: isSubmittedLocal ? '#f0fdf4' : '#fffbeb',
            border: isSubmittedLocal ? '1px solid #bbf7d0' : '1px solid #fde68a',
            marginBottom: '16px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '13.5px', fontWeight: 700, color: isSubmittedLocal ? '#166534' : '#92400e' }}>
              {isSubmittedLocal ? '✓ POE 前置预测已锁定' : '🔒 POE 前置预测锁：请先提出物理假设'}
            </span>
            <span style={{ fontSize: '11.5px', color: '#64748b' }}>
              {isSubmittedLocal ? '观察与预测比对中' : '运行仿真前必须提交'}
            </span>
          </div>

          {!isSubmittedLocal ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <p style={{ margin: 0, fontSize: '13px', color: '#475569' }}>
                {mode === 'diffraction'
                  ? '若保持激光波长不变，将狭缝宽度 a 缩小为原来的一半，中央明纹宽度将：'
                  : '在瑞利散射有效区域内，波长由 650nm (红光) 切换为 450nm (蓝光)，微粒散射光强将：'}
              </p>
              <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
                {(mode === 'diffraction'
                  ? ['A. 宽度增大一倍 (反比)', 'B. 宽度缩小一半 (正比)', 'C. 宽度保持不变']
                  : ['A. 显著增强 (与 λ⁴ 成反比)', 'B. 显著减弱', 'C. 强度保持不变']
                ).map((opt) => (
                  <label key={opt} style={{ fontSize: '12.5px', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
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
                disabled={!selectedPrediction || disabled || actionPending}
                onClick={() => void handleSubmitPrediction()}
                style={{
                  alignSelf: 'flex-start',
                  marginTop: '4px',
                  padding: '6px 16px',
                  fontSize: '12.5px',
                  fontWeight: 600,
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
            <p style={{ margin: 0, fontSize: '12.5px', color: '#15803d' }}>
              已提交预测：“{predictionGate.hypothesis ?? selectedPrediction}”。请调节参数运行仿真，比较模拟读数。
            </p>
          )}
        </div>
      )}

      {/* 参数控制区与仿真操作区（受预测锁控制） */}
      <div style={{ opacity: isPredictionLocked ? 0.45 : 1, pointerEvents: isPredictionLocked ? 'none' : 'auto' }}>
        {mode === 'diffraction' ? (
          <div>
            {/* 经典预设场景选择条 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>快速预设实验：</span>
              <button
                type="button"
                onClick={() => { setWavelength(632.8); setSlitWidth(50); setScreenDistance(1.0); }}
                style={{ padding: '3px 9px', fontSize: '11.5px', borderRadius: '6px', border: '1px solid #fca5a5', background: '#fef2f2', color: '#b91c1c', cursor: 'pointer' }}
              >
                🔴 氦氖红光 (632.8nm, a=50μm)
              </button>
              <button
                type="button"
                onClick={() => { setWavelength(532.0); setSlitWidth(80); setScreenDistance(1.2); }}
                style={{ padding: '3px 9px', fontSize: '11.5px', borderRadius: '6px', border: '1px solid #86efac', background: '#f0fdf4', color: '#15803d', cursor: 'pointer' }}
              >
                🟢 绿光高分辨 (532nm, a=80μm)
              </button>
              <button
                type="button"
                onClick={() => { setWavelength(405.0); setSlitWidth(30); setScreenDistance(0.8); }}
                style={{ padding: '3px 9px', fontSize: '11.5px', borderRadius: '6px', border: '1px solid #d8b4fe', background: '#faf5ff', color: '#7e22ce', cursor: 'pointer' }}
              >
                🟣 紫光短波 (405nm, a=30μm)
              </button>
            </div>

            {/* 参数调节滑块区 */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: '14px',
                background: '#f8fafc',
                padding: '14px',
                borderRadius: '12px',
                border: '1px solid #e2e8f0',
                marginBottom: '14px',
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', marginBottom: '6px' }}>
                  <span style={{ color: '#334155', fontWeight: 600 }}>波长 λ: {wavelength} nm</span>
                  <span style={{ color: beamColor.css, fontWeight: 700 }}>● 光源色</span>
                </div>
                <input
                  type="range"
                  min="400"
                  max="750"
                  step="5"
                  value={wavelength}
                  disabled={disabled || actionPending}
                  onChange={(e) => setWavelength(Number(e.target.value))}
                  style={{ width: '100%', accentColor: beamColor.css }}
                />
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', marginBottom: '6px' }}>
                  <span style={{ color: '#334155', fontWeight: 600 }}>狭缝宽度 a: {slitWidth} μm</span>
                  <span style={{ color: '#0284c7', fontWeight: 600 }}>{slitWidth <= 50 ? '明显衍射' : '弱衍射'}</span>
                </div>
                <input
                  type="range"
                  min="10"
                  max="200"
                  step="5"
                  value={slitWidth}
                  disabled={disabled || actionPending}
                  onChange={(e) => setSlitWidth(Number(e.target.value))}
                  style={{ width: '100%', accentColor: '#0284c7' }}
                />
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', marginBottom: '6px' }}>
                  <span style={{ color: '#334155', fontWeight: 600 }}>屏距 D: {screenDistance.toFixed(1)} m</span>
                  <span style={{ color: '#64748b' }}>角宽度: {firstMinAngleMrad.toFixed(2)} mrad</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="2.0"
                  step="0.1"
                  value={screenDistance}
                  disabled={disabled || actionPending}
                  onChange={(e) => setScreenDistance(Number(e.target.value))}
                  style={{ width: '100%', accentColor: '#475569' }}
                />
              </div>
            </div>

            {/* 交互式光路图台与波动传播演播区 */}
            <div
              style={{
                background: '#090d16',
                borderRadius: '12px',
                padding: '14px',
                marginBottom: '14px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', fontSize: '12px', marginBottom: '8px' }}>
                <span>📐 微观光路动态实验台（激光发射器 ➔ 可调单缝光阑 ➔ 菲涅耳子波演播）</span>
                <span style={{ color: '#38bdf8' }}>狭缝开合与波面传播实时联动</span>
              </div>
              <canvas
                ref={benchCanvasRef}
                width={500}
                height={100}
                style={{ width: '100%', height: '100px', display: 'block', borderRadius: '8px' }}
              />
            </div>

            {/* 理论光强分布曲线 I(θ) 与测微探针 */}
            <div
              style={{
                background: '#090d16',
                borderRadius: '12px',
                padding: '14px',
                marginBottom: '14px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', fontSize: '12px', marginBottom: '8px', flexWrap: 'wrap', gap: '6px' }}>
                <span>光屏上光强分布理论曲线 I(θ) = I₀(sinβ/β)²</span>
                <span style={{ color: '#38bdf8', fontWeight: 600 }}>
                  模型计算中央条纹宽度 Δx = {centralBandWidthMm.toFixed(2)} mm
                </span>
              </div>

              <div style={{ position: 'relative' }}>
                <svg width="100%" height="95" viewBox="0 0 480 95" style={{ display: 'block' }}>
                  {/* 基准轴 */}
                  <line x1="20" y1="88" x2="460" y2="88" stroke="#334155" strokeWidth="1" />
                  <line x1="240" y1="10" x2="240" y2="88" stroke="#475569" strokeWidth="1" strokeDasharray="3 3" />

                  {/* 光强分布曲线 */}
                  <path d={intensitySvgPath} fill="none" stroke={beamColor.css} strokeWidth="2.5" />

                  {/* 探针在曲线上的对应高亮线 */}
                  {probeXMm !== null && (
                    <line
                      x1={240 + (probeXMm / spanMm) * 220}
                      y1="10"
                      x2={240 + (probeXMm / spanMm) * 220}
                      y2="88"
                      stroke="#facc15"
                      strokeWidth="1.5"
                      strokeDasharray="2 2"
                    />
                  )}
                </svg>

                {/* 探针读数悬浮气泡 */}
                {probeData && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '6px',
                      left: `${Math.max(10, Math.min(320, 240 + (probeData.xMm / spanMm) * 220 - 70))}px`,
                      background: 'rgba(15, 23, 42, 0.92)',
                      border: '1px solid #facc15',
                      borderRadius: '6px',
                      padding: '4px 8px',
                      fontSize: '11px',
                      color: '#f8fafc',
                      pointerEvents: 'none',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <div>探针位置 x: <strong>{probeData.xMm > 0 ? `+${probeData.xMm}` : probeData.xMm} mm</strong> (相对光强: {probeData.intensityPercent}%)</div>
                    <div style={{ color: '#93c5fd' }}>衍射角: {probeData.thetaMrad} mrad · {probeData.regionLabel}</div>
                  </div>
                )}
              </div>

              {/* 实时物理干涉条纹渲染画布 (支持鼠标悬浮探针交互) */}
              <div style={{ marginTop: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', fontSize: '11px', marginBottom: '4px' }}>
                  <span>光屏上多级衍射干涉明暗条纹（鼠标在条纹上移动可进行测微标尺读数）：</span>
                  <span style={{ color: '#facc15' }}>{probeData ? `x = ${probeData.xMm} mm` : '移动鼠标进入条纹测量'}</span>
                </div>
                <canvas
                  ref={fringeCanvasRef}
                  width={600}
                  height={56}
                  onMouseMove={handleFringeMouseMove}
                  onMouseLeave={handleFringeMouseLeave}
                  style={{
                    width: '100%',
                    height: '56px',
                    display: 'block',
                    borderRadius: '6px',
                    cursor: 'crosshair',
                    boxShadow: `0 0 16px ${beamColor.css}30`,
                  }}
                />
              </div>

              <div style={{ marginTop: '8px', textAlign: 'center', fontSize: '11px', color: '#94a3b8' }}>
                中央极大区（宽度随着狭缝宽度减小而展宽）· 第一级暗纹位置: x₁ = ±λD/a = ±{(centralBandWidthMm / 2).toFixed(2)} mm
              </div>
            </div>
          </div>
        ) : (
          <div>
            {/* 散射预设场景 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>快速预设实验：</span>
              <button
                type="button"
                onClick={() => { setScatteringWavelength(450); setParticleRadius(5); }}
                style={{ padding: '3px 9px', fontSize: '11.5px', borderRadius: '6px', border: '1px solid #93c5fd', background: '#eff6ff', color: '#1d4ed8', cursor: 'pointer' }}
              >
                短波单色散射预览 (450nm, r=5nm)
              </button>
              <button
                type="button"
                onClick={() => { setScatteringWavelength(680); setParticleRadius(5); }}
                style={{ padding: '3px 9px', fontSize: '11.5px', borderRadius: '6px', border: '1px solid #fca5a5', background: '#fef2f2', color: '#b91c1c', cursor: 'pointer' }}
              >
                长波单色散射预览 (680nm, r=5nm)
              </button>
              <button
                type="button"
                onClick={() => { setScatteringWavelength(532); setParticleRadius(150); }}
                style={{ padding: '3px 9px', fontSize: '11.5px', borderRadius: '6px', border: '1px solid #fed7aa', background: '#fff7ed', color: '#c2410c', cursor: 'pointer' }}
              >
                🌫️ 气溶胶大微粒 (532nm, r=150nm)
              </button>
            </div>

            {/* 介质散射参数控制区 */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '14px',
                background: '#f8fafc',
                padding: '14px',
                borderRadius: '12px',
                border: '1px solid #e2e8f0',
                marginBottom: '14px',
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', marginBottom: '6px' }}>
                  <span style={{ color: '#334155', fontWeight: 600 }}>入射波长 λ: {scatteringWavelength} nm</span>
                  <span style={{ color: scatterColor.css, fontWeight: 700 }}>● 光束色</span>
                </div>
                <input
                  type="range"
                  min="400"
                  max="750"
                  step="5"
                  value={scatteringWavelength}
                  disabled={disabled || actionPending}
                  onChange={(e) => setScatteringWavelength(Number(e.target.value))}
                  style={{ width: '100%', accentColor: scatterColor.css }}
                />
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', marginBottom: '6px' }}>
                  <span style={{ color: '#334155', fontWeight: 600 }}>微粒半径 r: {particleRadius} nm</span>
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
                  disabled={disabled || actionPending}
                  onChange={(e) => setParticleRadius(Number(e.target.value))}
                  style={{ width: '100%', accentColor: isRayleigh ? '#2563eb' : '#d97706' }}
                />
              </div>
            </div>

            {/* 动态细雾室布朗运动散射仿真暗室 */}
            <div
              style={{
                background: '#090d16',
                borderRadius: '12px',
                padding: '14px',
                marginBottom: '14px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', fontSize: '12px', marginBottom: '8px', flexWrap: 'wrap', gap: '6px' }}>
                <span>封闭细雾室单色光散射示意（非真实实验操作）</span>
                <span style={{ color: isRayleigh ? '#60a5fa' : '#f59e0b', fontWeight: 600 }}>
                  {rayleighRatio === null ? `尺寸参数 x = ${sizeParameter.toFixed(3)}；不计算强度比` : `模型相对 700nm 散射比: ${rayleighRatio.toFixed(1)}x`}
                </span>
              </div>

              <canvas
                ref={scatterCanvasRef}
                width={480}
                height={120}
                style={{
                  width: '100%',
                  height: '120px',
                  display: 'block',
                  borderRadius: '8px',
                  boxShadow: `0 0 20px ${scatterColor.css}20`,
                }}
              />

              <div style={{ marginTop: '10px', fontSize: '11.5px', color: '#94a3b8', lineHeight: 1.5 }}>
                {isRayleigh
                  ? `瑞利近似有效（r ≪ λ）：散射光强正比于 1/λ⁴，短波蓝紫光（450nm）散射强度约达红光（650nm）的 ${(Math.pow(650 / 450, 4)).toFixed(1)} 倍。单色散射光仍保持入射颜色。`
                  : '超出本预览的瑞利近似域：域外不推断米氏散射强度或颜色；单色散射不会自动变白。'}
              </div>
            </div>
          </div>
        )}

        {/* 仿真运行操作按钮 */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px', marginBottom: '8px' }}>
          <button
            type="button"
            disabled={isPredictionLocked || disabled || actionPending}
            onClick={() => void handleRunSimulation()}
            style={{
              padding: '8px 20px',
              fontSize: '13px',
              fontWeight: 600,
              borderRadius: '8px',
              backgroundColor: isPredictionLocked ? '#cbd5e1' : '#059669',
              color: '#ffffff',
              border: 'none',
              cursor: isPredictionLocked ? 'not-allowed' : 'pointer',
              boxShadow: isPredictionLocked ? 'none' : '0 2px 8px rgba(5, 150, 105, 0.3)',
              transition: 'all 0.15s ease',
            }}
          >
            {isPredictionLocked ? '\u8bf7\u5148\u63d0\u4ea4\u9884\u6d4b\u4ee5\u89e3\u9501\u8fd0\u884c' : actionPending ? '\u670d\u52a1\u5668\u5904\u7406\u4e2d...' : runAccepted ? '\u4eff\u771f\u5df2\u8fd0\u884c' : '\u8fd0\u884c\u4eff\u771f'}
          </button>
        </div>
      </div>
      <label style={{ display: 'block', fontSize: '13px', marginBottom: '8px' }}>
        我的观察（模拟）
        <textarea aria-label="我的观察（模拟）" maxLength={500} value={observation}
          disabled={disabled || actionPending || !runAccepted}
          onChange={(event) => { setObservation(event.target.value); setObservationAccepted(false); }}
          placeholder="描述你从仿真图形中观察到的变化。"
          style={{ display: 'block', width: '100%', minHeight: '60px', marginTop: '6px' }} />
      </label>
      <button
        type="button"
        disabled={!runAccepted || !observation.trim() || disabled || actionPending || observationAccepted}
        onClick={() => void handleRecordObservation()}
        style={{ margin: '0 0 8px auto', display: 'block', padding: '8px 16px', borderRadius: '8px', border: 'none', color: '#fff', background: observationAccepted ? '#86efac' : '#0ea5e9' }}
      >
        {observationAccepted ? '已保存模拟观察' : '\u8bb0\u5f55\u89c2\u5bdf'}
      </button>
      {savedObservation ? <p role="status">此前的模拟观察已保存，可在项目证据中查看。</p> : null}

      {actionError ? <p role="alert" style={{ color: '#b91c1c', fontSize: '12px' }}>{actionError}</p> : null}
      {serverSimulationSummary ? <p role="status" style={{ color: '#0369a1', fontSize: '12px' }}>{serverSimulationSummary}</p> : null}

      <p role="note" style={{ margin: '8px 0 0', fontSize: '11.5px', color: '#64748b' }}>
        {disabled ? '当前为低风险模型预览，不保存观测，不是真实测量。' : '拖动参数仅作模型预览；提交观察并收到回执后才保存为模拟证据，不代表真实测量或掌握。'}真实实验须由教师审核安全方案。
      </p>
    </div>
  );
}
