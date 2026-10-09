'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { DemoModal } from './demo-modal';
import { BrandGlyph, Icon } from './icons';

/** 导航锚点与页面 section 的 id 一一对应，滚动时会高亮当前区块。 */
const NAV_ITEMS = [
  { id: 'top', label: '首页' },
  { id: 'pbl', label: '项目式学习' },
  { id: 'competency', label: '能力体系' },
  { id: 'about', label: '关于我们' },
  { id: 'contact', label: '合作生态' },
] as const;

export function SiteNav() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeId, setActiveId] = useState<string>('top');

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const sections = NAV_ITEMS.map((item) => document.getElementById(item.id)).filter(
      (element): element is HTMLElement => element !== null,
    );
    if (sections.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const first = visible[0];
        if (first !== undefined && first.target.id !== '') setActiveId(first.target.id);
      },
      { rootMargin: '-96px 0px -55% 0px', threshold: [0, 0.2, 0.5] },
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  return (
    <header className="home-header">
      <div className="home-shell home-header-inner">
        <a className="home-brand" href="#top">
          <BrandGlyph />
          <span className="home-brand-copy">
            <span className="home-brand-name">启途智学</span>
            <span className="home-brand-sub">QuestED Intelligence</span>
          </span>
        </a>

        <nav className="home-nav" aria-label="主导航">
          {NAV_ITEMS.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className={`home-nav-link${activeId === item.id ? ' is-active' : ''}`}
              aria-current={activeId === item.id ? 'true' : undefined}
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="home-header-actions">
          <DemoModal label="体验 AI 探索" variant="ghost" icon="sparkle" />
          <Link className="home-btn home-btn--primary home-btn--compact" href="/login">
            登录 / 免费体验
          </Link>
          <span className="home-avatar-chip" aria-hidden="true">
            <Icon name="user" size={18} />
          </span>
          <button
            type="button"
            className="home-menu-btn"
            aria-expanded={menuOpen}
            aria-controls="home-mobile-nav"
            aria-label={menuOpen ? '关闭菜单' : '打开菜单'}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <Icon name={menuOpen ? 'close' : 'menu'} size={22} />
          </button>
        </div>
      </div>

      {menuOpen ? (
        <nav id="home-mobile-nav" className="home-mobile-nav" aria-label="移动端导航">
          {NAV_ITEMS.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className={`home-mobile-link${activeId === item.id ? ' is-active' : ''}`}
              onClick={() => setMenuOpen(false)}
            >
              {item.label}
              <Icon name="chevronRight" size={16} />
            </a>
          ))}
          <Link
            className="home-btn home-btn--primary home-mobile-cta"
            href="/login"
            onClick={() => setMenuOpen(false)}
          >
            登录 / 免费体验
          </Link>
        </nav>
      ) : null}
    </header>
  );
}
