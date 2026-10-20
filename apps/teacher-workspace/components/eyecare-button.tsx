'use client';

import { useEffect, useState } from 'react';
import { getStoredEyecare, setStoredEyecare, subscribeEyecare } from '../lib/eyecare';

export function EyecareButton() {
  const [active, setActive] = useState(false);

  useEffect(() => {
    setActive(getStoredEyecare());
    return subscribeEyecare((next) => {
      setActive(next);
    });
  }, []);

  const toggle = () => {
    const next = !active;
    setActive(next);
    setStoredEyecare(next);
  };

  return (
    <button
      type="button"
      className={`qitu-eyecare-toggle-btn ${active ? 'is-active' : ''}`}
      onClick={toggle}
      aria-pressed={active}
      title={active ? '点击退出夜间暗色护眼模式' : '点击开启夜间暗色护眼模式 (2700K~3200K 柔光低眩光)'}
    >
      <span className="qitu-eyecare-btn-icon">🌙</span>
      <span className="qitu-eyecare-btn-text">
        {active ? '护眼模式 (已开启)' : '护眼模式'}
      </span>
      {active && <span className="qitu-eyecare-pulse-dot" aria-hidden="true" />}
    </button>
  );
}
