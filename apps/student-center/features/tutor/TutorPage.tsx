'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PermissionDenied } from '@qitu/ui';
import { ChatThread } from './components/ChatThread';
import { Composer } from './components/Composer';
import { ProjectCard } from './components/ProjectCard';
import { CurrentTask } from './components/CurrentTask';
import { TutorSessionHistory } from './components/TutorSessionHistory';
import { useComposer } from './hooks/useComposer';
import { useTutorSession } from './hooks/useTutorSession';
import { useTutorDataSource } from './TutorDataSourceProvider';
import { createIdempotencyKey } from './idempotency';

/** Teaching state and gate decisions come only from the owned server session. */
export function TutorPage({ projectId }: { projectId?: string }) {
  const router = useRouter();
  const source = useTutorDataSource();
  const [explorationKey, setExplorationKey] = useState(0);
  const session = useTutorSession(projectId, explorationKey);
  const composer = useComposer();
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmationError, setConfirmationError] = useState<string | null>(null);
  const [goalDraft, setGoalDraft] = useState('');
  const [interestDraft, setInterestDraft] = useState('');
  const [isIntentModalOpen, setIsIntentModalOpen] = useState(false);
  const confirmKey = useRef<string | null>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && isIntentModalOpen && !confirming) {
        setIsIntentModalOpen(false);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isIntentModalOpen, confirming]);

  useEffect(() => {
    // Discard legacy browser-stored credentials and fabricated transcripts.
    try {
      for (const key of ['qitu.tutor.sessions', 'qitu.llm.client_config', 'qitu.cached_configured_models']) localStorage.removeItem(key);
    } catch { /* Storage can be disabled; teaching does not depend on it. */ }
    const prompt = new URLSearchParams(window.location.search).get('explorePrompt');
    if (prompt) composer.setDraft(prompt);
  }, [composer.setDraft]);

  const ready = session.sessionStatus === 'ready' && session.connection === 'open';
  const busy = session.streaming || session.submitting || composer.submitting;
  const error = session.submitError ?? session.streamNotice;
  const studentTurns = session.turns.filter((turn) => turn.role === 'student');

  async function confirmProject() {
    if (!session.explorationId || !source.confirmExploration || confirming) return;
    if (!goalDraft.trim() || !interestDraft.trim()) return;
    setConfirming(true);
    setConfirmationError(null);
    confirmKey.current ??= createIdempotencyKey();
    try {
      const result = await source.confirmExploration(session.explorationId, { goal: goalDraft, interest: interestDraft }, confirmKey.current);
      setIsIntentModalOpen(false);
      router.push(`/tutor/${encodeURIComponent(result.project.id)}`);
    } catch (cause) {
      setConfirmationError(cause instanceof Error ? cause.message : '确认失败，请重试');
    } finally { setConfirming(false); }
  }

  function newExploration() {
    if (busy) return;
    if (projectId) { router.push('/tutor?new=1'); return; }
    window.history.replaceState(null, '', `${window.location.pathname}?new=1`);
    confirmKey.current = null;
    setConfirmationError(null);
    setGoalDraft('');
    setInterestDraft('');
    setIsIntentModalOpen(false);
    composer.clear();
    setExplorationKey((key) => key + 1);
  }

  if (session.permissionDenied) return <PermissionDenied title="无法进入 AI搭档" description="你没有访问这个会话的权限，请返回上一页。" />;

  return <div className="qitu-tutor-page">
    <header className="qitu-tutor-header" style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
      <div><p className="qitu-tutor-eyebrow">启途智学 · 项目式学习</p><h1>AI搭档</h1><p className="qitu-tutor-header-subtitle">先确认学习目标，再一起探究；理论掌握由服务端核验。</p></div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span role="status">{session.offline ? '离线 · 暂停发送' : busy ? '导师正在处理' : ready ? '教学会话已连接' : '正在连接教学会话'}</span>
        <button type="button" className="qitu-button qitu-button-ghost" onClick={() => setRightOpen(!rightOpen)} aria-expanded={rightOpen}>项目与进度</button>
      </div>
    </header>
    <div className="qitu-tutor-workspace-layout">
      <TutorSessionHistory
        isOpen={leftOpen}
        onToggle={() => setLeftOpen(!leftOpen)}
        currentProjectId={projectId}
        currentExplorationId={session.explorationId}
        currentTitle={session.project?.project.title}
        currentTurnCount={session.turns.length}
        busy={busy}
        onNewExploration={newExploration}
        onSelectProject={(targetProjectId) => {
          if (busy) return;
          router.push(`/tutor/${encodeURIComponent(targetProjectId)}`);
        }}
      />
      <div style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
        {error ? <div role="alert" style={{ padding: 12, color: '#9f1239', background: '#fff1f2' }}>{error.message} {error.code ? `（${error.code}）` : ''}<button type="button" onClick={session.dismissStreamNotice}>关闭提示</button></div> : null}
        <ChatThread turns={session.turns}
          status={session.sessionStatus === 'ready' && session.turns.length === 0 ? 'empty' : session.sessionStatus}
          error={session.sessionError} streaming={session.streaming} offline={session.offline} escalated={session.escalated}
          disabled={!ready || busy} onRetry={session.projectStatus === 'error' ? session.retryProject : session.retrySession} onReconnect={session.reconnect}
          onSelectOption={(label, text) => {
            if (!ready || busy) return;
            if (text) void composer.submit(text, session.submitText);
            else void session.selectOption(label).catch(() => undefined);
          }}
          composer={
            <Composer
              draft={composer.draft}
              onDraftChange={composer.setDraft}
              attachments={composer.attachments}
              onAddAttachments={composer.addAttachments}
              onRemoveAttachment={composer.removeAttachment}
              offline={session.offline}
              submitting={busy}
              disabled={!ready}
              onSubmit={(atts) => {
                void composer.submit(composer.draft, session.submitText, atts);
              }}
            />
          }
        />
        {session.explorationId && studentTurns.length > 0 ? (
          <aside className="qitu-tutor-intent-banner" aria-label="立项准备">
            <div className="qitu-tutor-intent-banner-main">
              <span className="qitu-tutor-intent-banner-badge">🎯 立项准备</span>
              <span className="qitu-tutor-intent-banner-text">
                已和搭档梳理好学习想法？可随时确认意图并创建正式 PBL 探究项目。
              </span>
            </div>
            <button
              type="button"
              className="qitu-button qitu-button-primary qitu-button-sm"
              disabled={!ready || busy || confirming}
              onClick={() => setIsIntentModalOpen(true)}
            >
              确认学习意图并创建项目
            </button>
          </aside>
        ) : null}
      </div>
      {rightOpen ? <aside style={{ width: 'min(280px, 30vw)', flexShrink: 0, overflow: 'auto' }}>
        {session.project ? <><ProjectCard project={session.project.project} /><CurrentTask task={session.project.currentTask} /></> : <div style={{ padding: 16 }}>
          <h2>正在形成的方向</h2>
          <p>当前仍在探索，尚未创建正式项目。项目阶段和门禁只以服务端记录为准。</p>
          {session.explorationId && studentTurns.length > 0 ? (
            <div style={{ marginTop: 16, padding: 12, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10 }}>
              <p style={{ margin: '0 0 10px', fontSize: 13, color: '#1e40af', fontWeight: 600 }}>💡 准备好开始 PBL 项目了吗？</p>
              <button
                type="button"
                className="qitu-button qitu-button-primary qitu-button-sm"
                style={{ width: '100%' }}
                disabled={!ready || busy || confirming}
                onClick={() => setIsIntentModalOpen(true)}
              >
                确认学习意图并创建项目
              </button>
            </div>
          ) : null}
        </div>}
      </aside> : null}
    </div>
    {isIntentModalOpen ? (
      <div
        className="qitu-intent-modal-overlay"
        role="presentation"
        onClick={(e) => {
          if (e.target === e.currentTarget && !confirming) setIsIntentModalOpen(false);
        }}
      >
        <div className="qitu-intent-modal" role="dialog" aria-modal="true" aria-labelledby="intent-modal-title">
          <div className="qitu-intent-modal-header">
            <div>
              <h2 id="intent-modal-title" style={{ margin: 0, fontSize: '18px', color: '#102a5c', fontWeight: 700 }}>
                确认学习意图并创建项目
              </h2>
              <p className="qitu-tutor-muted" style={{ margin: '6px 0 0', fontSize: '13px' }}>
                请先和搭档澄清目标。只有你明确确认后，系统才会创建项目；确认不代表通过理论门禁。
              </p>
            </div>
            <button
              type="button"
              className="qitu-button qitu-button-ghost qitu-button-sm"
              disabled={confirming}
              onClick={() => setIsIntentModalOpen(false)}
              aria-label="关闭弹窗"
            >
              ✕
            </button>
          </div>

          <div className="qitu-intent-modal-body">
            <label style={{ display: 'grid', gap: '6px', fontSize: '13px', fontWeight: 600, color: '#102a5c' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>学习目标</span>
                <span style={{ fontSize: '12px', fontWeight: 400, color: '#64748b' }}>{goalDraft.length}/120</span>
              </div>
              <textarea
                maxLength={120}
                rows={3}
                value={goalDraft}
                disabled={confirming}
                onChange={(event) => setGoalDraft(event.target.value)}
                placeholder="用自己的话写下这次想弄懂或完成的事情（最多 120 字）"
              />
            </label>

            <label style={{ display: 'grid', gap: '6px', fontSize: '13px', fontWeight: 600, color: '#102a5c', marginTop: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>兴趣方向</span>
                <span style={{ fontSize: '12px', fontWeight: 400, color: '#64748b' }}>{interestDraft.length}/24</span>
              </div>
              <input
                maxLength={24}
                value={interestDraft}
                disabled={confirming}
                onChange={(event) => setInterestDraft(event.target.value)}
                placeholder="例如：小车运动、雷霆战机（最多 24 字）"
              />
            </label>

            {confirmationError ? (
              <p role="alert" style={{ margin: '14px 0 0', padding: '8px 12px', background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: '8px', color: '#be123c', fontSize: '13px' }}>
                {confirmationError}
              </p>
            ) : null}
          </div>

          <div className="qitu-intent-modal-footer">
            <button
              type="button"
              className="qitu-button qitu-button-ghost"
              disabled={confirming}
              onClick={() => setIsIntentModalOpen(false)}
            >
              返回继续讨论
            </button>
            <button
              type="button"
              className="qitu-button qitu-button-primary"
              disabled={!ready || busy || confirming || !goalDraft.trim() || !interestDraft.trim()}
              onClick={() => void confirmProject()}
            >
              {confirming ? '正在确认…' : '确认学习意图并创建项目'}
            </button>
          </div>
        </div>
      </div>
    ) : null}
  </div>;
}
