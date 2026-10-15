'use client';

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { Icon } from './icons';

interface FrameSpec {
  id: string;
  stageName: string;
  stageEn: string;
  title: string;
  desc: string;
  imageSrc: string;
  agentRole: string;
  agentRoleEn: string;
  accentColor: string;
  metricBadge: string;
}

const FRAMES: FrameSpec[] = [
  {
    id: 'frame-1',
    stageName: '阶段 01 · 真实问题探究',
    stageEn: 'STAGE 01 · DRIVING QUESTION & INQUIRY',
    title: '从真实世界任务出发，启发深层思考',
    desc: '苏格拉底式 AI 搭档引导学生澄清问题、定义目标，通过自然交互梳理探究路径。',
    imageSrc: '/images/pbl-hero-frame-1.jpg',
    agentRole: '启发式探究搭档',
    agentRoleEn: 'Socratic Inquiry Partner',
    accentColor: '#2563eb',
    metricBadge: '目标澄清度 98%',
  },
  {
    id: 'frame-2',
    stageName: '阶段 02 · 理论掌握与深度验证',
    stageEn: 'STAGE 02 · THEORY MASTERY & GATE VERIFICATION',
    title: '严密逻辑推演，理论达标后解锁实践',
    desc: '多模态实验数据采集与理论图谱推演，系统自动审核先决条件，保障工程实践严谨性。',
    imageSrc: '/images/pbl-hero-frame-2.jpg',
    agentRole: '理论门禁核验器',
    agentRoleEn: 'Theory Gate Verifier',
    accentColor: '#7c3aed',
    metricBadge: '理论达标率 100%',
  },
  {
    id: 'frame-3',
    stageName: '阶段 03 · 实体创作与六维素养成长',
    stageEn: 'STAGE 03 · ARTIFACT CREATION & GROWTH RADAR',
    title: '将灵感转化为作品，沉淀完整成长证据',
    desc: '完成真实项目作品交付，生成六维素养雷达图与全流程可信学习成长档案。',
    imageSrc: '/images/pbl-hero-frame-3.jpg',
    agentRole: '成长评估专家',
    agentRoleEn: 'Growth Portfolio Evaluator',
    accentColor: '#10b981',
    metricBadge: '六维素养全面跃升',
  },
];

export function HeroDynamicFrames() {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!isPlaying) return;
    timerRef.current = setInterval(() => {
      setCurrentIdx((prev) => (prev + 1) % FRAMES.length);
    }, 4800);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPlaying]);

  const frame = FRAMES[currentIdx]!;

  return (
    <div
      className="home-dynamic-visual"
      onMouseEnter={() => setIsPlaying(false)}
      onMouseLeave={() => setIsPlaying(true)}
    >
      {/* 顶部多帧进度胶囊切换栏 */}
      <div className="home-frame-tabs" role="tablist" aria-label="项目式学习演示帧">
        {FRAMES.map((f, i) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={i === currentIdx}
            className={`home-frame-tab ${i === currentIdx ? 'is-active' : ''}`}
            onClick={() => {
              setCurrentIdx(i);
              setIsPlaying(false);
            }}
          >
            <span className="home-frame-tab-indicator">
              <span
                className="home-frame-tab-progress"
                style={{
                  animationDuration: isPlaying && i === currentIdx ? '4.8s' : '0s',
                }}
              />
            </span>
            <span className="home-frame-tab-text">{f.stageName}</span>
          </button>
        ))}
      </div>

      {/* 画面视窗 */}
      <div className="home-frame-stage">
        <div className="home-frame-viewport">
          {FRAMES.map((f, i) => (
            <div
              key={f.id}
              className={`home-frame-slide ${i === currentIdx ? 'is-active' : ''}`}
              aria-hidden={i !== currentIdx}
            >
              <Image
                src={f.imageSrc}
                alt={f.title}
                width={1280}
                height={720}
                className="home-frame-img"
                priority={i === 0}
              />
              <div className="home-frame-overlay" />
            </div>
          ))}
        </div>

        {/* 悬浮实时智能体微章 */}
        <div className="home-frame-badge-top">
          <span className="home-frame-badge-dot" style={{ background: frame.accentColor }} />
          <span className="home-frame-badge-label">{frame.agentRole}</span>
          <span className="home-frame-badge-en">{frame.agentRoleEn}</span>
        </div>

        {/* 底部帧信息面板 */}
        <div className="home-frame-card-bottom">
          <div className="home-frame-meta">
            <span className="home-frame-pill">{frame.stageEn}</span>
            <span className="home-frame-metric">{frame.metricBadge}</span>
          </div>
          <h3 className="home-frame-title">{frame.title}</h3>
          <p className="home-frame-desc">{frame.desc}</p>
        </div>

        {/* 播放/上一帧/下一帧轻量微控 */}
        <div className="home-frame-controls">
          <button
            type="button"
            className="home-frame-ctrl-btn"
            aria-label="上一帧"
            onClick={() => {
              setCurrentIdx((prev) => (prev - 1 + FRAMES.length) % FRAMES.length);
              setIsPlaying(false);
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            type="button"
            className="home-frame-ctrl-btn"
            aria-label={isPlaying ? '暂停动态轮播' : '继续动态轮播'}
            onClick={() => setIsPlaying(!isPlaying)}
          >
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.04em' }}>
              {isPlaying ? 'PAUSE' : 'PLAY'}
            </span>
          </button>
          <button
            type="button"
            className="home-frame-ctrl-btn"
            aria-label="下一帧"
            onClick={() => {
              setCurrentIdx((prev) => (prev + 1) % FRAMES.length);
              setIsPlaying(false);
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
