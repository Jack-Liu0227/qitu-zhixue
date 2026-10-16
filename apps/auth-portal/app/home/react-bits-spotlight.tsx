'use client';

import React, { useRef, useState, type MouseEvent, type ReactNode } from 'react';

interface SpotlightCardProps {
  children: ReactNode;
  className?: string;
  spotlightColor?: string;
}

export function SpotlightCard({
  children,
  className = '',
  spotlightColor = 'rgba(129, 140, 248, 0.18)',
}: SpotlightCardProps) {
  const divRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [opacity, setOpacity] = useState(0);

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!divRef.current) return;
    const rect = divRef.current.getBoundingClientRect();
    setPosition({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const handleMouseEnter = () => setOpacity(1);
  const handleMouseLeave = () => setOpacity(0);

  return (
    <div
      ref={divRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`react-bits-spotlight-card ${className}`}
    >
      <div
        className="react-bits-spotlight-overlay"
        style={{
          opacity,
          background: `radial-gradient(550px circle at ${position.x}px ${position.y}px, ${spotlightColor}, transparent 65%)`,
        }}
      />
      {children}
    </div>
  );
}