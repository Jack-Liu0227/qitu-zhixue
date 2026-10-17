'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { MarkdownMathView } from './MarkdownMathView';

type BoardStep = { caption: string; mermaid?: string; tex?: string; svg?: string };

export function BoardBlock({ title, steps }: { title?: string; steps: BoardStep[] }) {
  const [stepIndex, setStepIndex] = useState(0);
  const step = steps[stepIndex];
  if (!step) return <p className="qitu-interaction-empty" role="status">白板暂无步骤。</p>;
  return (
    <section className="qitu-board-card" aria-label={title ?? '分步白板'}>
      <header className="qitu-board-header"><div><span className="qitu-quiz-badge">分步白板</span>{title ? <h4>{title}</h4> : null}</div><span>步骤 {stepIndex + 1} / {steps.length}</span></header>
      <p className="qitu-board-caption">{step.caption}</p>
      <div className="qitu-board-canvas">
        {step.tex ? <MarkdownMathView content={`$$${step.tex}$$`} /> : null}
        {step.mermaid ? <MermaidFallback source={step.mermaid} /> : null}
        {step.svg ? <SafeSvg source={step.svg} /> : null}
      </div>
      <footer className="qitu-board-footer">
        <button type="button" className="qitu-button qitu-button-ghost qitu-button-sm" disabled={stepIndex === 0} onClick={() => setStepIndex((value) => value - 1)}>上一步</button>
        <button type="button" className="qitu-button qitu-button-primary qitu-button-sm" disabled={stepIndex >= steps.length - 1} onClick={() => setStepIndex((value) => value + 1)}>下一步</button>
      </footer>
    </section>
  );
}

function MermaidFallback({ source }: { source: string }) {
  const lines = source.split('\n').map((line) => line.trim()).filter(Boolean);
  return <div className="qitu-board-mermaid-fallback" role="img" aria-label="Mermaid 图示的结构化文本降级"><strong>图示结构</strong><ol>{lines.slice(0, 40).map((line, index) => <li key={`${line}-${index}`}>{line}</li>)}</ol><small>当前环境未加载 Mermaid 渲染器，已安全降级为只读结构化文本。</small></div>;
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
    attrs[attr.name === 'class' ? 'className' : attr.name] = attr.value;
  }
  const children = Array.from(node.children).flatMap((child, index) => renderSvgNode(child, `${key}-${index}`));
  if (tag === 'text') children.push(node.textContent ?? '');
  return [<svg key={key} data-svg-node={tag} {...attrs}>{children}</svg>];
}
