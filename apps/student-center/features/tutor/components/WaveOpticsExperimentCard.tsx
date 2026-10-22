'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { parseWaveOpticsParameters, parametersWithoutMode, WaveOpticsDomainError } from '@qitu/ai-client';
import type { TutorExperimentAction, TutorExperimentActionResponse, TutorReplyBlock, WaveExperimentRun, WaveOpticsParameters } from '@qitu/contracts';
import { createIdempotencyKey } from '../idempotency';
import styles from './WaveOpticsExperimentCard.module.css';

type Experiment = Extract<TutorReplyBlock, { kind: 'optics_experiment' }>;
interface Props {
  block: Experiment;
  disabled?: boolean;
  onAction: (action: TutorExperimentAction, payload: unknown, key: string) => void | Promise<boolean | TutorExperimentActionResponse>;
}
function readParameters(mode: unknown, raw: unknown) {
  try { return { kind: 'ready' as const, value: parseWaveOpticsParameters(mode, raw) }; }
  catch (error) {
    if (!(error instanceof WaveOpticsDomainError)) throw error;
    return { kind: 'error' as const, message: error.message };
  }
}

export function WaveOpticsExperimentCard(props: Props) {
  const parsed = readParameters(props.block.initialMode, props.block.initialParameters);
  if (parsed.kind === 'error') return <section className={styles.card} role="alert">
    <strong>这份实验配置需要检查</strong><p>{parsed.message}</p><p>请让导师重新生成本课活动。</p>
  </section>;
  return <WaveOpticsLab {...props} initial={parsed.value} />;
}

function WaveOpticsLab({ block, disabled = false, onAction, initial }: Props & { initial: WaveOpticsParameters }) {
  const [parameters, setParameters] = useState(initial);
  const [prediction, setPrediction] = useState('');
  const [predicted, setPredicted] = useState(block.savedExperiment?.predictionSubmitted ?? block.predictionGate?.submitted ?? false);
  const [runs, setRuns] = useState<readonly WaveExperimentRun[]>(block.savedExperiment?.runs ?? []);
  const [observation, setObservation] = useState('');
  const [receipt, setReceipt] = useState(block.savedObservation);
  const [pending, setPending] = useState<TutorExperimentAction | null>(null);
  const [error, setError] = useState('');
  const alive = useRef(true);
  const keys = useRef(new Map<string, string>());
  const card = useRef<HTMLElement>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const parsed = useMemo(() => readParameters(parameters.mode, parametersWithoutMode(parameters)), [parameters]);
  const latest = runs.at(-1);
  const currentRun = latest && JSON.stringify(latest.parameters) === JSON.stringify(parameters) ? latest : undefined;
  const busy = disabled || pending !== null;
  const isDouble = parameters.mode === 'interference';
  const update = (name: 'wavelength' | 'slitWidth' | 'slitSeparation' | 'screenDistance', value: number) => {
    if (busy || name === 'slitSeparation' && parameters.mode !== 'interference') return;
    setParameters(previous => ({ ...previous, [name]: value }));
    setError('');
  };
  const send = async (action: TutorExperimentAction) => {
    if (busy || parsed.kind !== 'ready' || !block.allowedActions.includes(action)) return;
    const payload = { mode: parameters.mode, ...(action === 'submit_prediction' ? { hypothesis: prediction.trim() }
      : { parameters: parametersWithoutMode(parameters), ...(action === 'record_observation'
        ? { observation: observation.trim(), runActionId: currentRun?.actionId } : {}) }) };
    const identity = `${action}:${JSON.stringify(payload)}`;
    const key = keys.current.get(identity) ?? createIdempotencyKey();
    keys.current.set(identity, key); setPending(action); setError('');
    try {
      const reply = await onAction(action, payload, key);
      if (!alive.current) return;
      if (!reply || typeof reply !== 'object' || reply.accepted !== true || reply.experimentId !== block.experimentId || reply.action !== action) {
        throw new Error('尚未确认保存结果，请重试。');
      }
      if (action === 'submit_prediction') setPredicted(true);
      if (action === 'run') {
        const projection = reply.simulationResult?.waveProjection;
        if (!projection || projection.mode !== parameters.mode || projection.specVersion !== 'wave-optics-model.v1') throw new Error('本次计算结果与实验不一致，请重试。');
        setRuns(previous => [...previous.filter(run => run.actionId !== reply.actionId), { actionId: reply.actionId, parameters, projection }].slice(-3));
      }
      if (action === 'record_observation') {
        const saved = reply.observationReceipt;
        if (!saved || saved.runActionId !== currentRun?.actionId || saved.learningSessionId !== block.scope?.learningSessionId
          || saved.planRevision !== block.scope?.planRevision) throw new Error('观察回执与当前实验不一致，请重试。');
        setReceipt(saved); setObservation('');
      }
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : '操作未完成，请重试。'); }
    finally { if (alive.current) setPending(null); }
  };
  const fields = [
    { name: 'wavelength' as const, label: '波长 λ', min: 400, max: 750, step: 10, unit: 'nm', value: parameters.wavelength },
    { name: 'slitWidth' as const, label: '每条缝宽 a', min: 10, max: 200, step: 5, unit: 'μm', value: parameters.slitWidth },
    ...(parameters.mode === 'interference' ? [{ name: 'slitSeparation' as const, label: '两缝中心间距 d', min: 40, max: 400, step: 10, unit: 'μm', value: parameters.slitSeparation }] : []),
    { name: 'screenDistance' as const, label: '光屏距离 L', min: 0.5, max: 2, step: 0.1, unit: 'm', value: parameters.screenDistance },
  ];
  return <section ref={card} className={styles.card} aria-label={isDouble ? '双缝干涉探究' : '单缝衍射探究'} aria-busy={pending !== null}>
    <header className={styles.header}><div><span className={styles.eyebrow}>波动探究 · 模拟实验</span>
      <h3>{block.title}</h3></div><button type="button" className="qitu-button qitu-button-ghost" onClick={() => {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void card.current?.requestFullscreen().catch(() => setError('此设备暂不支持全屏，可继续在这里探究。'));
      }}>全屏探究</button></header>
    <p className={styles.intro}>{isDouble ? '分清缝宽 a 与中心间距 d。一次改变一个变量，比较条纹与整体包络。'
      : '先标出中央亮带和两侧条纹，再用一组受控比较检验你的预测。'}</p>
    {!predicted ? <div className={styles.prediction}><label>先写下你的预测
      <textarea value={prediction} onChange={event => setPrediction(event.target.value)} maxLength={200} rows={2} disabled={busy}
        placeholder="我准备改变……，保持……不变；我预测……" /></label>
      <button type="button" className="qitu-button qitu-button-primary" disabled={busy || !prediction.trim()} onClick={() => { void send('submit_prediction'); }}>
        {pending === 'submit_prediction' ? '正在保存…' : '保存预测'}</button></div>
      : <p className={styles.confirmed}>预测已保存。调节一个参数，运行后再记录观察。</p>}
    <fieldset className={styles.controls} disabled={busy || !predicted}><legend>比较条件</legend>
      {fields.map(field => <label key={field.name}>{field.label}<strong>{field.value} {field.unit}</strong>
        <input type="range" aria-label={field.label} min={field.min} max={field.max} step={field.step} value={field.value}
          onChange={event => update(field.name, Number(event.target.value))} /></label>)}
    </fieldset>
    {parsed.kind === 'error' ? <p className={styles.error} role="status">当前参数超出本模型适用范围。请减小孔径范围或增大屏距。{parsed.message}</p> : null}
    <div className={styles.runBar}><button type="button" className="qitu-button qitu-button-primary"
      disabled={busy || !predicted || parsed.kind !== 'ready'} onClick={() => { void send('run'); }}>{pending === 'run' ? '正在计算…' : '运行并比较'}</button>
      <span>{currentRun ? '当前参数已有计算结果' : latest ? '参数已改变，请重新运行。下方保留之前的结果作比较。' : '运行后查看图样与读数'}</span></div>
    {runs.length ? <WaveProfiles runs={runs} /> : <div className={styles.empty}>图样将在你保存预测并运行后出现。</div>}
    {latest ? <div className={styles.readouts}><span>衍射包络中央宽度 <strong>{latest.projection.centralBandWidthMm.toFixed(2)} mm</strong></span>
      {latest.projection.fringeSpacingMm !== null ? <span>近轴干涉条纹间距 <strong>{latest.projection.fringeSpacingMm.toFixed(2)} mm</strong></span> : null}</div> : null}
    <p className={styles.note}>远场、单色模型计算；每次以中央峰归一化，不能据此比较绝对亮度。图样与记录属于模拟观察。</p>
    <label className={styles.observation}>我的观察与解释<textarea value={observation} onChange={event => setObservation(event.target.value)} rows={3}
      maxLength={500} disabled={busy || !currentRun} placeholder="记录改变前后的参数和图样特征。预测是否得到支持？" /></label>
    <button type="button" className="qitu-button qitu-button-ghost" disabled={busy || !currentRun || !observation.trim()}
      onClick={() => { void send('record_observation'); }}>{pending === 'record_observation' ? '正在保存观察…' : '保存这次观察'}</button>
    {receipt ? <p className={styles.confirmed} role="status">观察已保存，可用于本课证据。完成状态以本课评价为准。</p> : null}
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
  </section>;
}

function WaveProfiles({ runs }: { runs: readonly WaveExperimentRun[] }) {
  const extent = Math.max(1, ...runs.flatMap(run => run.projection.samples.map(point => Math.abs(point.positionMm))));
  const colours = ['#0e7490', '#b45309', '#1d4ed8'];
  return <figure className={styles.figure}><svg viewBox="0 0 680 210" role="img" aria-label="归一化光强与屏上位置比较图">
    <line x1="20" y1="170" x2="660" y2="170" stroke="currentColor" opacity=".3" />
    <line x1="340" y1="20" x2="340" y2="174" stroke="currentColor" opacity=".2" />
    <text x="20" y="14" fontSize="11" fill="currentColor">归一化光强</text>
    {runs.map((run, index) => <polyline key={run.actionId} fill="none" stroke={colours[index % colours.length]} strokeWidth="1.5"
      points={run.projection.samples.map(point => `${20 + (point.positionMm + extent) / (2 * extent) * 640},${170 - point.normalizedIntensity * 140}`).join(' ')} />)}
    <text x="20" y="195" fontSize="11" fill="currentColor">−{extent.toFixed(1)} mm</text>
    <text x="336" y="195" fontSize="11" fill="currentColor">0</text>
    <text x="590" y="195" fontSize="11" fill="currentColor">{extent.toFixed(1)} mm</text>
  </svg><figcaption>{runs.map((run, index) => <span key={run.actionId} style={{ color: colours[index % colours.length] }}>
    {index + 1} · λ {run.parameters.wavelength} nm · a {run.parameters.slitWidth} μm
    {run.parameters.mode === 'interference' ? ` · d ${run.parameters.slitSeparation} μm` : ''} · L {run.parameters.screenDistance} m
  </span>)}</figcaption></figure>;
}
