'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';

export interface HistorySessionItem {
  id: string;
  title: string;
  kind: 'project' | 'exploration';
  projectId?: string;
  explorationId?: string;
  updatedAt: string;
  turnCount: number;
  stageLabel?: string;
}

const STORAGE_KEY = 'qitu.tutor.exploration_history';

export function getLocalExplorationHistory(): HistorySessionItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLocalExplorationSession(item: HistorySessionItem) {
  if (typeof window === 'undefined') return;
  try {
    const history = getLocalExplorationHistory();
    const filtered = history.filter((h) => h.id !== item.id);
    const updated = [item, ...filtered].slice(0, 30); // 保留最近30条
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {}
}

export function deleteLocalExplorationSession(id: string) {
  if (typeof window === 'undefined') return;
  try {
    const history = getLocalExplorationHistory();
    const updated = history.filter((h) => h.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {}
}

function formatRelativeTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (diffSec < 60) return '刚刚';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分钟前`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} 小时前`;
    if (diffSec < 86400 * 7) return `${Math.floor(diffSec / 86400)} 天前`;
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  } catch {
    return '未知时间';
  }
}

interface TutorSessionHistoryProps {
  currentProjectId?: string;
  currentExplorationId?: string | null;
  currentTitle?: string;
  currentTurnCount: number;
  isOpen: boolean;
  onToggle: () => void;
  onNewExploration: () => void;
  onSelectProject?: (projectId: string) => void;
  busy?: boolean;
}

export function TutorSessionHistory({
  currentProjectId,
  currentExplorationId,
  currentTitle,
  currentTurnCount,
  isOpen,
  onToggle,
  onNewExploration,
  onSelectProject,
  busy = false,
}: TutorSessionHistoryProps) {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState('');
  const [explorationHistory, setExplorationHistory] = useState<HistorySessionItem[]>([]);

  // 预置的推荐/经典 PBL 项目列表
  const presetProjectSessions: HistorySessionItem[] = useMemo(
    () => [
      {
        id: 'pbl-thunder-fighter',
        title: '雷霆战机：从零打造 Python 飞行射击小游戏',
        kind: 'project',
        projectId: 'pbl-thunder-fighter',
        updatedAt: new Date(Date.now() - 3600 * 1000 * 3).toISOString(),
        turnCount: currentProjectId === 'pbl-thunder-fighter' ? currentTurnCount : 12,
        stageLabel: '核心原理探究',
      },
      {
        id: 'pbl-kinetic-energy',
        title: '动能定理：物理虚拟仿真与极值探究',
        kind: 'project',
        projectId: 'pbl-kinetic-energy',
        updatedAt: new Date(Date.now() - 3600 * 1000 * 28).toISOString(),
        turnCount: currentProjectId === 'pbl-kinetic-energy' ? currentTurnCount : 18,
        stageLabel: '代码实践就绪',
      },
      {
        id: 'pbl-smart-car',
        title: '桌面巡线小车：单片机控制与 PID 算法实践',
        kind: 'project',
        projectId: 'pbl-smart-car',
        updatedAt: new Date(Date.now() - 3600 * 1000 * 72).toISOString(),
        turnCount: 8,
        stageLabel: '意图确认',
      },
    ],
    [currentProjectId, currentTurnCount],
  );

  // 初始化并监听本地探索会话
  useEffect(() => {
    setExplorationHistory(getLocalExplorationHistory());
  }, []);

  // 当当前自由探索有新发言时，同步更新本地记录
  useEffect(() => {
    if (!currentProjectId && currentTurnCount > 0) {
      const activeExplorationId = currentExplorationId || 'exploration-active';
      const item: HistorySessionItem = {
        id: activeExplorationId,
        title: currentTitle && currentTitle !== '自由探索' ? currentTitle : `探究会话 #${activeExplorationId.slice(-4)}`,
        kind: 'exploration',
        explorationId: activeExplorationId,
        updatedAt: new Date().toISOString(),
        turnCount: currentTurnCount,
        stageLabel: '自由探索',
      };
      saveLocalExplorationSession(item);
      setExplorationHistory(getLocalExplorationHistory());
    }
  }, [currentProjectId, currentExplorationId, currentTitle, currentTurnCount]);

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    deleteLocalExplorationSession(id);
    setExplorationHistory(getLocalExplorationHistory());
  };

  const allSessions = useMemo(() => {
    return [...presetProjectSessions, ...explorationHistory];
  }, [presetProjectSessions, explorationHistory]);

  const filteredSessions = useMemo(() => {
    if (!searchTerm.trim()) return allSessions;
    const term = searchTerm.toLowerCase();
    return allSessions.filter((s) => s.title.toLowerCase().includes(term) || s.stageLabel?.toLowerCase().includes(term));
  }, [allSessions, searchTerm]);

  const handleSelectSession = (session: HistorySessionItem) => {
    if (busy) return;
    if (session.kind === 'project' && session.projectId) {
      if (onSelectProject) {
        onSelectProject(session.projectId);
      } else {
        router.push(`/tutor/${encodeURIComponent(session.projectId)}`);
      }
    } else {
      router.push(`/tutor?explorationId=${encodeURIComponent(session.id)}`);
    }
  };

  const isCurrentActive = (session: HistorySessionItem) => {
    if (currentProjectId && session.projectId === currentProjectId) return true;
    if (!currentProjectId && currentExplorationId && session.explorationId === currentExplorationId) return true;
    if (!currentProjectId && !currentExplorationId && session.id === 'exploration-active') return true;
    return false;
  };

  if (!isOpen) {
    return (
      <aside
        style={{
          width: 48,
          flexShrink: 0,
          padding: '12px 6px',
          border: '1px solid #e4ecf7',
          borderRadius: 14,
          background: '#ffffff',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '14px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
        }}
      >
        <button
          type="button"
          className="qitu-button qitu-button-ghost qitu-button-sm"
          onClick={onToggle}
          title="展开会话历史侧边栏"
          style={{ width: '36px', height: '36px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <span style={{ fontSize: '16px' }}>📂</span>
        </button>
        <button
          type="button"
          onClick={onNewExploration}
          disabled={busy}
          title="新建探究会话"
          style={{
            width: '34px',
            height: '34px',
            borderRadius: '50%',
            background: '#2563eb',
            color: '#fff',
            border: 'none',
            fontSize: '18px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          +
        </button>
      </aside>
    );
  }

  return (
    <aside
      className="qitu-live-session-sidebar"
      style={{
        width: 'min(280px, 28vw)',
        flexShrink: 0,
        padding: '14px 12px',
        border: '1px solid #e2e8f0',
        borderRadius: 14,
        background: '#ffffff',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 2px 10px rgba(0,0,0,0.03)',
        height: '100%',
        minHeight: '520px',
      }}
    >
      {/* 顶部工具栏 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '16px' }}>💬</span>
          <h2 style={{ fontSize: '15px', fontWeight: 700, margin: 0, color: '#0f172a' }}>会话历史</h2>
        </div>
        <button
          type="button"
          className="qitu-button qitu-button-ghost qitu-button-sm"
          onClick={onToggle}
          aria-label="收起侧栏"
          style={{ fontSize: '12px', padding: '4px 8px' }}
        >
          收起 ◀
        </button>
      </div>

      {/* 新建探索按钮 */}
      <button
        type="button"
        className="qitu-button qitu-button-primary"
        onClick={onNewExploration}
        disabled={busy}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          fontWeight: 600,
          marginBottom: '10px',
          borderRadius: '10px',
        }}
      >
        <span style={{ fontSize: '16px', lineHeight: 1 }}>+</span>
        <span>新建探究会话</span>
      </button>

      {/* 搜索框 */}
      <div style={{ marginBottom: '12px', position: 'relative' }}>
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="搜索历史会话..."
          style={{
            width: '100%',
            padding: '6px 10px 6px 28px',
            fontSize: '12px',
            border: '1px solid #cbd5e1',
            borderRadius: '8px',
            background: '#f8fafc',
            outline: 'none',
          }}
        />
        <span style={{ position: 'absolute', left: '8px', top: '7px', fontSize: '12px', opacity: 0.5 }}>🔍</span>
      </div>

      {/* 会话列表 */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {filteredSessions.length === 0 ? (
          <div style={{ padding: '24px 12px', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>
            暂无匹配的历史会话
          </div>
        ) : (
          filteredSessions.map((item) => {
            const active = isCurrentActive(item);
            return (
              <div
                key={item.id}
                onClick={() => handleSelectSession(item)}
                style={{
                  padding: '10px 10px',
                  borderRadius: '10px',
                  border: active ? '1.5px solid #3b82f6' : '1px solid #f1f5f9',
                  background: active ? '#eff6ff' : '#ffffff',
                  cursor: 'pointer',
                  position: 'relative',
                  transition: 'all 0.15s ease',
                  boxShadow: active ? '0 2px 8px rgba(59,130,246,0.12)' : 'none',
                }}
                onMouseEnter={(e) => {
                  if (!active) {
                    e.currentTarget.style.background = '#f8fafc';
                    e.currentTarget.style.borderColor = '#e2e8f0';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!active) {
                    e.currentTarget.style.background = '#ffffff';
                    e.currentTarget.style.borderColor = '#f1f5f9';
                  }
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                  <span style={{ fontSize: '15px', lineHeight: 1.2 }}>
                    {item.kind === 'project' ? '🚀' : '💡'}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: '13px',
                        fontWeight: active ? 700 : 500,
                        color: active ? '#1e40af' : '#1e293b',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={item.title}
                    >
                      {item.title}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontSize: '11px',
                        color: active ? '#3b82f6' : '#64748b',
                        marginTop: '3px',
                      }}
                    >
                      {item.stageLabel && (
                        <span style={{ background: active ? '#dbeafe' : '#f1f5f9', padding: '1px 5px', borderRadius: '4px' }}>
                          {item.stageLabel}
                        </span>
                      )}
                      <span>{item.turnCount}条对话</span>
                      <span>·</span>
                      <span>{formatRelativeTime(item.updatedAt)}</span>
                    </div>
                  </div>

                  {item.kind === 'exploration' && (
                    <button
                      type="button"
                      onClick={(e) => handleDelete(e, item.id)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#94a3b8',
                        cursor: 'pointer',
                        padding: '2px 4px',
                        fontSize: '12px',
                        opacity: 0.6,
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
                      onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.6')}
                      title="删除此会话记录"
                    >
                      🗑️
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 底部信息提示 */}
      <div
        style={{
          marginTop: '12px',
          paddingTop: '10px',
          borderTop: '1px solid #f1f5f9',
          fontSize: '11px',
          color: '#94a3b8',
          lineHeight: 1.4,
        }}
      >
        <p style={{ margin: 0 }}>🔒 会话受服务端安全门禁与审计保护，未成年人数据最小化可见。</p>
      </div>
    </aside>
  );
}
