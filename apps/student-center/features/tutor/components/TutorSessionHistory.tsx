'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ErrorState, OfflineBanner, PermissionDenied, SkeletonBlock } from '@qitu/ui';
import { useTutorDataSource } from '../TutorDataSourceProvider';

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
const DELETED_STORAGE_KEY = 'qitu.tutor.deleted_exploration_history';
const HIDDEN_PROJECTS_STORAGE_KEY = 'qitu.tutor.hidden_project_history';
function getHiddenProjectIds(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(HIDDEN_PROJECTS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

function getDeletedExplorationIds(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(DELETED_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

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
    if (getDeletedExplorationIds().has(item.id)) return;
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
    const deleted = getDeletedExplorationIds();
    deleted.add(id);
    localStorage.setItem(DELETED_STORAGE_KEY, JSON.stringify([...deleted].slice(-100)));
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
  currentAssistantName?: string;
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
  currentAssistantName = '启途智学助手',
  currentTurnCount,
  isOpen,
  onToggle,
  onNewExploration,
  onSelectProject,
  busy = false,
}: TutorSessionHistoryProps) {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState('');
  const dataSource = useTutorDataSource();
  const [projectSessions, setProjectSessions] = useState<HistorySessionItem[]>([]);
  const [explorationHistory, setExplorationHistory] = useState<HistorySessionItem[]>([]);
  const [hiddenProjectIds, setHiddenProjectIds] = useState<Set<string>>(() => getHiddenProjectIds());
  const [historyStatus, setHistoryStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [historyError, setHistoryError] = useState<{ message: string; status?: number; code?: string } | null>(null);
  const [historyReloadKey, setHistoryReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setHistoryStatus('loading');
    setHistoryError(null);
    void dataSource.listProjects().then((projects) => {
      if (cancelled) return;
      setProjectSessions(projects.filter((project) => !hiddenProjectIds.has(project.id)).map((project) => ({
        id: project.id,
        title: project.title,
        kind: 'project',
        projectId: project.id,
        updatedAt: new Date().toISOString(),
        // The project list is the persisted source of truth. During the first
        // render of a project route the session has not loaded yet, so
        // `currentTurnCount` is temporarily zero and must not erase the count
        // returned by the API. Keep the live session count only as a fallback
        // for data sources that do not provide a persisted count.
        turnCount: typeof project.turnCount === 'number'
          ? project.turnCount
          : project.id === currentProjectId
            ? currentTurnCount
            : 0,
        stageLabel: project.stage,
      })));
      setHistoryStatus('ready');
    }).catch((cause: unknown) => {
      if (cancelled) return;
      const candidate = typeof cause === 'object' && cause !== null ? cause as { message?: unknown; status?: unknown; code?: unknown } : {};
      setHistoryError({
        message: typeof candidate.message === 'string' ? candidate.message : '历史会话加载失败',
        status: typeof candidate.status === 'number' ? candidate.status : undefined,
        code: typeof candidate.code === 'string' ? candidate.code : undefined,
      });
      setHistoryStatus('error');
    });
    return () => { cancelled = true; };
  }, [dataSource, currentProjectId, currentTurnCount, hiddenProjectIds, historyReloadKey]);

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

  const handleDelete = (e: React.MouseEvent, item: HistorySessionItem) => {
    e.stopPropagation();
    if (!window.confirm(`确认从会话历史中删除“${item.title}”吗？\n\n仅移除历史入口，不会删除项目数据。`)) return;
    if (item.kind === 'project') {
      const next = new Set(hiddenProjectIds);
      next.add(item.id);
      try { localStorage.setItem(HIDDEN_PROJECTS_STORAGE_KEY, JSON.stringify([...next].slice(-100))); } catch { /* Storage may be unavailable. */ }
      setHiddenProjectIds(next);
      return;
    }
    deleteLocalExplorationSession(item.id);
    setExplorationHistory(getLocalExplorationHistory());
  };

  const allSessions = useMemo(() => {
    return [...projectSessions, ...explorationHistory];
  }, [projectSessions, explorationHistory]);

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
      router.push(`/tutor?explorationId=${encodeURIComponent(session.id)}`, { scroll: false });
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
        className="qitu-live-session-sidebar is-collapsed"
        style={{
          width: 68,
          minWidth: 68,
          flexShrink: 0,
          padding: '12px 0 10px',
          border: '1px solid #e2e8f0',
          borderRadius: 14,
          background: 'var(--qitu-surface, #ffffff)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '8px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
          boxSizing: 'border-box',
          overflow: 'hidden',
        }}
      >
        <button
          type="button"
          onClick={onToggle}
          title="展开侧边栏（会话历史）"
          aria-label="展开侧边栏（会话历史）"
          style={{
            width: '52px',
            height: '40px',
            padding: 0,
            margin: '0 auto',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px solid #cbd5e1',
            borderRadius: '10px',
            background: '#f8fafc',
            color: '#1e293b',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            boxSizing: 'border-box',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: '14px', lineHeight: 1 }}>📂</span>
          <span style={{ fontSize: '10px', fontWeight: 600, color: '#475569', marginTop: '2px', lineHeight: 1 }}>展开</span>
        </button>
        <button
          type="button"
          onClick={onNewExploration}
          disabled={busy}
          title="新建探究会话"
          aria-label="新建探究会话"
          style={{
            width: '36px',
            height: '36px',
            padding: 0,
            margin: '0 auto',
            borderRadius: '50%',
            background: '#2563eb',
            color: '#fff',
            border: 'none',
            fontSize: '19px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 6px rgba(37,99,235,0.2)',
            boxSizing: 'border-box',
            flexShrink: 0,
          }}
        >
          +
        </button>

        {/* 折叠态仍可看到会话排列：紧凑会话轨道 */}
        <div
          role="list"
          aria-label="会话历史（紧凑视图）"
          style={{
            flex: '1 1 auto',
            minHeight: 0,
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '6px',
            overflowY: 'auto',
            overflowX: 'hidden',
            paddingTop: '2px',
          }}
        >
          {historyStatus === 'loading' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'center' }} aria-busy="true">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  style={{
                    width: '44px',
                    height: '44px',
                    borderRadius: '10px',
                    background: 'linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 50%, #f1f5f9 75%)',
                    backgroundSize: '200% 100%',
                    animation: 'qituHistoryPulse 1.2s ease-in-out infinite',
                  }}
                />
              ))}
            </div>
          ) : historyStatus === 'error' ? (
            <span
              role="status"
              title={historyError?.message ?? '会话历史加载失败'}
              style={{
                width: '44px',
                height: '44px',
                display: 'grid',
                placeItems: 'center',
                borderRadius: '10px',
                border: '1px solid #fecaca',
                background: '#fef2f2',
                fontSize: '16px',
              }}
            >
              ⚠️
            </span>
          ) : filteredSessions.length === 0 ? (
            <span
              title="暂无历史会话，点击 + 新建探究会话"
              style={{
                width: '44px',
                height: '44px',
                display: 'grid',
                placeItems: 'center',
                borderRadius: '10px',
                border: '1px dashed #e2e8f0',
                color: '#94a3b8',
                fontSize: '11px',
                textAlign: 'center',
                lineHeight: 1.2,
              }}
            >
              暂无
              <br />
              会话
            </span>
          ) : (
            filteredSessions.map((item) => {
              const active = isCurrentActive(item);
              return (
                <button
                  key={item.id}
                  type="button"
                  role="listitem"
                  onClick={() => handleSelectSession(item)}
                  disabled={busy}
                  title={`${item.title}${item.stageLabel ? ` · ${item.stageLabel}` : ''} · ${item.turnCount}条对话 · ${formatRelativeTime(item.updatedAt)}`}
                  aria-label={`切换到会话：${item.title}`}
                  aria-current={active ? 'true' : undefined}
                  className={`qitu-history-collapsed-btn ${active ? 'is-active' : ''}`}
                  style={{
                    width: '44px',
                    height: '44px',
                    padding: 0,
                    flexShrink: 0,
                    display: 'grid',
                    placeItems: 'center',
                    gap: 0,
                    border: active ? '1.5px solid #3b82f6' : '1px solid #f1f5f9',
                    borderRadius: '10px',
                    background: active ? 'var(--qitu-primary-soft, #eff6ff)' : 'var(--qitu-surface, #ffffff)',
                    boxShadow: active ? '0 2px 8px rgba(59,130,246,0.15)' : 'none',
                    cursor: busy ? 'not-allowed' : 'pointer',
                    transition: 'all 0.15s ease',
                    position: 'relative',
                  }}
                  onMouseEnter={(e) => {
                    if (!active) {
                      e.currentTarget.style.background = '#f8fafc';
                      e.currentTarget.style.borderColor = '#e2e8f0';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!active) {
                      e.currentTarget.style.background = 'var(--qitu-surface, #ffffff)';
                      e.currentTarget.style.borderColor = '#f1f5f9';
                    }
                  }}
                >
                  <span style={{ fontSize: '15px', lineHeight: 1 }} aria-hidden="true">
                    {item.kind === 'project' ? '🚀' : '💡'}
                  </span>
                  <span
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      bottom: 3,
                      right: 4,
                      fontSize: '9px',
                      fontWeight: 700,
                      color: active ? '#1d4ed8' : '#94a3b8',
                      background: active ? '#dbeafe' : '#f1f5f9',
                      borderRadius: '4px',
                      padding: '0 3px',
                      lineHeight: '1.4',
                    }}
                  >
                    {item.turnCount}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </aside>
    );
  }

  return (
    <aside
      className="qitu-live-session-sidebar"
      style={{
        width: 'min(220px, 19vw)',
        flexShrink: 0,
        padding: '14px 12px',
        border: '1px solid #e2e8f0',
        borderRadius: 14,
        background: 'var(--qitu-surface, #ffffff)',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 2px 10px rgba(0,0,0,0.03)',
        height: '100%',
        minHeight: '520px',
        boxSizing: 'border-box',
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
        {historyStatus === 'loading' ? (
          <div className="qitu-tutor-history-loading" aria-busy="true"><SkeletonBlock lines={4} height={18} /></div>
        ) : historyError?.status === 403 ? (
          <PermissionDenied title="无法查看会话历史" description="当前账号没有读取会话历史的权限。" />
        ) : historyError?.code === 'NETWORK_OFFLINE' ? (
          <OfflineBanner readOnly onRetry={() => setHistoryReloadKey((key) => key + 1)} />
        ) : historyStatus === 'error' ? (
          <ErrorState title="会话历史加载失败" description={historyError?.message} errorCode={historyError?.code} onRetry={() => setHistoryReloadKey((key) => key + 1)} />
        ) : filteredSessions.length === 0 ? (
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
                className={`qitu-history-session-card ${active ? 'is-active' : ''}`}
                style={{
                  padding: '10px 10px',
                  borderRadius: '10px',
                  border: active ? '1.5px solid #3b82f6' : '1px solid #f1f5f9',
                  background: active ? 'var(--qitu-primary-soft, #eff6ff)' : 'var(--qitu-surface, #ffffff)',
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
                    e.currentTarget.style.background = 'var(--qitu-surface, #ffffff)';
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
                      className="qitu-history-session-meta"
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

                  <button
                      type="button"
                      onClick={(e) => handleDelete(e, item)}
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
                      title="从会话历史中删除"
                      aria-label={`从会话历史中删除${item.title}`}
                    >
                      🗑️
                  </button>
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
