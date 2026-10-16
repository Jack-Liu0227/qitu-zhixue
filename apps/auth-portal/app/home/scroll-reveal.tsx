'use client';

import React, { useEffect, useRef, useState, type ReactNode } from 'react';

interface ScrollRevealProps {
  children: ReactNode;
  className?: string;
  delay?: number;
}

/**
 * React Bits 灵感滚动渐入组件 (BlurFade / ScrollReveal)：
 * 每次滚动进入视口均重新触发流畅的「毛玻璃消解 + 平移上浮 + 透明度渐入」动画，
 * 离开视口时自动重置，保证每次翻阅皆有动态反馈。
 */
export function ScrollReveal({ children, className = '', delay = 0 }: ScrollRevealProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setIsVisible(true);
        } else {
          // 离开视口时重置，确保每次翻阅都产生动态效果
          setIsVisible(false);
        }
      },
      {
        threshold: 0.15,
        rootMargin: '0px 0px -40px 0px',
      }
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div
      ref={ref}
      className={`rb-scroll-reveal ${isVisible ? 'is-visible' : ''} ${className}`}
      style={{
        transitionDelay: isVisible ? `${delay}ms` : '0ms',
      }}
    >
      {children}
    </div>
  );
}