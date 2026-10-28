'use client';

import { createElement, useEffect, useMemo, useState, type ReactNode } from 'react';
import { MarkdownMathView } from './MarkdownMathView';
import { MermaidView } from './MermaidView';
import { coursewareVisual } from '../lib/coursewareVisual';
import presentation from './CoursewarePresentation.module.css';

type BoardStep = { caption: string; mermaid?: string; tex?: string; svg?: string };

export function BoardBlock({ title, steps }: { title?: string; steps: BoardStep[] }) {
  const [stepIndex, setStepIndex] = useState(0);
  const boundedIndex = Math.min(stepIndex, Math.max(0, steps.length - 1));
  const step = steps[boundedIndex];
  const visual = coursewareVisual(steps, boundedIndex);
  if (!step) return <p className="qitu-interaction-empty" role="status">白板暂无步骤。</p>;
  return (
    <section className="qitu-board-card" aria-label={title ?? '分步白板'}>
      <header className="qitu-board-header"><div><span className="qitu-quiz-badge">分步白板</span>{title ? <h4>{title}</h4> : null}</div><span>步骤 {boundedIndex + 1} / {steps.length}</span></header>
      <ol className={presentation.steps} aria-label="图示步骤">{steps.map((item, index) => <li key={index}>
        <button type="button" aria-label={`查看第 ${index + 1} 步：${item.caption}`} aria-current={index === boundedIndex ? 'step' : undefined}
          onClick={() => setStepIndex(index)}>{String(index + 1).padStart(2, '0')}</button>
      </li>)}</ol>
      <p className={`qitu-board-caption ${presentation.caption}`}>{step.caption}</p>
      {visual && visual.index !== boundedIndex ? <p className={presentation.source}>结合第 {visual.index + 1} 步图示思考</p> : null}
      {visual ? <div key={visual.index} className={`qitu-board-canvas ${presentation.stage}`}>
        {visual.step.tex ? <div className={presentation.formula}><MarkdownMathView content={`$$${visual.step.tex}$$`} /></div> : null}
        {visual.step.mermaid ? <MermaidView code={visual.step.mermaid} /> : null}
        {visual.step.svg ? <SafeSvg source={visual.step.svg} /> : null}
      </div> : null}
      <footer className="qitu-board-footer">
        <button type="button" className="qitu-button qitu-button-ghost qitu-button-sm" disabled={boundedIndex === 0} onClick={() => setStepIndex(boundedIndex - 1)}>上一页图示</button>
        <button type="button" className="qitu-button qitu-button-primary qitu-button-sm" disabled={boundedIndex >= steps.length - 1} onClick={() => setStepIndex(boundedIndex + 1)}>下一页图示</button>
        {boundedIndex > 0 ? <button type="button" className="qitu-button qitu-button-ghost qitu-button-sm" onClick={() => setStepIndex(0)}>从头再看</button> : null}
      </footer>
    </section>
  );
}

function SafeSvg({ source }: { source: string }) {
  const [mounted, setMounted] = useState(false);
  const nodes = useMemo(() => (mounted ? sanitizeSvg(source) : null), [mounted, source]);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="qitu-board-svg-skeleton" aria-busy="true">正在准备图示…</div>;
  if (nodes === null) return <p className="qitu-interaction-error" role="alert">图示无法安全展示，已阻止不受控内容。</p>;
  return <svg className="qitu-board-svg" viewBox={nodes.viewBox} role="img" aria-label="只读 SVG 图示">{nodes.children}</svg>;
}

type SanitizedSvg = { viewBox: string; children: ReactNode[] };
const ALLOWED_TAGS = new Set(['g', 'path', 'line', 'polyline', 'polygon', 'circle', 'ellipse', 'rect', 'text']);
const ALLOWED_ATTRS = new Set(['d', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'points', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'fill', 'stroke', 'stroke-width', 'viewBox', 'font-size', 'text-anchor', 'transform', 'opacity']);
const REACT_ATTR_NAMES: Record<string, string> = { 'stroke-width': 'strokeWidth', 'font-size': 'fontSize', 'text-anchor': 'textAnchor' };

function sanitizeSvg(source: string): SanitizedSvg | null {
  if (typeof DOMParser === 'undefined' || source.length > 200_000) return null;
  try {
    const document = new DOMParser().parseFromString(source, 'image/svg+xml');
    if (document.querySelector('parsererror, script, foreignObject, iframe, image, use, style, link')) return null;
    const root = document.documentElement;
    if (root.nodeName.toLowerCase() !== 'svg') return null;
    const viewBox = root.getAttribute('viewBox') ?? `0 0 ${root.getAttribute('width') ?? '640'} ${root.getAttribute('height') ?? '360'}`;
    return { viewBox, children: Array.from(root.children).flatMap((child, index) => renderSvgNode(child, `${index}`)) };
  } catch {
    return null;
  }
}

function renderSvgNode(node: Element, key: string): ReactNode[] {
  const tag = node.tagName.toLowerCase();
  if (!ALLOWED_TAGS.has(tag)) return [];
  const attrs: Record<string, string> = {};
  for (const attr of Array.from(node.attributes)) {
    if (!ALLOWED_ATTRS.has(attr.name) || attr.name.toLowerCase().startsWith('on') || /url\s*\(|javascript:/i.test(attr.value)) continue;
    const name = REACT_ATTR_NAMES[attr.name] ?? attr.name;
    attrs[name] = attr.value;
  }
  const children = Array.from(node.children).flatMap((child, index) => renderSvgNode(child, `${key}-${index}`));
  if (tag === 'text') children.push(node.textContent ?? '');
  return [createElement(tag, { key, ...attrs }, ...children)];
}
