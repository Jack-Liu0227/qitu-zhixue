'use client';

import { useEffect, useRef } from 'react';

/**
 * React Bits 灵感动态交互背景（全站浅色全局覆盖）：
 * 粒子星网（Particles/Constellation）、光束辉光（Beams/Glow）与微网格（Squares/Grid），
 * 适配清爽浅色背景，支持鼠标微重力追焦感应与全局流光。
 */
export function ReactBitsBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);

    const mouse = { x: width * 0.5, y: height * 0.35, active: false };
    const handleMouseMove = (e: MouseEvent) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      mouse.active = true;
    };
    const handleMouseLeave = () => {
      mouse.active = false;
    };
    window.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseleave', handleMouseLeave);

    const count = Math.min(80, Math.floor((width * height) / 14000) || 45);
    const particles = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.5,
      vy: (Math.random() - 0.5) * 0.5,
      radius: Math.random() * 2 + 1.2,
      baseAlpha: Math.random() * 0.4 + 0.35,
      color: Math.random() > 0.6 ? '#2563eb' : Math.random() > 0.3 ? '#4f46e5' : '#0284c7',
    }));

    let step = 0;
    const render = () => {
      step += 0.015;
      ctx.clearRect(0, 0, width, height);

      // 1. 动态弥散光晕（Beams / Aurora - 浅色底柔和极光）
      const g1 = ctx.createRadialGradient(
        width * 0.25 + Math.sin(step * 0.8) * 90,
        height * 0.35 + Math.cos(step * 0.6) * 70,
        10,
        width * 0.25,
        height * 0.35,
        Math.max(width, height) * 0.55
      );
      g1.addColorStop(0, 'rgba(186, 230, 253, 0.45)');
      g1.addColorStop(0.5, 'rgba(199, 210, 254, 0.25)');
      g1.addColorStop(1, 'rgba(250, 248, 255, 0)');
      ctx.fillStyle = g1;
      ctx.fillRect(0, 0, width, height);

      const g2 = ctx.createRadialGradient(
        width * 0.8 + Math.cos(step * 0.7) * 100,
        height * 0.55 + Math.sin(step * 0.9) * 80,
        10,
        width * 0.8,
        height * 0.55,
        Math.max(width, height) * 0.55
      );
      g2.addColorStop(0, 'rgba(233, 213, 255, 0.38)');
      g2.addColorStop(0.5, 'rgba(191, 219, 254, 0.22)');
      g2.addColorStop(1, 'rgba(250, 248, 255, 0)');
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, width, height);

      // 2. 鼠标追焦高光聚光灯（Spotlight）
      if (mouse.active) {
        const mouseGlow = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, 280);
        mouseGlow.addColorStop(0, 'rgba(99, 102, 241, 0.15)');
        mouseGlow.addColorStop(0.5, 'rgba(56, 189, 248, 0.06)');
        mouseGlow.addColorStop(1, 'rgba(250, 248, 255, 0)');
        ctx.fillStyle = mouseGlow;
        ctx.fillRect(0, 0, width, height);
      }

      // 3. 粒子集合与星轨连线
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
          if (dist < 150 && dist > 1) {
            p.x += (dx / dist) * 0.65;
            p.y += (dy / dist) * 0.65;
          }
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.baseAlpha;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 4;
        ctx.fill();
        ctx.shadowBlur = 0;

        for (let j = i + 1; j < particles.length; j++) {
          const p2 = particles[j]!;
          const dx = p.x - p2.x;
          const dy = p.y - p2.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 120) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.strokeStyle = '#6366f1';
            ctx.globalAlpha = (1 - dist / 120) * 0.18;
            ctx.lineWidth = 0.85;
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
    <div className="react-bits-bg-container react-bits-bg-global" aria-hidden="true">
      <div className="react-bits-grid-overlay" />
      <canvas ref={canvasRef} className="react-bits-canvas" />
    </div>
  );
}
