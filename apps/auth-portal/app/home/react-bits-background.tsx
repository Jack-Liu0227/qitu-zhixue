'use client';

import { useEffect, useRef } from 'react';

export function ReactBitsBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let width = (canvas.width = canvas.offsetWidth);
    let height = (canvas.height = canvas.offsetHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = canvas.offsetWidth;
      height = canvas.height = canvas.offsetHeight;
    };
    window.addEventListener('resize', handleResize);

    const mouse = { x: width * 0.5, y: height * 0.3, active: false };
    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
      mouse.active = true;
    };
    const handleMouseLeave = () => {
      mouse.active = false;
    };
    window.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseleave', handleMouseLeave);

    const count = Math.min(65, Math.floor((width * height) / 16000) || 35);
    const particles = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.55,
      vy: (Math.random() - 0.5) * 0.55,
      radius: Math.random() * 2 + 1.2,
      baseAlpha: Math.random() * 0.45 + 0.3,
      color: Math.random() > 0.6 ? '#38bdf8' : Math.random() > 0.3 ? '#818cf8' : '#c084fc',
    }));

    let step = 0;
    const render = () => {
      step += 0.015;
      ctx.clearRect(0, 0, width, height);

      // 1. Beams / Aurora
      const g1 = ctx.createRadialGradient(
        width * 0.25 + Math.sin(step * 0.8) * 80,
        height * 0.35 + Math.cos(step * 0.6) * 60,
        10,
        width * 0.25,
        height * 0.35,
        Math.max(width, height) * 0.45
      );
      g1.addColorStop(0, 'rgba(56, 189, 248, 0.16)');
      g1.addColorStop(0.5, 'rgba(99, 102, 241, 0.08)');
      g1.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = g1;
      ctx.fillRect(0, 0, width, height);

      const g2 = ctx.createRadialGradient(
        width * 0.75 + Math.cos(step * 0.7) * 90,
        height * 0.45 + Math.sin(step * 0.9) * 70,
        10,
        width * 0.75,
        height * 0.45,
        Math.max(width, height) * 0.48
      );
      g2.addColorStop(0, 'rgba(168, 85, 247, 0.14)');
      g2.addColorStop(0.5, 'rgba(59, 130, 246, 0.06)');
      g2.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, width, height);

      // 2. Mouse Glow Spotlight
      if (mouse.active) {
        const mouseGlow = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, 240);
        mouseGlow.addColorStop(0, 'rgba(129, 140, 248, 0.2)');
        mouseGlow.addColorStop(0.5, 'rgba(56, 189, 248, 0.06)');
        mouseGlow.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = mouseGlow;
        ctx.fillRect(0, 0, width, height);
      }

      // 3. Particles & Constellation lines
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i]!;
        p.x += p.vx;
        p.y += p.vy;

        if (p.x < 0) p.x = width;
        if (p.x > width) p.x = 0;
        if (p.y < 0) p.y = height;
        if (p.y > height) p.y = 0;

        if (mouse.active) {
          const dx = mouse.x - p.x;
          const dy = mouse.y - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 140 && dist > 1) {
            p.x += (dx / dist) * 0.55;
            p.y += (dy / dist) * 0.55;
          }
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.baseAlpha;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.shadowBlur = 0;

        for (let j = i + 1; j < particles.length; j++) {
          const p2 = particles[j]!;
          const dx = p.x - p2.x;
          const dy = p.y - p2.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 110) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.strokeStyle = '#818cf8';
            ctx.globalAlpha = (1 - dist / 110) * 0.24;
            ctx.lineWidth = 0.8;
            ctx.stroke();
          }
        }
      }
      ctx.globalAlpha = 1;

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, []);

  return (
    <div className="react-bits-bg-container" aria-hidden="true">
      <div className="react-bits-grid-overlay" />
      <canvas ref={canvasRef} className="react-bits-canvas" />
    </div>
  );
}