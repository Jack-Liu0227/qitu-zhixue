'use client';

import type { ReactNode } from 'react';

export interface ParadigmTab {
  id: string;
  label: string;
  count: number;
}

export interface AionSettingsParadigmProps {
  title: string;
  description: ReactNode;
  searchPlaceholder?: string;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  primaryActionLabel?: string;
  onPrimaryAction?: () => void;
  tabs?: ParadigmTab[];
  activeTab?: string;
  onTabChange?: (id: string) => void;
  children: ReactNode;
}

export function AionSettingsParadigm({
  title,
  description,
  searchPlaceholder = '搜索...',
  searchQuery,
  onSearchChange,
  primaryActionLabel,
  onPrimaryAction,
  tabs,
  activeTab,
  onTabChange,
  children,
}: AionSettingsParadigmProps) {
  return (
    <div className="settings-page-container">
      {/* 1. 统一页头 */}
      <div className="settings-pagehead">
        <div className="settings-titlebox">
          <h1>{title}</h1>
          <div className="settings-desc">{description}</div>
        </div>
        <div className="settings-page-actions">
          <div className="settings-search-box">
            <span aria-hidden="true" style={{ opacity: 0.6 }}>🔍</span>
            <input
              type="text"
              placeholder={searchPlaceholder}
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </div>
          {primaryActionLabel ? (
            <button
              type="button"
              className="settings-action-btn is-primary"
              onClick={onPrimaryAction}
            >
              <span>{primaryActionLabel}</span>
              <span aria-hidden="true">▾</span>
            </button>
          ) : null}
        </div>
      </div>

      {/* 2. 统一 Tabs */}
      {tabs && tabs.length > 0 ? (
        <div className="settings-tabs-row" role="tablist">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`settings-tab-btn ${isActive ? 'is-active' : ''}`}
                onClick={() => onTabChange?.(tab.id)}
              >
                <span>{tab.label}</span>
                <span className="settings-tab-cnt">{tab.count}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {/* 3. 统一列表容器 */}
      <div className="settings-list-container">{children}</div>
    </div>
  );
}

export interface RowCardProps {
  avatarText: string;
  avatarBg?: string;
  name: string;
  statusText: string;
  statusType?: 'ok' | 'custom' | 'off' | 'muted';
  description?: string;
  avatarStack?: string[];
  onTestConnection?: () => void;
  onEdit?: () => void;
  editLabel?: string;
  testLabel?: string;
  testLoading?: boolean;
}

export function RowCard({
  avatarText,
  avatarBg = '#165dff',
  name,
  statusText,
  statusType = 'ok',
  description,
  avatarStack = [],
  onTestConnection,
  onEdit,
  editLabel = '编辑',
  testLabel = '测试连接',
  testLoading = false,
}: RowCardProps) {
  return (
    <div className="settings-row-card">
      <div className="settings-row-avatar" style={{ background: avatarBg }}>
        {avatarText}
      </div>
      <div className="settings-row-meta">
        <div className="settings-row-header">
          <span className="settings-row-name">{name}</span>
          <span className={`settings-chip is-${statusType}`}>
            {statusText}
            <span className="settings-chip-info" title="查看状态详情">ⓘ</span>
          </span>
        </div>
        {description ? <div className="settings-row-sub">{description}</div> : null}
      </div>
      <div className="settings-row-right">
        {avatarStack.length > 0 ? (
          <div className="settings-avatar-stack" title={`关联 ${avatarStack.length} 个角色/模型`}>
            {avatarStack.slice(0, 4).map((char, idx) => (
              <span key={idx} className="settings-avatar-stack-item">
                {char}
              </span>
            ))}
          </div>
        ) : null}
        {onTestConnection ? (
          <button
            type="button"
            className="settings-pill-btn"
            onClick={onTestConnection}
            disabled={testLoading}
          >
            {testLoading ? '测试中...' : testLabel}
          </button>
        ) : null}
        {onEdit ? (
          <button type="button" className="settings-pill-btn" onClick={onEdit}>
            {editLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}
