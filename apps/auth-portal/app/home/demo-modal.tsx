'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { Icon, type IconName } from './icons';

const DEMO_STEPS = [
  { title: '提出真问题', detail: '先由学生说出自己想解决的现实问题，AI 不代替提问。' },
  { title: '拆解成问题链', detail: '在苏格拉底式追问下把大问题拆成可验证的小问题。' },
  { title: '先理论后实践', detail: '理论掌握度达标才解锁动手阶段，避免直接照抄答案。' },
  { title: '作品与讲解同步', detail: '每个阶段都留下过程证据，最终汇成可展示的作品。' },
];

export interface DemoModalProps {
  label: string;
  variant?: 'ghost' | 'outline' | 'primary';
  icon?: IconName;
  className?: string;
}

/** 演示弹窗：导航与首屏的「体验 AI 探索」按钮共用一个组件，各自管理开关状态。 */
export function DemoModal({ label, variant = 'ghost', icon, className }: DemoModalProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const triggerClass = ['home-btn', `home-btn--${variant}`, className]
    .filter((value): value is string => typeof value === 'string' && value !== '')
    .join(' ');

  return (
    <>
      <button
        type="button"
        className={triggerClass}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        {icon !== undefined ? <Icon name={icon} size={18} /> : null}
        <span>{label}</span>
      </button>

      {mounted && open
        ? createPortal(
            <div
              className="home-modal-backdrop"
              onClick={(event) => {
                if (event.target === event.currentTarget) setOpen(false);
              }}
            >
              <div
                className="home-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="home-demo-modal-title"
              >
                <div className="home-modal-head">
                  <div>
                    <p className="home-eyebrow">PBL 沉浸式学习工坊实录演示</p>
                    <h2 className="home-modal-title" id="home-demo-modal-title">
                      AI 搭档如何陪学生走完一个项目
                    </h2>
                  </div>
                  <button
                    type="button"
                    className="home-modal-close"
                    aria-label="关闭演示"
                    ref={closeRef}
                    onClick={() => setOpen(false)}
                  >
                    <Icon name="close" size={20} />
                  </button>
                </div>

                <div className="home-modal-stage">
                  <span className="home-modal-stage-badge">
                    <Icon name="sparkle" size={16} /> 演示视频制作中
                  </span>
                  <p className="home-modal-stage-text">
                    视频素材尚未上线，先用下面四步说明真实的陪学流程 —— 每一步都由学生先作答，
                    AI 只做追问与卡点提示。
                  </p>
                </div>

                <ol className="home-modal-steps">
                  {DEMO_STEPS.map((step, index) => (
                    <li key={step.title} className="home-modal-step">
                      <span className="home-modal-step-index">{String(index + 1).padStart(2, '0')}</span>
                      <span className="home-modal-step-body">
                        <strong>{step.title}</strong>
                        <span>{step.detail}</span>
                      </span>
                    </li>
                  ))}
                </ol>

                <div className="home-modal-foot">
                  <p className="home-modal-note">
                    想直接上手？用体验账号登录学生端，AI 搭档会从你的兴趣开始提问。
                  </p>
                  <div className="home-modal-actions">
                    <button type="button" className="home-btn home-btn--ghost" onClick={() => setOpen(false)}>
                      稍后再说
                    </button>
                    <Link className="home-btn home-btn--primary" href="/login">
                      进入登录页
                      <Icon name="arrowRight" size={18} />
                    </Link>
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
