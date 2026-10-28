import type { ReactNode } from 'react';
import { BrandMark } from '@qitu/ui';
import { Icon } from '../home/icons';
import styles from './auth.module.css';

export function AuthFrame({
  registering,
  busy,
  onModeChange,
  children,
}: {
  registering: boolean;
  busy: boolean;
  onModeChange: (value: boolean) => void;
  children: ReactNode;
}) {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <a className={styles.brand} href="/" aria-label="启途智学首页">
          <BrandMark size={36} decorative />
          <span>
            启途智学<small>让好奇心生长</small>
          </span>
        </a>
        <a className={styles.homeLink} href="/">
          返回首页
          <Icon name="arrowRight" width={17} height={17} />
        </a>
      </header>
      <main className={styles.layout}>
        <aside className={styles.story} aria-label="启途智学项目式学习">
          <p className={styles.eyebrow}>
            <span />
            项目式学习 · AI 育人共成长
          </p>
          <h2>
            把你的好奇，
            <br />
            <em>变成自己的作品。</em>
          </h2>
          <p className={styles.storyDescription}>
            从一个真实的问题出发，与 AI 搭档一起理解、探索，
            <br className={styles.desktopBreak} />
            在动手验证中找到自己的答案。
          </p>
          <figure className={styles.project}>
            <img
              src="/media/project-cases/scene-02.webp"
              width={2048}
              height={1152}
              alt="飞行工程项目情境：工作台上的飞行器模型、桨叶与实验工具"
            />
            <figcaption>
              <span>飞行工程</span>
              <span>项目情境示意</span>
            </figcaption>
            <div className={styles.question}>
              <Icon name="compass" width={22} height={22} />
              <div>
                <small>从一个好问题开始</small>
                <strong>怎样让飞行器保持平衡？</strong>
              </div>
            </div>
          </figure>
          <div className={styles.path} aria-label="项目学习路径">
            <span>提出问题</span>
            <Icon name="arrowRight" width={16} height={16} />
            <span>理解原理</span>
            <Icon name="arrowRight" width={16} height={16} />
            <span>验证想法</span>
          </div>
        </aside>
        <section className={styles.panel} aria-labelledby="login-title">
          <div className={styles.modeSwitch} role="group" aria-label="登录或注册">
            <button
              type="button"
              disabled={busy}
              aria-pressed={!registering}
              onClick={() => onModeChange(false)}
            >
              登录
            </button>
            <button
              type="button"
              disabled={busy}
              aria-pressed={registering}
              onClick={() => onModeChange(true)}
            >
              注册账号
            </button>
          </div>
          <div className={styles.heading}>
            <h1 id="login-title">{registering ? '创建你的账号' : '登录启途智学'}</h1>
            <p>
              {registering
                ? '只需填写自己的信息，即可创建个人账号。'
                : '选择身份，进入你的学习与陪伴空间。'}
            </p>
          </div>
          {children}
        </section>
      </main>
      <footer className={styles.footer}>
        <span>每一次探索，都是成长的开始。</span>
        <a href="/contact">
          帮助与联系
          <Icon name="arrowRight" width={14} height={14} />
        </a>
      </footer>
    </div>
  );
}
