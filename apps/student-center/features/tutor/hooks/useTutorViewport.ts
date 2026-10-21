'use client';
import { useEffect } from 'react';

/** Keep the composer inside the visible viewport when the software keyboard opens. */
export function useTutorViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    const shell = document.querySelector<HTMLElement>('.is-tutor-workspace');
    if (!viewport || !shell) return;
    const update = () => {
      if (viewport.scale === 1) shell.style.setProperty('--qitu-visible-height', `${viewport.height}px`);
    };
    update();
    viewport.addEventListener('resize', update);
    return () => { viewport.removeEventListener('resize', update); shell.style.removeProperty('--qitu-visible-height'); };
  }, []);
}
