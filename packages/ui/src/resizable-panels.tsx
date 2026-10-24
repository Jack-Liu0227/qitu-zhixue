'use client';

import { Children, Fragment, useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from 'react';

export interface ResizablePanelsProps {
  children: ReactNode;
  storageKey: string;
  className?: string;
  initialSizes?: number[];
  minWidths?: number[];
  fixedWidths?: Array<number | null>;
  labels?: string[];
  stackBelow?: number;
}

/** Local display preferences only; no teaching or permission state is stored here. */
export function ResizablePanels(props: ResizablePanelsProps) {
  const count = Children.toArray(props.children).length;
  return <PanelGroup key={`${props.storageKey}:${count}:${props.fixedWidths?.join(',')}`} {...props} />;
}

function PanelGroup({ children, storageKey, className = '', initialSizes, minWidths,
  fixedWidths = [], labels = [], stackBelow = 720 }: ResizablePanelsProps) {
  const panels = Children.toArray(children);
  const count = panels.length;
  const defaults = panels.map((_, index) => initialSizes?.[index] ?? 1);
  const minimums = panels.map((_, index) => fixedWidths[index] ?? minWidths?.[index] ?? 240);
  const [sizes, setSizes] = useState(defaults);
  const sizesRef = useRef(sizes);
  const [stacked, setStacked] = useState(false);
  const [dragging, setDragging] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const id = useId();
  const key = `qitu:panel-widths:v1:${storageKey}:${count}:${fixedWidths.join(',')}`;
  const drag = useRef<{ index: number; x: number; left: number; right: number; weights: number[] } | null>(null);
  const breakpoint = Math.max(stackBelow, minimums.reduce((sum, value) => sum + value, 0) + (count - 1) * 12);

  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
      if (Array.isArray(saved) && saved.length === count && saved.every(value => typeof value === 'number' && Number.isFinite(value) && value > 0)) {
        setSizes(saved); sizesRef.current = saved;
      }
    } catch { /* Storage may be unavailable in a private browser session. */ }
  }, [key, count]);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => { if (entry) setStacked(entry.contentRect.width < breakpoint); });
    observer.observe(element);
    return () => observer.disconnect();
  }, [breakpoint]);

  const persist = (next: number[]) => {
    sizesRef.current = next; setSizes(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* Resizing still works without persistence. */ }
  };
  const widths = (index: number): [number, number] => {
    const elements = container.current?.querySelectorAll(':scope > .qitu-resizable-panel');
    return [elements?.[index]?.getBoundingClientRect().width ?? 0, elements?.[index + 1]?.getBoundingClientRect().width ?? 0];
  };
  const adjust = (index: number, delta: number, left: number, right: number, weights: number[]) => {
    const total = left + right;
    if (!total) return weights;
    const value = Math.max(minimums[index] ?? 240, Math.min(total - (minimums[index + 1] ?? 240), left + delta));
    const pairWeight = (weights[index] ?? 1) + (weights[index + 1] ?? 1);
    return weights.map((weight, position) => position === index ? pairWeight * value / total
      : position === index + 1 ? pairWeight * (total - value) / total : weight);
  };
  const start = (event: PointerEvent<HTMLDivElement>, index: number) => {
    if (event.button !== 0) return;
    const [left, right] = widths(index);
    drag.current = { index, x: event.clientX, left, right, weights: [...sizesRef.current] };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault(); setDragging(true);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active) return;
    const next = adjust(active.index, event.clientX - active.x, active.left, active.right, active.weights);
    sizesRef.current = next; setSizes(next);
  };
  const end = () => { if (drag.current) persist(sizesRef.current); drag.current = null; setDragging(false); };
  const keyboard = (event: KeyboardEvent<HTMLDivElement>, index: number) => {
    const [left, right] = widths(index);
    const step = event.shiftKey ? 64 : 16;
    const delta = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step
      : event.key === 'Home' ? -left : event.key === 'End' ? right : null;
    if (event.key === 'Enter') { event.preventDefault(); persist(defaults); return; }
    if (delta === null) return;
    event.preventDefault(); persist(adjust(index, delta, left, right, sizesRef.current));
  };
  const tracks = panels.flatMap((_, index) => [
    fixedWidths[index] != null ? `${fixedWidths[index]}px` : `minmax(${minimums[index]}px, ${sizes[index]}fr)`,
    ...(index < count - 1 ? [fixedWidths[index] != null || fixedWidths[index + 1] != null ? '8px' : '12px'] : []),
  ]).join(' ');

  return <div ref={container} className={`qitu-resizable-panels ${className}`} data-stacked={stacked || count < 2} data-resizing={dragging}
    style={{ '--qitu-panel-tracks': tracks } as CSSProperties}>
    {panels.map((panel, index) => <Fragment key={index}>
      <div id={`${id}-${index}`} className="qitu-resizable-panel">{panel}</div>
      {index < count - 1 ? fixedWidths[index] != null || fixedWidths[index + 1] != null ? <div className="qitu-resizable-gap" />
        : <div className="qitu-panel-divider" role="separator" aria-orientation="vertical"
          aria-label={`调整${labels[index] ?? '左侧'}与${labels[index + 1] ?? '右侧'}宽度`}
          aria-controls={`${id}-${index} ${id}-${index + 1}`} aria-valuemin={0} aria-valuemax={100}
          aria-valuenow={Math.round((sizes[index] ?? 1) / ((sizes[index] ?? 1) + (sizes[index + 1] ?? 1)) * 100)}
          tabIndex={stacked ? -1 : 0} title="拖动调整宽度；方向键微调，双击或回车恢复"
          onPointerDown={event => start(event, index)} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
          onLostPointerCapture={end} onDoubleClick={() => persist(defaults)} onKeyDown={event => keyboard(event, index)}>
          <span aria-hidden="true" />
        </div> : null}
    </Fragment>)}
  </div>;
}
