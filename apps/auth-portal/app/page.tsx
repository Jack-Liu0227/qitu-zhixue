'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { BrandMark } from '@qitu/ui';

export default function HomePage() {
  useEffect(() => {
    const reveal = () => document.querySelectorAll('.reveal').forEach((element) => element.classList.add('visible'));
    reveal();
    const timer = window.setTimeout(reveal, 80);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <main className="home-page">
      <div className="page-glow glow-one" aria-hidden="true" />
      <div className="page-glow glow-two" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />
      <header className="header shell">
        <Link className="brand" href="/" aria-label="启途智学首页">
          <span className="logo" aria-hidden="true"><BrandMark size={40} decorative /></span>
          <span>启途智学</span>
        </Link>
        <nav aria-label="主导航">
          <Link className="active" href="/#home">首页</Link>
          <Link href="/#about">关于我们</Link>
        </nav>
        <Link className="login-button" href="/login">登录 <span aria-hidden="true">↗</span></Link>
      </header>
      <section id="home" className="hero shell">
        <div className="eyebrow reveal"><i /> AI 驱动的个性化项目学习平台 <span>NEW</span></div>
        <h1 className="reveal delay-1">让每一次学习<br /><em>都有方向</em></h1>
        <p id="about" className="hero-copy reveal delay-2">
          在对话中与 AI 一同探索，在项目实践中让创意成形。<br />
          启途智学，为你生成真正属于自己的学习路径。
        </p>
        <div className="float-card card-left" aria-hidden="true">
          <div className="mini-head"><span className="mini-icon violet">文</span><i /><i /></div>
          <div className="mini-title">今日学习计划</div>
          <div className="progress"><span /></div>
          <small>已完成 4 / 6 个任务</small>
        </div>
        <div className="float-card card-right" aria-hidden="true">
          <div className="orbit-icon"><span>42</span></div>
          <div><b>连续学习</b><small>保持好奇的第 42 天</small></div>
        </div>
        <div className="doodle doodle-left" aria-hidden="true"><svg viewBox="0 0 160 120"><path d="M8 103C31 82 20 40 53 34c32-6 34 67 67 53 14-6 10-25 30-29" /><path d="m139 49 12 9-13 6" /></svg></div>
        <div className="doodle doodle-right" aria-hidden="true"><svg viewBox="0 0 100 100"><path d="M50 5v20M50 75v20M5 50h20M75 50h20M18 18l14 14M68 68l14 14M82 18 68 32M32 68 18 82" /></svg></div>
      </section>
    </main>
  );
}
