'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
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
  const searchParams = useSearchParams();
  const source = useTutorDataSource();
  const [explorationKey, setExplorationKey] = useState(0);
  const routeContextKey = searchParams.toString();
  const session = useTutorSession(projectId, routeContextKey || explorationKey);
  const composer = useComposer();
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmationError, setConfirmationError] = useState<string | null>(null);
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
  const error = session.submitError ?? session.streamNotice ?? (confirmationError ? { message: confirmationError } : null);

  async function handleOneClickCreateProject(goal: string, interest: string) {
    if (!session.explorationId || !source.confirmExploration || confirming) return;
    setConfirming(true);
    setConfirmationError(null);
    confirmKey.current ??= createIdempotencyKey();
    try {
      const result = await source.confirmExploration(
        session.explorationId,
        { goal: goal.trim(), interest: interest.trim() },
        confirmKey.current,
      );
      router.push(`/tutor/${encodeURIComponent(result.project.id)}`);
    } catch (cause) {
      setConfirmationError(cause instanceof Error ? cause.message : '确认创建失败，请重试');
    } finally {
      setConfirming(false);
    }
  }

  function newExploration() {
    if (busy || confirming) return;
    if (projectId) { router.push('/tutor?new=1', { scroll: false }); return; }
    window.history.replaceState(null, '', `${window.location.pathname}?new=1`);
    confirmKey.current = null;
    setConfirmationError(null);
    composer.clear();
    setExplorationKey((key) => key + 1);
  }

  if (session.permissionDenied) return <PermissionDenied title="无法进入 AI搭档" description="你没有访问这个会话的权限，请返回上一页。" />;

  return <div className="qitu-tutor-page">
    <header className="qitu-tutor-header" style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
      <div><p className="qitu-tutor-eyebrow">启途智学 · 项目式学习</p><h1>AI搭档</h1><p className="qitu-tutor-header-subtitle">先确认学习目标，再一起探究；理论掌握由服务端核验。</p></div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span role="status">
          {session.offline
            ? '离线 · 暂停发送'
            : session.sessionStatus === 'error'
              ? session.sessionError?.status === 401
                ? '登录已失效'
                : '会话加载失败'
              : busy
                ? '导师正在处理'
                : ready
                  ? '教学会话已连接'
                  : '正在连接教学会话'}
        </span>
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
        turns={session.turns}
        busy={busy || confirming}
        onNewExploration={newExploration}
        onSelectProject={(targetProjectId) => {
          if (busy || confirming) return;
          router.push(`/tutor/${encodeURIComponent(targetProjectId)}`, { scroll: false });
        }}
      />
      <div style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
        {error ? <div role="alert" style={{ padding: 12, color: '#9f1239', background: '#fff1f2' }}>{error.message} {error.code ? `（${error.code}）` : ''}<button type="button" onClick={session.dismissStreamNotice}>关闭提示</button></div> : null}
        <ChatThread
          sessionId={session.sessionId}
          turns={session.turns}
          status={session.sessionStatus === 'ready' && session.turns.length === 0 ? 'empty' : session.sessionStatus}
          error={session.sessionError}
          streaming={session.streaming}
          offline={session.offline}
          escalated={session.escalated}
          disabled={!ready || busy || confirming}
          onRetry={session.projectStatus === 'error' ? session.retryProject : session.retrySession}
          onReconnect={session.reconnect}
          onSelectOption={(label, text) => {
            if (!ready || busy || confirming) return;
            if (text) void composer.submit(text, session.submitText);
            else void session.selectOption(label).catch(() => undefined);
          }}
          onOneClickCreateProject={handleOneClickCreateProject}
          isConfirmingProject={confirming}
          isExploration={!projectId}
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
      </div>
      {rightOpen ? <aside style={{ width: 'min(280px, 30vw)', flexShrink: 0, overflow: 'auto' }}>
        {session.project ? <><ProjectCard project={session.project.project} /><CurrentTask task={session.project.currentTask} /></> : <div style={{ padding: 16 }}>
          <h2>正在形成的方向</h2>
          <p>当前仍在探索，尚未创建正式项目。可在左侧对话流中直接点击启途智学助手推荐的项目一键立项并唤醒导师团队。</p>
        </div>}
      </aside> : null}
    </div>
  </div>;
}
