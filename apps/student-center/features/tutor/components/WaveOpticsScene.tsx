'use client';

import { useEffect, useId, useState, type CSSProperties } from 'react';
import type { WaveExperimentRun } from '@qitu/contracts';
import styles from './WaveOpticsScene.module.css';

type Run = Pick<WaveExperimentRun, 'parameters' | 'projection'>;

/** The apparatus illustrates propagation; only the accepted model samples colour the screen. */
export function WaveOpticsScene({ run }: { run: Run }) {
  const id = useId().replace(/:/g, '');
  const [moving, setMoving] = useState(false);
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => {
      const reduce = preference.matches || document.documentElement.dataset.qituReducedMotion === 'true';
      setReduced(reduce); setMoving(!reduce);
    };
    change();
    const observer = new MutationObserver(change);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-qitu-reduced-motion'] });
    preference.addEventListener('change', change);
    return () => { observer.disconnect(); preference.removeEventListener('change', change); };
  }, []);
  const double = run.parameters.mode === 'interference';
  // Approximate display hue, not a spectrum or an absolute brightness measurement.
  const hue = run.parameters.wavelength < 440 ? 270 : run.parameters.wavelength < 490 ? 220
    : run.parameters.wavelength < 520 ? 175 : run.parameters.wavelength < 570 ? 115
      : run.parameters.wavelength < 600 ? 45 : run.parameters.wavelength < 640 ? 25 : 0;
  const colour = `hsl(${hue} 92% 65%)`;
  const samples = run.projection.samples;
  const extent = Math.max(...samples.map(sample => Math.abs(sample.positionMm)));
  const origins = double ? [105, 145] : [125];
  return <figure className={styles.scene} style={{ '--wave-colour': colour } as CSSProperties}
    data-motion={moving ? 'running' : 'paused'} data-reduced={reduced} aria-label="波的传播与屏上条纹">
    <figcaption className={styles.heading}><div><span>从波的传播，看见条纹</span>
      <small>{double ? '两条缝发出的波相遇，亮暗交替' : '波经过窄缝展开，中央亮带最宽'}</small></div>
      <button type="button" aria-pressed={moving} disabled={reduced} onClick={() => setMoving(value => !value)}>
        {reduced ? '已减少动态效果' : moving ? '暂停波动演示' : '播放波动演示'}</button></figcaption>
    <svg className={styles.apparatus} viewBox="0 0 680 235" role="img" aria-label={double ? '双缝波传播示意，不按比例' : '单缝波传播示意，不按比例'}>
      <defs><clipPath id={`${id}-waves`}><rect x="246" y="38" width="338" height="175" /></clipPath></defs>
      <path d="M 88 125 H 246" className={styles.beam} />
      {[0, 1, 2, 3].map(index => <path key={index} d={`M ${104 + (reduced ? index * 35 : 0)} 93 V 157`} className={styles.incoming}
        style={{ animationDelay: `${index * -.65}s` }} />)}
      <rect x="30" y="108" width="58" height="34" rx="8" fill="#243750" stroke="#8babc4" />
      <circle cx="82" cy="125" r="5" fill={colour} />
      <path d={double ? 'M 246 47 V 98 M 246 112 V 138 M 246 152 V 203' : 'M 246 47 V 117 M 246 133 V 203'} stroke="#bad0e2" strokeWidth="9" />
      <g clipPath={`url(#${id}-waves)`}>{origins.map(origin => <g key={origin}>
        {[0, 1, 2, 3, 4, 5].map(index => <circle key={index} cx="246" cy={origin} r={reduced ? 25 + index * 50 : 25} className={styles.wave}
          style={{ transformOrigin: `246px ${origin}px`, animationDelay: `${index * -.8}s` }} />)}
      </g>)}</g>
      <rect x="592" y="46" width="8" height="158" rx="3" fill="#c5d8e7" />
      <text x="30" y="29">单色光源</text><text x="218" y="29">{double ? '双缝' : '单缝'}</text><text x="569" y="29">光屏</text>
      <text x="290" y="228" className={styles.annotation}>传播示意 · 不按比例</text>
    </svg>
    <div className={styles.screenHeading}><strong>正面观察光屏</strong><span>λ {run.parameters.wavelength} nm · 每次中央峰归一化</span></div>
    <svg className={styles.fringes} viewBox="0 0 680 82" preserveAspectRatio="none" role="img" aria-label="根据本次模型结果绘制的明暗条纹">
      <rect width="680" height="82" fill="#020609" />
      {samples.map((sample, index) => <rect key={index} x={index / samples.length * 680} y="0"
        width={680 / samples.length + .05} height="82" fill={colour} opacity={sample.normalizedIntensity} />)}
      <path d="M 340 0 V 7 M 340 75 V 82" stroke="#fff" />
    </svg>
    <div className={styles.axis}><span>−{extent.toFixed(1)} mm</span><span>中央位置 0</span><span>+{extent.toFixed(1)} mm</span></div>
    <p className={styles.note}>上方动画说明传播方向；下方条纹来自本次计算。颜色仅作示意，亮度为归一化光强。</p>
  </figure>;
}
