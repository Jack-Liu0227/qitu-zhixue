'use client';
import { projectStageLabel } from '@qitu/contracts';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { VisualAsset, ErrorState, OfflineBanner, PermissionDenied, SkeletonBlock } from '@qitu/ui';
import { useTutorDataSource } from '../TutorDataSourceProvider';
import { createIdempotencyKey } from '../idempotency';

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


function formatRelativeTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (!Number.isFinite(date.getTime())) return '时间未知';
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
  const [historyStatus, setHistoryStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [historyError, setHistoryError] = useState<{ message: string; status?: number; code?: string } | null>(null);
  const [historyReloadKey, setHistoryReloadKey] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [deleteNotice, setDeleteNotice] = useState('');
  const deleteKeys = useRef(new Map<string, string>());

  useEffect(() => {
    let cancelled = false;
    setHistoryStatus('loading');
    setHistoryError(null);
    const load = dataSource.listConversationHistory ? dataSource.listConversationHistory().then(items => {
      if (cancelled) return;
      setProjectSessions(items.filter(item => item.kind === 'project'));
      setExplorationHistory(items.filter(item => item.kind === 'exploration'));
      setHistoryStatus('ready');
    }) : Promise.all([dataSource.listProjects(), dataSource.listExplorationHistory?.() ?? Promise.resolve([])]).then(([projects, explorations]) => {
      if (cancelled) return;
      setProjectSessions(projects.map((project) => ({
        id: project.id,
        title: project.title,
        kind: 'project',
        projectId: project.id,
        updatedAt: project.lastLearningActivityAt ?? project.createdAt ?? '',
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
        stageLabel: projectStageLabel(project.stage),
      })));
      setExplorationHistory(explorations);
      setHistoryStatus('ready');
    });
    void load.catch((cause: unknown) => {
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
  }, [dataSource, currentProjectId, currentExplorationId, currentTurnCount, historyReloadKey]);

  const removeSession = async (item: HistorySessionItem) => {
    if (busy || deleting || !dataSource.deleteHistory) return;
    const prompt = item.kind === 'project'
      ? `永久删除“${item.title}”的全部聊天内容？项目、作品和已产生的判分记录会保留。聊天内容无法恢复。`
      : `永久删除探索“${item.title}”及全部聊天内容？删除后无法恢复。`;
    if (!window.confirm(prompt)) return;
    setDeleting(true); setDeleteNotice('');
    try {
      const fingerprint = `${item.kind}:${item.id}`;
      const key = deleteKeys.current.get(fingerprint) ?? createIdempotencyKey();
      deleteKeys.current.set(fingerprint, key);
      await dataSource.deleteHistory(item.kind === 'project' ? 'conversation' : 'exploration', item.id, key);
      deleteKeys.current.delete(fingerprint);
      setDeleteNotice('会话已永久删除。');
      setHistoryReloadKey(value => value + 1);
      if (isCurrentActive(item)) router.replace('/tutor?idle=1', { scroll: false });
    } catch (error) { setDeleteNotice(error instanceof Error ? error.message : '删除失败，请重试'); }
    finally { setDeleting(false); }
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
    if (busy || deleting) return;
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
          background: '#ffffff',
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
                    background: active ? '#eff6ff' : '#ffffff',
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
                      e.currentTarget.style.background = '#ffffff';
                      e.currentTarget.style.borderColor = '#f1f5f9';
                    }
                  }}
                >
                  <span style={{ fontSize: '15px', lineHeight: 1 }} aria-hidden="true">
                    <VisualAsset assetId={item.kind === 'project' ? 'template-optics-v1' : 'subject-interdisciplinary-v1'} size={20} />
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
        background: '#ffffff',
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
                        <VisualAsset assetId="activity-reflection-v1" size={22} />
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
      {deleteNotice ? <p role="status" style={{ fontSize: 12 }}>{deleteNotice}</p> : null}
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
                        <VisualAsset assetId={item.kind === 'project' ? 'template-optics-v1' : 'subject-interdisciplinary-v1'} size={20} />
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
                  {dataSource.deleteHistory ? <button type="button" className="qitu-button qitu-button-ghost qitu-button-sm"
                    aria-label={`永久删除会话：${item.title}`} title="永久删除会话" disabled={busy || deleting}
                    onClick={event => { event.stopPropagation(); void removeSession(item); }}
                    style={{ flexShrink: 0, padding: '2px 4px', color: '#b91c1c', fontSize: 12 }}>删除</button> : null}


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
        <p style={{ margin: 0 }}>显示最近 100 条会话，按最后对话时间排序。删除会话后聊天内容无法恢复。</p>
        <a href="/student/projects">查看全部项目、搜索与恢复收纳</a>
      </div>

    </aside>
  );
}
