'use client';

import { useEffect, useRef, useState } from 'react';

/** A display preference shared by each role's desktop navigation. */
export function SidebarResizeHandle({ disabled = false }: { disabled?: boolean }) {
  const handle = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const initial = useRef(240);
  const key = useRef('');
  const [width, setWidth] = useState(240);
  const apply = (value: number, save = true) => {
    const next = Math.round(Math.max(180, Math.min(360, value)));
    handle.current?.parentElement?.style.setProperty('--qitu-navigation-width', `${next}px`);
    setWidth(next);
    if (save) try { localStorage.setItem(key.current, String(next)); } catch { /* Local preferences are optional. */ }
  };
  useEffect(() => {
    const sidebar = handle.current?.parentElement;
    if (!sidebar || disabled) return;
    key.current = `qitu:navigation-width:v1:${window.location.pathname.split('/')[1]}`;
    const computed = sidebar.getBoundingClientRect().width;
    initial.current = computed >= 180 && computed <= 360 ? computed : 240;
    let saved = NaN;
    try { saved = Number(localStorage.getItem(key.current)); } catch { /* Keep the default width. */ }
    apply(saved >= 180 && saved <= 360 ? saved : initial.current, false);
    sidebar.dataset.resizableSidebar = 'true';
    return () => { delete sidebar.dataset.resizableSidebar; };
  }, [disabled]);

  return <div ref={handle} role="separator" aria-label="调整导航栏宽度" aria-orientation="vertical"
    aria-valuemin={180} aria-valuemax={360} aria-valuenow={width} tabIndex={disabled ? -1 : 0}
    className="qitu-navigation-divider" hidden={disabled} title="拖动调整导航宽度；方向键微调，双击或回车恢复"
    onPointerDown={event => {
      if (event.button !== 0) return;
      drag.current = { x: event.clientX, width: handle.current?.parentElement?.getBoundingClientRect().width ?? width };
      event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault();
    }}
    onPointerMove={event => { if (drag.current) apply(drag.current.width + event.clientX - drag.current.x, false); }}
    onPointerUp={() => { if (drag.current) apply(width); drag.current = null; }}
    onPointerCancel={() => { drag.current = null; }}
    onLostPointerCapture={() => { drag.current = null; }}
    onDoubleClick={() => apply(initial.current)}
    onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'].includes(event.key)) return;
      event.preventDefault();
      apply(event.key === 'Enter' ? initial.current : event.key === 'Home' ? 180 : event.key === 'End' ? 360
        : width + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 48 : 16));
    }}><span aria-hidden="true" /></div>;
}
