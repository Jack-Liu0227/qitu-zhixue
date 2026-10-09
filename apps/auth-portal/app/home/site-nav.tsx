'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { DemoModal } from './demo-modal';
import { BrandGlyph, Icon } from './icons';

const NAV_ITEMS = [
  { path: '/', label: '首页' },
  { path: '/learning', label: '项目式学习' },
  { path: '/competencies', label: '能力体系' },
  { path: '/about', label: '关于我们' },
  { path: '/contact', label: '合作联系' },
] as const;

function isActivePath(pathname: string, path: string): boolean {
  return path === '/' ? pathname === '/' : pathname.startsWith(path);
}

export function SiteNav() {
  const pathname = usePathname() ?? '/';
  const [menuOpen, setMenuOpen] = useState(false);

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
        <Link className="home-brand" href="/">
          <BrandGlyph />
          <span className="home-brand-copy">
            <span className="home-brand-name">启途智学</span>
            <span className="home-brand-sub">QuestED Intelligence</span>
          </span>
        </Link>

        <nav className="home-nav" aria-label="主导航">
          {NAV_ITEMS.map((item) => {
            const active = isActivePath(pathname, item.path);
            return (
              <Link
                key={item.path}
                href={item.path}
                className={`home-nav-link${active ? ' is-active' : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                {item.label}
              </Link>
            );
          })}
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
          {NAV_ITEMS.map((item) => {
            const active = isActivePath(pathname, item.path);
            return (
              <Link
                key={item.path}
                href={item.path}
                className={`home-mobile-link${active ? ' is-active' : ''}`}
                aria-current={active ? 'page' : undefined}
                onClick={() => setMenuOpen(false)}
              >
                {item.label}
                <Icon name="chevronRight" size={16} />
              </Link>
            );
          })}
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
