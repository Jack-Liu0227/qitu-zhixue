'use client';

import React, { useEffect, useRef, useState, type ReactNode } from 'react';

interface ScrollRevealProps {
  children: ReactNode;
  className?: string;
  delay?: number;
  direction?: 'up' | 'down' | 'none';
}

/**
 * React Bits 灵感滚动渐入渐出组件 (BlurFade / ScrollReveal)：
 * 参考 https://www.reactbits.dev/
 * 首次进入视口后保持可见；减少动态效果偏好下直接展示内容。
 */
export function ScrollReveal({
  children,
  className = '',
  delay = 0,
  direction = 'up',
}: ScrollRevealProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (motionPreference.matches) {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setIsVisible(true);
          observer.unobserve(element);
        }
      },
      {
        threshold: 0.05,
        rootMargin: '0px 0px -20px 0px',
      }
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, []);

  const dirClass =
    direction === 'none'
      ? 'rb-reveal-static'
      : direction === 'down'
      ? 'rb-reveal-down'
      : 'rb-reveal-up';

  return (
    <div
      ref={ref}
      className={`rb-scroll-reveal ${dirClass} ${isVisible ? 'is-visible' : ''} ${className}`}
      style={{
        transitionDelay: isVisible ? `${delay}ms` : '0ms',
      }}
    >
      {children}
    </div>
  );
}
