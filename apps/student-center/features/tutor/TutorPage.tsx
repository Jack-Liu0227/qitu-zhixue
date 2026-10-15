'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PermissionDenied } from '@qitu/ui';
import { ChatThread } from './components/ChatThread';
import { Composer } from './components/Composer';
import { ProjectCard } from './components/ProjectCard';
import { CurrentTask } from './components/CurrentTask';
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
  const confirmKey = useRef<string | null>(null);

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
      <aside className="qitu-live-session-sidebar" style={{ width: leftOpen ? 'min(220px, 28vw)' : 44, flexShrink: 0, padding: 12, border: '1px solid #e4ecf7', borderRadius: 12, background: '#fff', overflowWrap: 'anywhere' }}>
        <button type="button" className="qitu-button qitu-button-ghost qitu-button-sm" onClick={() => setLeftOpen(!leftOpen)} aria-expanded={leftOpen} aria-label="切换会话侧栏">{leftOpen ? '收起' : '展开'}</button>
        {leftOpen ? <><h2 style={{ fontSize: 15 }}>会话历史</h2><p>{session.project?.project.title ?? '自由探索'}</p><p className="qitu-tutor-muted">当前会话 {session.turns.length} 条记录，历史由服务端保存。</p><button type="button" className="qitu-button qitu-button-secondary qitu-button-sm" disabled={busy} onClick={newExploration}>新建探索</button><p className="qitu-tutor-muted">模型由管理员按教学用途配置，学生无需填写密钥。</p></> : null}
      </aside>
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
          composer={<Composer draft={composer.draft} onDraftChange={composer.setDraft} offline={session.offline} submitting={busy} disabled={!ready} onSubmit={() => { void composer.submit(composer.draft, session.submitText); }} />}
        />
        {session.explorationId && studentTurns.length > 0 ? <section className="qitu-tutor-intent-confirmation">
          <strong>准备把想法变成正式项目？</strong><p>请先和搭档澄清目标。只有你明确确认后，系统才会创建项目；确认不代表通过理论门禁。</p>
          <label>学习目标<textarea maxLength={120} value={goalDraft} disabled={confirming} onChange={(event) => setGoalDraft(event.target.value)} placeholder="用自己的话写下这次想弄懂或完成的事情（最多 120 字）" /></label>
          <label>兴趣方向<input maxLength={24} value={interestDraft} disabled={confirming} onChange={(event) => setInterestDraft(event.target.value)} placeholder="例如：小车运动（最多 24 字）" /></label>
          <button type="button" className="qitu-button qitu-button-primary" disabled={!ready || busy || confirming || !goalDraft.trim() || !interestDraft.trim()} onClick={() => void confirmProject()}>{confirming ? '正在确认…' : '确认学习意图并创建项目'}</button>
          {confirmationError ? <p role="alert">{confirmationError}</p> : null}
        </section> : null}
      </div>
      {rightOpen ? <aside style={{ width: 'min(280px, 30vw)', flexShrink: 0, overflow: 'auto' }}>
        {session.project ? <><ProjectCard project={session.project.project} /><CurrentTask task={session.project.currentTask} /></> : <div style={{ padding: 16 }}><h2>正在形成的方向</h2><p>当前仍在探索，尚未创建正式项目。项目阶段和门禁只以服务端记录为准。</p></div>}
      </aside> : null}
    </div>
  </div>;
}
