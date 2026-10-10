'use client';

import { useState } from 'react';
import type { TutorProjectContext } from '../types';

export interface PinnedSourceItem {
  id: string;
  index: number;
  title: string;
  type: 'pdf' | 'spreadsheet' | 'note' | 'data' | 'code' | 'doc';
  detail: string;
  isPinned?: boolean;
}

/**
 * Curated sources tailored to either active PBL project or free exploration,
 * perfectly echoing the NotebookLM-style "Pinned sources" rail in the reference design.
 */
export function getDefaultSources(project: TutorProjectContext | null): PinnedSourceItem[] {
  if (project?.project?.title) {
    return [
      {
        id: 'source-1',
        index: 1,
        title: `${project.project.title.slice(0, 14)}·方案任务书.pdf`,
        type: 'pdf',
        detail: 'PDF · 18 页 · 核心指引',
        isPinned: true,
      },
      {
        id: 'source-2',
        index: 2,
        title: 'pygame-game-loop-model.md',
        type: 'note',
        detail: 'Note · 1,200 字 · 核心脉搏',
        isPinned: true,
      },
      {
        id: 'source-3',
        index: 3,
        title: 'aabb-collision-geometry.pdf',
        type: 'pdf',
        detail: 'PDF · 8 页 · 碰撞几何相交',
        isPinned: true,
      },
      {
        id: 'source-4',
        index: 4,
        title: 'sensor-framerate-benchmark.xlsx',
        type: 'spreadsheet',
        detail: 'Spreadsheet · 60 FPS 测速',
        isPinned: true,
      },
      {
        id: 'source-5',
        index: 5,
        title: 'fighter-controller-draft.py',
        type: 'code',
        detail: 'Code · 120 行 · 控制逻辑',
        isPinned: true,
      },
      {
        id: 'source-6',
        index: 6,
        title: 'student-mastery-evidence.md',
        type: 'note',
        detail: 'Note · 640 字 · 掌握度依据',
        isPinned: true,
      },
    ];
  }

  return [
    {
      id: 'source-1',
      index: 1,
      title: 'pbl-inspiration-guideline.pdf',
      type: 'pdf',
      detail: 'PDF · 24 页 · 探索指南',
      isPinned: true,
    },
    {
      id: 'source-2',
      index: 2,
      title: 'python-creative-starter.md',
      type: 'note',
      detail: 'Note · 1,200 字 · 启蒙速查',
      isPinned: true,
    },
    {
      id: 'source-3',
      index: 3,
      title: 'socratic-thinking-framework.md',
      type: 'note',
      detail: 'Note · 850 字 · 思考脚手架',
      isPinned: true,
    },
    {
      id: 'source-4',
      index: 4,
      title: 'interest-cluster-matrix.xlsx',
      type: 'spreadsheet',
      detail: 'Spreadsheet · 今日更新',
      isPinned: true,
    },
    {
      id: 'source-5',
      index: 5,
      title: 'young-maker-showcase-index.csv',
      type: 'data',
      detail: 'Data · 8,400 行 · 经典范例',
      isPinned: true,
    },
    {
      id: 'source-6',
      index: 6,
      title: 'growth-milestone-rubric.pdf',
      type: 'pdf',
      detail: 'PDF · 6 页 · 评价与素养',
      isPinned: true,
    },
  ];
}

function SourceTypeIcon({ type }: { type: PinnedSourceItem['type'] }) {
  switch (type) {
    case 'pdf':
      return (
        <svg
          aria-hidden="true"
          className="qitu-source-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6M9 15h6M9 11h6M9 19h4" strokeLinecap="round" />
        </svg>
      );
    case 'spreadsheet':
      return (
        <svg
          aria-hidden="true"
          className="qitu-source-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 9h18M3 15h18M9 3v18M15 3v18" strokeLinecap="round" />
        </svg>
      );
    case 'code':
      return (
        <svg
          aria-hidden="true"
          className="qitu-source-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <polyline points="16 18 22 12 16 6" />
          <polyline points="8 6 2 12 8 18" />
        </svg>
      );
    case 'data':
      return (
        <svg
          aria-hidden="true"
          className="qitu-source-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <ellipse cx="12" cy="5" rx="9" ry="3" />
          <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
        </svg>
      );
    case 'doc':
      return (
        <svg
          aria-hidden="true"
          className="qitu-source-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15z" />
        </svg>
      );
    case 'note':
    default:
      return (
        <svg
          aria-hidden="true"
          className="qitu-source-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      );
  }
}

export function PinnedSourcesRail({
  project,
  onSelectSource,
  activeSourceIndex,
}: {
  project: TutorProjectContext | null;
  onSelectSource?: (source: PinnedSourceItem) => void;
  activeSourceIndex?: number | null;
}) {
  const [sources, setSources] = useState<PinnedSourceItem[]>(() => getDefaultSources(project));
  const [filterPinnedOnly, setFilterPinnedOnly] = useState(false);

  const displayedSources = filterPinnedOnly ? sources.filter((s) => s.isPinned) : sources;

  const togglePin = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSources((prev) => prev.map((s) => (s.id === id ? { ...s, isPinned: !s.isPinned } : s)));
  };

  return (
    <div className="qitu-pinned-sources-card" aria-label="固定参考材料">
      <header className="qitu-pinned-sources-head">
        <div className="qitu-pinned-sources-title">
          <svg
            aria-hidden="true"
            className="qitu-pin-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M12 17v5M5 9l3-4h8l3 4v2H5V9z" />
            <line x1="5" y1="11" x2="19" y2="11" />
          </svg>
          <h2>Pinned sources</h2>
        </div>
        <div className="qitu-pinned-sources-count-badge">
          <span>{sources.length} sources</span>
        </div>
      </header>

      <div className="qitu-pinned-sources-toolbar">
        <button
          type="button"
          className={`qitu-pinned-filter-pill${!filterPinnedOnly ? ' is-active' : ''}`}
          onClick={() => setFilterPinnedOnly(false)}
        >
          全部材料 ({sources.length})
        </button>
        <button
          type="button"
          className={`qitu-pinned-filter-pill${filterPinnedOnly ? ' is-active' : ''}`}
          onClick={() => setFilterPinnedOnly(true)}
        >
          已固定 ({sources.filter((s) => s.isPinned).length})
        </button>
      </div>

      <ul className="qitu-pinned-sources-list" role="list">
        {displayedSources.map((source) => {
          const isSelected = activeSourceIndex === source.index;
          return (
            <li
              key={source.id}
              className={`qitu-pinned-source-item${isSelected ? ' is-selected' : ''}`}
              onClick={() => onSelectSource?.(source)}
              title="点击在对话中引用或查看此材料"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectSource?.(source);
                }
              }}
            >
              <div className="qitu-pinned-badge" aria-hidden="true">
                {source.index}
              </div>
              <div className="qitu-pinned-content">
                <div className="qitu-pinned-name" title={source.title}>
                  <SourceTypeIcon type={source.type} />
                  <span>{source.title}</span>
                </div>
                <p className="qitu-pinned-meta">{source.detail}</p>
              </div>
              <button
                type="button"
                className={`qitu-pin-toggle${source.isPinned ? ' is-pinned' : ''}`}
                onClick={(e) => togglePin(source.id, e)}
                title={source.isPinned ? '取消固定' : '固定材料'}
                aria-label={source.isPinned ? '取消固定' : '固定材料'}
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill={source.isPinned ? 'currentColor' : 'none'}
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M12 17v5M5 9l3-4h8l3 4v2H5V9z" />
                </svg>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
