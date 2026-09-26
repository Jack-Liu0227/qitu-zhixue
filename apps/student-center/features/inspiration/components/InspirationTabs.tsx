'use client';

import { useCallback, useRef, useState, type KeyboardEvent } from 'react';

import type { InspirationDataSource } from '../data';
import { FreeExplorePanel } from './FreeExplorePanel';
import { RecommendedTemplates } from './RecommendedTemplates';

export type InspirationTab = 'recommended' | 'explore';

const TABS: readonly { id: InspirationTab; label: string }[] = [
  { id: 'recommended', label: '推荐项目' },
  { id: 'explore', label: '自由探索' },
];

const RECOMMENDED_PANEL_ID = 'qitu-inspiration-panel-recommended';
const EXPLORE_PANEL_ID = 'qitu-inspiration-panel-explore';

export interface InspirationTabsProps {
  /** 默认选中「推荐项目」。 */
  initialTab?: InspirationTab;
  dataSource?: InspirationDataSource;
}

/**
 * 灵感空间双标签页：推荐项目 / 自由探索。
 *
 * 真实 ARIA tabs：`role="tablist"`、`role="tab"`、`aria-selected`、
 * `role="tabpanel"`、`aria-controls`/`aria-labelledby`，并支持左右方向键 /
 * Home / End 键盘切换（roving tabindex）。
 */
export function InspirationTabs({ initialTab = 'recommended', dataSource }: InspirationTabsProps) {
  const [activeTab, setActiveTab] = useState<InspirationTab>(initialTab);
  const tabRefs = useRef<Partial<Record<InspirationTab, HTMLButtonElement | null>>>({});

  const focusTab = useCallback((index: number) => {
    const id = TABS[index]?.id;
    if (id) tabRefs.current[id]?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const currentIndex = TABS.findIndex((tab) => tab.id === activeTab);
      let nextIndex = currentIndex;

      switch (event.key) {
        case 'ArrowRight':
          nextIndex = (currentIndex + 1) % TABS.length;
          break;
        case 'ArrowLeft':
          nextIndex = (currentIndex - 1 + TABS.length) % TABS.length;
          break;
        case 'Home':
          nextIndex = 0;
          break;
        case 'End':
          nextIndex = TABS.length - 1;
          break;
        default:
          return;
      }

      event.preventDefault();
      const next = TABS[nextIndex]?.id;
      if (next) {
        setActiveTab(next);
        focusTab(nextIndex);
      }
    },
    [activeTab, focusTab],
  );

  return (
    <div className="qitu-inspiration-tabs">
      <div className="qitu-screen-toolbar">
        <h1>灵感空间</h1>
      </div>

      <div
        className="qitu-inspiration-tablist"
        role="tablist"
        aria-label="灵感空间"
        onKeyDown={handleKeyDown}
      >
        {TABS.map((tab) => {
          const selected = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              ref={(node) => {
                tabRefs.current[tab.id] = node;
              }}
              type="button"
              role="tab"
              id={`qitu-inspiration-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={tab.id === 'recommended' ? RECOMMENDED_PANEL_ID : EXPLORE_PANEL_ID}
              tabIndex={selected ? 0 : -1}
              className={selected ? 'qitu-tab is-active' : 'qitu-tab'}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={RECOMMENDED_PANEL_ID}
        aria-labelledby="qitu-inspiration-tab-recommended"
        tabIndex={0}
        hidden={activeTab !== 'recommended'}
      >
        <RecommendedTemplates dataSource={dataSource} />
      </div>

      <div
        role="tabpanel"
        id={EXPLORE_PANEL_ID}
        aria-labelledby="qitu-inspiration-tab-explore"
        tabIndex={0}
        hidden={activeTab !== 'explore'}
      >
        <FreeExplorePanel />
      </div>
    </div>
  );
}
