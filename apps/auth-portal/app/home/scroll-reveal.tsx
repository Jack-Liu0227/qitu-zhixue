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
 * 视口进入与离开时动态平滑切换，实现「毛玻璃消解 + 平滑微浮 + 透明度渐入渐出」。
 * 离开视口时自动重置，使用户在滑动滚轮翻阅页面时每次都能触发灵动的动态过渡。
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

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setIsVisible(true);
        } else {
          // 离开视口时重置，滚轮翻阅时每次均触发渐入渐出动效
          setIsVisible(false);
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